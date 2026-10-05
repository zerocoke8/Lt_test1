// 기획 8차 critic: independent 20-floor sweeps over the real sim (no rendering), with per-mechanic telemetry.
// Run: npx vite-node tests/review/critic-20f.ts   (all knobs via env, output = one JSON object on stdout)
//
//   RUNS=40 FLOORS=20 START=1 SEED0=1000
//   POLICY=active|dodge|dodgeonly|bot|idle    player-0 (or every human, HUMANS=n) behaviour
//       active = balance.ts "직접 교체": swap every ~4 s to the best drag spot, pets on clusters, ult 0.5 s after full
//       dodge  = active + swaps OUT of an enemy telegraph about to land on the field character (only telegraphs that
//                were visible ≥ REACT s — a skilled phone player; tells which damage is avoidable at all)
//       dodgeonly = dodge without the 4 s rhythm (swaps only to dodge / at low HP / empty field): avoidability ceiling
//   REACT=0.6                       dodge reaction time (s)
//   COMP=default|melee|ranged|support|notank|tank   party compositions (all 3 players, see COMPS)
//   HCOMP=ranger,mage,gunner        player 0 only (others keep COMP) — solo player picking a party
//   HUMANS=1                        how many of the 3 players use POLICY (rest = sim bots)
//   TUN='{"maxAliveMonsters":30}'   tunables override
//   PATCH='[["red_mask.skills.0.action.delay",0.7],["ZONES.3.waveSize.max",5],["LATE.factor",0.5],["head_nurse.stats.maxHp","*0.9"]]'
//                                   data edits applied before the run (value "*x" multiplies); first segment = a
//                                   monster/boss/character id, or ZONES / LATE (LATE_STAT_GROWTH) / WAVES (FLOOR_WAVES)
//   DETAIL=1                        also print per-floor top damage sources / killers
//
// Same seeds + same 'active' policy as tests/playtest/balance.ts (SEED0 + k × 7919) → identical runs (cross-check).
// Damage attribution: every monster/boss skill effect amount (damage/heal) is wrapped in a getter that marks the
// index of the event the hit is about to emit, so each 'damage'/'heal' event is tagged "<monster>.<skill>" exactly;
// enemy projectiles get "<monster>.proj" the same way, melee basics "<monster>.basic" (after the attacker's 'attack').
// Per floor: clear/timeout/wipe, character deaths + "burst" deaths (≥ 70 % HP 2 s before), killers, mid-boss life and
// heals received by source, last enemy alive, split copies / deferred queue / max alive, boss enrage, phase timing,
// deaths per phase, deaths ≤ 5 s after a phase change, seconds with ≥ 2 / ≥ 3 boss patterns telegraphed at once.

import { BOT_PRESETS, DEFAULT_TUNABLES, FLOOR_WAVES, LATE_STAT_GROWTH, TICK_RATE, ZONES } from '../../src/config';
import { BOSSES, CHARACTERS, MONSTERS, getPet } from '../../src/data';
import { bestDropPoint } from '../../src/sim/bot';
import { createGameWithWorld, dispatch, tick } from '../../src/sim/game';
import { hitsArea } from '../../src/sim/geometry';
import { canSwap, canUsePet } from '../../src/sim/players';
import { applyOffer, rollOffers } from '../../src/sim/rewards';
import { activeEntity, clampToArena, dist, isAlive, type SimEntity, type World } from '../../src/sim/world';
import type { BossDef, Effect, GameEvent, MonsterDef, PlayerSetup, SimPhase, SkillAction, Tunables, Vec2 } from '../../src/types';

type Policy = 'idle' | 'bot' | 'active' | 'dodge' | 'dodgeonly';
const env = (globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env ?? {};
const RUNS = Number(env.RUNS ?? 40);
const FLOORS = Number(env.FLOORS ?? 20);
const START = Math.max(1, Number(env.START ?? 1));
const LAST = START + FLOORS - 1;
const SEED0 = Number(env.SEED0 ?? 1000);
const POLICY = (env.POLICY ?? 'active') as Policy;
const REACT = Number(env.REACT ?? 0.6);
const COMP = env.COMP ?? 'default';
/** HCOMP='ranger,mage,gunner': player 0's characters only (bots keep the COMP rows) — the solo case. */
const HCOMP = env.HCOMP ? env.HCOMP.split(',') : null;
const HUMANS = Math.max(0, Math.min(3, Number(env.HUMANS ?? 1)));
const TUN: Partial<Tunables> = env.TUN ? JSON.parse(env.TUN) : {};
const PATCH: [string, number | string | boolean][] = env.PATCH ? JSON.parse(env.PATCH) : [];
const DETAIL = env.DETAIL === '1';

const PETS_DEFAULT = [
  ['frog_bomb', 'fairy_heal', 'cat_void'],
  [...BOT_PRESETS[0].pets],
  [...BOT_PRESETS[1].pets],
];
const COMPS: Record<string, string[][]> = {
  default: [['blade', 'mage', 'cleric'], [...BOT_PRESETS[0].characters], [...BOT_PRESETS[1].characters]],
  melee: [['blade', 'berserker', 'shadow'], ['guardian', 'paladin', 'warden'], ['berserker', 'shadow', 'blade']],
  ranged: [['ranger', 'mage', 'gunner'], ['gunner', 'ranger', 'mage'], ['mage', 'gunner', 'ranger']],
  support: [['cleric', 'bard', 'chrono'], ['cleric', 'guardian', 'bard'], ['chrono', 'bard', 'mage']],
  notank: [['blade', 'mage', 'cleric'], ['ranger', 'gunner', 'cleric'], ['blade', 'mage', 'berserker']],
  tank: [['guardian', 'paladin', 'warden'], ['warden', 'guardian', 'cleric'], ['paladin', 'warden', 'mage']],
};

// ─────────────────────────── data patches ───────────────────────────

function applyPatch(path: string, value: number | string | boolean): void {
  const segs = path.split('.');
  let obj: Record<string, unknown>;
  const head = segs.shift()!;
  if (head === 'ZONES') obj = ZONES as unknown as Record<string, unknown>;
  else if (head === 'LATE') obj = LATE_STAT_GROWTH as unknown as Record<string, unknown>;
  else if (head === 'WAVES') obj = FLOOR_WAVES as unknown as Record<string, unknown>;
  else {
    const def = [...MONSTERS, ...BOSSES, ...CHARACTERS].find(d => d.id === head);
    if (!def) throw new Error(`PATCH: unknown def ${head}`);
    obj = def as unknown as Record<string, unknown>;
  }
  while (segs.length > 1) {
    const k = segs.shift()!;
    const nxt = obj[k];
    if (nxt == null || typeof nxt !== 'object') throw new Error(`PATCH: bad path ${path} at ${k}`);
    obj = nxt as Record<string, unknown>;
  }
  const last = segs[0];
  if (typeof value === 'string' && value.startsWith('*')) obj[last] = (obj[last] as number) * Number(value.slice(1));
  else obj[last] = value;
}
for (const [p, v] of PATCH) applyPatch(p, v);

// ─────────────────────────── attribution getters ───────────────────────────

let CUR: World | null = null;
const MARKS = new Map<number, string>();
const wrapped = new WeakSet<object>();
const wrappedProj = new WeakSet<object>();

function wrapEffect(eff: Effect, key: string): void {
  if (eff.kind !== 'damage' && eff.kind !== 'heal') return;
  if (wrapped.has(eff)) return;
  wrapped.add(eff);
  const val = eff.amount;
  Object.defineProperty(eff, 'amount', {
    enumerable: true,
    configurable: true,
    get() {
      if (CUR) MARKS.set(CUR.events.length, key);
      return val;
    },
  });
}
function wrapAction(a: SkillAction | undefined, key: string): void {
  if (!a) return;
  for (const e of a.effects) wrapEffect(e, key);
}
for (const d of [...MONSTERS, ...BOSSES] as (MonsterDef | BossDef)[]) {
  const skills = [...(d.skills ?? []), ...(((d as BossDef).phases ?? []).flatMap(p => p.skills ?? []))];
  for (const sk of skills) {
    const key = `${d.id}.${sk.id}`;
    wrapAction(sk.action, key);
    for (const x of sk.extra ?? []) wrapAction(x, key);
  }
  wrapAction(d.onDeath?.action, `${d.id}.death`);
}

// ─────────────────────────── records ───────────────────────────

interface BossRec {
  phases: { phase: number; t: number }[];
  enragedAt: number | null;
  hpAtEnrage: number | null;
  deathsBySeg: number[]; // by phase index (0 = phase 1), last slot = enraged
  outsBySeg: number[];
  maxTele: number;
  wipeAt: number | null;
  wipeSeg: number | null;
  /** character deaths within 5 s after a phase change (phase 2, phase 3) */
  deathsAfterPhase: number[];
}
interface FloorRec {
  floor: number;
  kind: 'normal' | 'boss';
  mid: string | null;
  boss: string | null;
  outcome: 'clear' | 'timeout' | 'wipe' | 'cut';
  seconds: number;
  deaths: number;
  myDeaths: number;
  outs: number;
  burstDeaths: number;
  dmg: Record<string, number>;
  hits: Record<string, number>;
  casts: Record<string, number>;
  kills: Record<string, number>;
  burstKills: Record<string, number>;
  interrupts: number;
  monHeal: Record<string, number>; // heal on monsters by key
  midSpawnAt: number | null;
  midKillAt: number | null;
  midHealFrac: number; // heals received by the mid boss / its max HP
  midHealBy: Record<string, number>; // same, by healing skill
  lastKillDef: string | null; // last enemy to die on a cleared normal floor
  lastWaveAt: number | null;
  overlapSec: number[]; // boss floors: seconds with >= 2 distinct boss skills telegraphed at once, by segment
  overlap3Sec: number[]; // >= 3 distinct boss skills
  midMaxHp: number;
  midHpAtEnd: number | null;
  minis: number;
  maxDeferred: number;
  deferredSec: number;
  maxAlive: number;
  leftAtTimeout: Record<string, number> | null;
  boss2: BossRec | null;
  swaps: number;
  dodges: number;
  maxTeleAll: number;
}
interface RunRec {
  floors: FloorRec[];
  combatSec: number;
  endFloor: number;
  victory: boolean;
}

function petTarget(w: World, pi: number, petIdx: number): Vec2 | null {
  const p = w.state.players[pi];
  const def = getPet(p.pets[petIdx].defId);
  const a = def.action;
  const r = a.area.shape === 'circle' ? a.area.radius : 1;
  const foes = w.state.entities.filter(e => e.team === 'enemy' && isAlive(e));
  const mine = activeEntity(w, p);
  if (a.affects === 'enemies' || a.summon) {
    let best: { c: Vec2; n: number } | null = null;
    for (const f of foes) {
      let n = 0;
      for (const q of foes) if (dist(q.pos, f.pos) <= r + q.radius) n += q.tier === 'boss' ? 4 : q.tier === 'mid' ? 2 : 1;
      if (!best || n > best.n) best = { c: f.pos, n };
    }
    return best && best.n >= 3 ? clampToArena(w, best.c) : null;
  }
  const allies = w.state.entities.filter(e => e.team === 'ally' && e.kind === 'character' && isAlive(e));
  const heals = a.effects.some(e => e.kind === 'heal');
  const hurt = allies.filter(x => x.hp < x.maxHp * (heals ? 0.6 : 0.75));
  if (hurt.length === 0 || foes.length === 0) return null;
  const anchor = mine && hurt.includes(mine) ? mine : hurt[0];
  return clampToArena(w, anchor.pos);
}

interface Brain {
  lastSwap: number;
  ultAt: number | null;
  react: number | null;
  dodgedTele: Set<number>;
}

/** Telegraphs about to land on `me` that a human could have seen for ≥ REACT s. Damage weight ≈ amount sum. */
function threat(w: World, me: SimEntity, seen: Map<number, number>): number | null {
  for (const t of w.state.telegraphs) {
    if (t.team !== 'enemy') continue;
    if (t.remaining > 0.25) continue;
    const firstSeen = seen.get(t.id);
    if (firstSeen == null || w.state.time - firstSeen < REACT) continue;
    if (hitsArea(t.area, t.center, t.origin, me.pos, me.radius)) return t.id;
  }
  return null;
}

function humanThink(w: World, pi: number, st: Brain, policy: Policy, seen: Map<number, number>, rec: FloorRec): void {
  const s = w.state;
  const p = s.players[pi];
  if (p.out || s.phase !== 'combat') return;
  const foes = s.entities.filter(e => e.team === 'enemy' && isAlive(e));
  const me = activeEntity(w, p);
  if (p.ult.charge >= 1 && me && foes.length) {
    if (st.ultAt == null) st.ultAt = s.time + 0.5;
    if (s.time >= st.ultAt && dispatch(w, { type: 'ult', player: pi }).ok) st.ultAt = null;
  }
  const ready = [0, 1, 2].filter(i => canSwap(w, pi, i).ok);
  if (ready.length) {
    const lowHp = me && me.hp < me.maxHp * 0.35;
    const due = policy !== 'dodgeonly' && s.time - st.lastSwap >= 4 && foes.length > 0;
    let go = false;
    let dodge = false;
    if (!me) {
      if (st.react == null) st.react = s.time + 0.6;
      go = s.time >= st.react;
    } else {
      go = !!lowHp || due;
      if ((policy === 'dodge' || policy === 'dodgeonly') && me.invulnTime <= 0) {
        const tid = threat(w, me, seen);
        if (tid != null && !st.dodgedTele.has(tid)) {
          st.dodgedTele.add(tid);
          go = true;
          dodge = true;
        }
      }
    }
    if (go) {
      const idx = [...ready].sort((a, b) => p.party[b].hp / p.party[b].maxHp - p.party[a].hp / p.party[a].maxHp)[0];
      if (dispatch(w, { type: 'swap', player: pi, partyIndex: idx, pos: bestDropPoint(w, p, idx) }).ok) {
        st.lastSwap = s.time;
        st.react = null;
        if (dodge) rec.dodges++;
      }
    }
  }
  for (let i = 0; i < p.pets.length; i++) {
    if (!canUsePet(w, pi, i).ok) continue;
    const pos = petTarget(w, pi, i);
    if (pos && dispatch(w, { type: 'pet', player: pi, petIndex: i, pos }).ok) break;
  }
}

const inc = (o: Record<string, number>, k: string, v = 1) => {
  o[k] = (o[k] ?? 0) + v;
};

function runOnce(seed: number): RunRec {
  const tunables: Tunables = { ...DEFAULT_TUNABLES, ...TUN };
  const comp = COMPS[COMP];
  if (!comp) throw new Error(`unknown COMP ${COMP}`);
  const humanCount = POLICY === 'bot' || POLICY === 'idle' ? Math.max(1, HUMANS) : HUMANS;
  const players: PlayerSetup[] = comp.map((chars, i) => ({
    name: i === 0 ? '나' : `P${i}`,
    isBot: i >= humanCount || POLICY === 'bot',
    characters: i === 0 && HCOMP ? [...HCOMP] : [...chars],
    pets: [...PETS_DEFAULT[i]],
  }));
  const { game, world: w } = createGameWithWorld({ seed, players, tunables, startFloor: START });
  const s = w.state;
  for (let f = 1; f < START; f++) {
    for (const p of s.players) {
      const offers = rollOffers(w, p, f % 5 === 0);
      if (offers.length) applyOffer(w, p, p.isBot ? offers[w.rng.int(0, offers.length - 1)] : offers[0]);
    }
  }
  game.drainEvents();
  const humans = s.players.filter(p => !p.isBot).map(p => p.id);
  const thinkers = POLICY === 'active' || POLICY === 'dodge' || POLICY === 'dodgeonly' ? humans : [];
  const brains = new Map<number, Brain>(thinkers.map(pi => [pi, { lastSwap: -99, ultAt: null, react: null, dodgedTele: new Set() }]));
  const seen = new Map<number, number>();
  const teleKey = new Map<number, string>();
  const floors: FloorRec[] = [];
  const info = new Map<number, { defId: string; kind: string; tier: string; team: string; maxHp: number }>();
  const hpHist = new Map<number, { t: number; f: number }[]>();
  let combatSec = 0;

  const newRec = (): FloorRec => ({
    floor: s.floor,
    kind: s.plan.kind,
    mid: s.plan.midBossId ?? null,
    boss: s.plan.bossId ?? null,
    outcome: 'cut',
    seconds: 0,
    deaths: 0,
    myDeaths: 0,
    outs: 0,
    burstDeaths: 0,
    dmg: {},
    hits: {},
    casts: {},
    kills: {},
    burstKills: {},
    interrupts: 0,
    monHeal: {},
    midSpawnAt: null,
    midKillAt: null,
    midHealFrac: 0,
    midHealBy: {},
    lastKillDef: null,
    lastWaveAt: null,
    overlapSec: [0, 0, 0, 0],
    overlap3Sec: [0, 0, 0, 0],
    midMaxHp: 0,
    midHpAtEnd: null,
    minis: 0,
    maxDeferred: 0,
    deferredSec: 0,
    maxAlive: 0,
    leftAtTimeout: null,
    boss2:
      s.plan.kind === 'boss'
        ? { phases: [], enragedAt: null, hpAtEnrage: null, deathsBySeg: [0, 0, 0, 0], outsBySeg: [0, 0, 0, 0], maxTele: 0, wipeAt: null, wipeSeg: null, deathsAfterPhase: [0, 0] }
        : null,
    swaps: s.players[0].stats.swaps,
    dodges: 0,
    maxTeleAll: 0,
  });
  let rec = newRec();
  let thinkIn = 0;
  let midId: number | null = null;
  const lastKey = new Map<number, string>();
  const recentDmg = new Map<number, { t: number; key: string; amt: number }[]>();

  const seg = (b: BossRec): number => (s.bossEnraged ? 3 : Math.min(2, b.phases.length));
  const finish = (outcome: FloorRec['outcome'], seconds: number) => {
    rec.outcome = outcome;
    rec.seconds = seconds;
    rec.swaps = s.players[0].stats.swaps - rec.swaps;
    if (midId != null) {
      const m = s.entities.find(e => e.id === midId);
      rec.midHpAtEnd = m && isAlive(m) ? m.hp / m.maxHp : null;
    }
    combatSec += seconds;
    floors.push(rec);
  };

  const maxTicks = TICK_RATE * 60 * 60;
  for (let t = 0; t < maxTicks; t++) {
    if (s.phase === 'reward') {
      for (const pi of humans) if (s.rewardOffersByPlayer[pi]) dispatch(w, { type: 'chooseReward', player: pi, offerIndex: 0 });
      continue;
    }
    if (s.phase === 'runOver') break;
    const floorBefore = s.floor;
    if (thinkers.length) {
      thinkIn -= 1 / TICK_RATE;
      if (thinkIn <= 0) {
        thinkIn = 0.25;
        for (const pi of thinkers) humanThink(w, pi, brains.get(pi)!, POLICY, seen, rec);
      }
    }
    for (const e of s.entities) {
      if (!info.has(e.id)) info.set(e.id, { defId: e.defId, kind: e.kind, tier: e.tier, team: e.team, maxHp: e.maxHp });
    }
    const outBefore = s.players.map(p => p.out);
    const wavesBefore = w.spawner.nextWave;
    CUR = w;
    MARKS.clear();
    tick(w);
    CUR = null;
    const evs = game.drainEvents() as GameEvent[];
    for (const e of s.entities) {
      if (!info.has(e.id)) info.set(e.id, { defId: e.defId, kind: e.kind, tier: e.tier, team: e.team, maxHp: e.maxHp });
    }
    // enemy projectiles: tag the hit they will land (key fixed at fire time)
    for (const pr of s.projectiles) {
      if (wrappedProj.has(pr) || pr.rt.ctx.team !== 'enemy') continue;
      wrappedProj.add(pr);
      const ci = pr.rt.ctx.casterId != null ? info.get(pr.rt.ctx.casterId) : undefined;
      const key = `${ci?.defId ?? '?'}.proj`;
      const amt = pr.rt.amount;
      Object.defineProperty(pr.rt, 'amount', {
        configurable: true,
        enumerable: true,
        get() {
          if (CUR) MARKS.set(CUR.events.length, key);
          return amt;
        },
      });
    }
    let lastAttacker: number | null = null;
    let chainKey: string | null = null;
    const delayedCasts: string[] = [];
    for (let i = 0; i < evs.length; i++) {
      const ev = evs[i];
      const mark = MARKS.get(i);
      if (ev.type !== 'damage' && ev.type !== 'death' && ev.type !== 'heal') chainKey = null;
      switch (ev.type) {
        case 'attack':
          lastAttacker = ev.sourceId;
          break;
        case 'damage': {
          const ti = info.get(ev.targetId);
          if (mark) chainKey = mark;
          if (ti && ti.kind === 'character' && ev.targetTeam === 'ally') {
            let key = mark ?? chainKey ?? undefined;
            if (!key) {
              const ai = lastAttacker != null ? info.get(lastAttacker) : undefined;
              key = ai && ai.team === 'enemy' ? `${ai.defId}.basic` : 'other';
            }
            inc(rec.dmg, key, ev.amount);
            inc(rec.hits, key);
            lastKey.set(ev.targetId, key);
            const arr = recentDmg.get(ev.targetId) ?? [];
            arr.push({ t: s.time, key, amt: ev.amount });
            while (arr.length && s.time - arr[0].t > 2) arr.shift();
            recentDmg.set(ev.targetId, arr);
          }
          break;
        }
        case 'heal': {
          const ti = info.get(ev.targetId);
          if (ti && ti.team === 'enemy' && mark) {
            inc(rec.monHeal, mark, ev.amount);
            if (ev.targetId === midId) {
              rec.midHealFrac += ev.amount / Math.max(1, rec.midMaxHp);
              inc(rec.midHealBy, mark, ev.amount / Math.max(1, rec.midMaxHp));
            }
          }
          break;
        }
        case 'skillCast':
          if (ev.team === 'enemy' && ev.sourceId != null) {
            const si = info.get(ev.sourceId);
            const k = si ? `${si.defId}.${ev.skillId.replace(`${si.defId}_death`, 'death')}` : `?.${ev.skillId}`;
            if (si) inc(rec.casts, k);
            if (ev.delay && ev.delay > 0) delayedCasts.push(si?.tier === 'boss' ? `B:${k}` : k);
          }
          break;
        case 'interrupt':
          rec.interrupts++;
          break;
        case 'spawn': {
          const e = s.entities.find(x => x.id === ev.entityId);
          if (e) info.set(e.id, { defId: e.defId, kind: e.kind, tier: e.tier, team: e.team, maxHp: e.maxHp });
          if (ev.tier === 'mid' && e) {
            rec.midSpawnAt = s.floorTime;
            midId = e.id;
            rec.midMaxHp = e.maxHp;
          }
          if (e && e.defId === 'copy_mini') rec.minis++;
          break;
        }
        case 'death': {
          const di = info.get(ev.entityId);
          if (ev.tier === 'mid' && ev.entityId === midId) rec.midKillAt = s.floorTime;
          if (di && di.team === 'enemy' && di.kind !== 'character') rec.lastKillDef = di.defId;
          if (di && di.kind === 'character' && s.floor === floorBefore) {
            rec.deaths++;
            const owner = s.players.find(p => p.party.some(m => m.entityId === ev.entityId));
            if (owner && owner.id === 0) rec.myDeaths++;
            const k = lastKey.get(ev.entityId) ?? '?';
            inc(rec.kills, k);
            // burst: ≥ 70 % HP 2 s ago
            const h = hpHist.get(ev.entityId);
            const past = h?.find(x => s.time - x.t <= 2.05);
            if (past && past.f >= 0.7) {
              rec.burstDeaths++;
              const parts = recentDmg.get(ev.entityId) ?? [];
              const by: Record<string, number> = {};
              for (const pp of parts) inc(by, pp.key, pp.amt);
              const top = Object.entries(by).sort((a, b) => b[1] - a[1])[0];
              inc(rec.burstKills, top ? top[0] : k);
            }
            if (rec.boss2) {
              rec.boss2.deathsBySeg[seg(rec.boss2)]++;
              const lp = rec.boss2.phases[rec.boss2.phases.length - 1];
              if (lp && s.floorTime - lp.t <= 5 && lp.phase >= 2 && lp.phase <= 3) rec.boss2.deathsAfterPhase[lp.phase - 2]++;
            }
          }
          break;
        }
        case 'bossPhase':
          if (rec.boss2) rec.boss2.phases.push({ phase: ev.phase, t: s.floorTime });
          break;
        case 'enrage':
          if (rec.boss2) {
            rec.boss2.enragedAt = s.floorTime;
            const b = s.entities.find(e => e.id === s.bossId);
            rec.boss2.hpAtEnrage = b ? b.hp / b.maxHp : null;
          }
          break;
      }
    }
    // hp history (characters on field)
    for (const e of s.entities) {
      if (e.kind !== 'character' || !isAlive(e)) continue;
      const h = hpHist.get(e.id) ?? [];
      h.push({ t: s.time, f: e.hp / e.maxHp });
      while (h.length && s.time - h[0].t > 2.1) h.shift();
      hpHist.set(e.id, h);
    }
    {
      // new enemy telegraphs of this tick, in id order = the delayed enemy skillCasts of this tick, in order
      const fresh = s.telegraphs.filter(tg => tg.team === 'enemy' && !seen.has(tg.id)).sort((a, b) => a.id - b.id);
      fresh.forEach((tg, i) => teleKey.set(tg.id, delayedCasts[i] ?? '?'));
    }
    for (const tg of s.telegraphs) if (!seen.has(tg.id)) seen.set(tg.id, s.time);
    if (rec.boss2 && s.phase === 'combat') {
      const bossSkills = new Set<string>();
      for (const tg of s.telegraphs) {
        const k = teleKey.get(tg.id);
        if (tg.team === 'enemy' && k && k.startsWith('B:')) bossSkills.add(k);
      }
      if (bossSkills.size >= 2) rec.overlapSec[seg(rec.boss2)] += 1 / TICK_RATE;
      if (bossSkills.size >= 3) rec.overlap3Sec[seg(rec.boss2)] += 1 / TICK_RATE;
    }
    if (seen.size > 4000) {
      const live = new Set(s.telegraphs.map(x => x.id));
      for (const k of [...seen.keys()]) if (!live.has(k)) seen.delete(k);
      for (const k of [...teleKey.keys()]) if (!live.has(k)) teleKey.delete(k);
    }
    const phaseAfter = s.phase as SimPhase;
    if (s.floor === floorBefore && w.spawner.nextWave > wavesBefore) rec.lastWaveAt = s.floorTime;
    if (s.floor === floorBefore && phaseAfter === 'combat') {
      s.players.forEach((p, pi) => {
        if (p.out && !outBefore[pi]) {
          rec.outs++;
          if (rec.boss2) rec.boss2.outsBySeg[seg(rec.boss2)]++;
        }
      });
      rec.maxAlive = Math.max(rec.maxAlive, s.monstersAlive);
      const d = w.spawner.deferred.length;
      rec.maxDeferred = Math.max(rec.maxDeferred, d);
      if (d > 0) rec.deferredSec += 1 / TICK_RATE;
      const nt = s.telegraphs.filter(x => x.team === 'enemy').length;
      rec.maxTeleAll = Math.max(rec.maxTeleAll, nt);
      if (rec.boss2) rec.boss2.maxTele = Math.max(rec.boss2.maxTele, nt);
      rec.seconds = s.floorTime;
    }
    if (phaseAfter === 'runOver') {
      const rr = s.runResult;
      const ft = w.floorTimes[w.floorTimes.length - 1];
      if (rr?.outcome === 'victory' || (ft && ft.floor === rec.floor && rr?.reason === 'cleared')) finish('clear', ft?.seconds ?? s.floorTime);
      else {
        const out = rr?.reason === 'timeout' ? 'timeout' : 'wipe';
        if (out === 'timeout') {
          const left: Record<string, number> = {};
          for (const e of s.entities) if (e.team === 'enemy' && isAlive(e)) inc(left, e.defId);
          inc(left, '(queued)', w.spawner.pending.length + w.spawner.deferred.length);
          rec.leftAtTimeout = left;
        }
        if (rec.boss2 && out === 'wipe') {
          rec.boss2.wipeAt = s.floorTime;
          rec.boss2.wipeSeg = seg(rec.boss2);
        }
        finish(out, s.floorTime);
      }
      break;
    }
    if (phaseAfter === 'reward' || s.floor !== floorBefore) {
      const ft = w.floorTimes[w.floorTimes.length - 1];
      finish('clear', ft?.seconds ?? rec.seconds);
      if (floors.length >= FLOORS) break;
      if (phaseAfter === 'reward') {
        for (const pi of humans) if (s.rewardOffersByPlayer[pi]) dispatch(w, { type: 'chooseReward', player: pi, offerIndex: 0 });
      }
      rec = newRec();
      midId = null;
      lastKey.clear();
      recentDmg.clear();
      for (const b of brains.values()) {
        b.lastSwap = -99;
        b.dodgedTele.clear();
      }
    }
  }
  const lastF = floors[floors.length - 1];
  return { floors, combatSec, endFloor: lastF?.floor ?? START, victory: !!lastF && lastF.outcome === 'clear' && lastF.floor >= LAST };
}

// ─────────────────────────── aggregate ───────────────────────────

function pctl(xs: number[], q: number): number {
  if (!xs.length) return NaN;
  const a = [...xs].sort((x, y) => x - y);
  return a[Math.min(a.length - 1, Math.floor(q * a.length))];
}
const r1 = (x: number) => (Number.isFinite(x) ? Math.round(x * 10) / 10 : null);
const r2 = (x: number) => (Number.isFinite(x) ? Math.round(x * 100) / 100 : null);
const top = (o: Record<string, number>, n: number, div = 1) =>
  Object.fromEntries(
    Object.entries(o)
      .sort((a, b) => b[1] - a[1])
      .slice(0, n)
      .map(([k, v]) => [k, r1(v / div)]),
  );

const runs: RunRec[] = [];
for (let k = 0; k < RUNS; k++) runs.push(runOnce(SEED0 + k * 7919));

const perFloor: unknown[] = [];
const gDmg: Record<string, number> = {};
const gHits: Record<string, number> = {};
const gCasts: Record<string, number> = {};
const gKills: Record<string, number> = {};
const gBurst: Record<string, number> = {};
const gHeal: Record<string, number> = {};
for (let f = START; f <= LAST; f++) {
  const recs = runs.map(r => r.floors.find(x => x.floor === f)).filter((x): x is FloorRec => !!x);
  if (!recs.length) continue;
  const clears = recs.filter(r => r.outcome === 'clear');
  const dmg: Record<string, number> = {};
  const kills: Record<string, number> = {};
  const burst: Record<string, number> = {};
  for (const r of recs) {
    for (const [k, v] of Object.entries(r.dmg)) {
      inc(dmg, k, v);
      inc(gDmg, k, v);
    }
    for (const [k, v] of Object.entries(r.hits)) inc(gHits, k, v);
    for (const [k, v] of Object.entries(r.casts)) inc(gCasts, k, v);
    for (const [k, v] of Object.entries(r.kills)) {
      inc(kills, k, v);
      inc(gKills, k, v);
    }
    for (const [k, v] of Object.entries(r.burstKills)) {
      inc(burst, k, v);
      inc(gBurst, k, v);
    }
    for (const [k, v] of Object.entries(r.monHeal)) inc(gHeal, k, v);
  }
  const totalDmg = Object.values(dmg).reduce((a, b) => a + b, 0) || 1;
  const row: Record<string, unknown> = {
    floor: f,
    kind: recs[0].kind,
    who: recs[0].boss ?? recs[0].mid,
    reached: recs.length,
    clearPct: r1((clears.length / recs.length) * 100),
    timeouts: recs.filter(r => r.outcome === 'timeout').length,
    wipes: recs.filter(r => r.outcome === 'wipe').length,
    sec: { med: r1(pctl(clears.map(r => r.seconds), 0.5)), p90: r1(pctl(clears.map(r => r.seconds), 0.9)), max: r1(Math.max(...clears.map(r => r.seconds))) },
    deathsAvg: r2(recs.reduce((a, r) => a + r.deaths, 0) / recs.length),
    burstDeathsAvg: r2(recs.reduce((a, r) => a + r.burstDeaths, 0) / recs.length),
    outs: recs.reduce((a, r) => a + r.outs, 0),
    dmgPerRun: r1(totalDmg / recs.length),
    topDmgPct: Object.fromEntries(
      Object.entries(dmg)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 6)
        .map(([k, v]) => [k, r1((v / totalDmg) * 100)]),
    ),
  };
  if (DETAIL) {
    row.killers = top(kills, 6);
    row.burstKillers = top(burst, 5);
  }
  if (recs[0].kind === 'normal') {
    row.mid = {
      spawnMed: r1(pctl(recs.map(r => r.midSpawnAt ?? NaN).filter(Number.isFinite), 0.5)),
      killMed: r1(pctl(recs.map(r => r.midKillAt ?? NaN).filter(Number.isFinite), 0.5)),
      killP90: r1(pctl(recs.map(r => r.midKillAt ?? NaN).filter(Number.isFinite), 0.9)),
      lifeMed: r1(pctl(recs.filter(r => r.midKillAt != null && r.midSpawnAt != null).map(r => r.midKillAt! - r.midSpawnAt!), 0.5)),
      healFracMed: r2(pctl(recs.map(r => r.midHealFrac), 0.5)),
      healFracP90: r2(pctl(recs.map(r => r.midHealFrac), 0.9)),
      healBy: (() => {
        const o: Record<string, number> = {};
        for (const r of recs) for (const [k, v] of Object.entries(r.midHealBy)) inc(o, k, v);
        return top(o, 4, recs.length / 100);
      })(),
      aliveAtTimeout: recs.filter(r => r.outcome === 'timeout' && r.midHpAtEnd != null).length,
    };
    row.minisAvg = r1(recs.reduce((a, r) => a + r.minis, 0) / recs.length);
    row.maxDeferredP90 = pctl(recs.map(r => r.maxDeferred), 0.9);
    row.deferredSecAvg = r1(recs.reduce((a, r) => a + r.deferredSec, 0) / recs.length);
    row.maxAliveP90 = pctl(recs.map(r => r.maxAlive), 0.9);
    row.maxAliveMax = Math.max(...recs.map(r => r.maxAlive));
    row.tailMed = r1(pctl(clears.filter(r => r.lastWaveAt != null).map(r => r.seconds - r.lastWaveAt!), 0.5));
    {
      const lk: Record<string, number> = {};
      for (const r of clears) if (r.lastKillDef) inc(lk, r.lastKillDef);
      row.lastKill = top(lk, 3, clears.length / 100);
    }
    const lefts = recs.filter(r => r.leftAtTimeout);
    if (lefts.length) {
      const agg: Record<string, number> = {};
      for (const r of lefts) for (const [k, v] of Object.entries(r.leftAtTimeout!)) inc(agg, k, v);
      row.leftAtTimeout = top(agg, 8, lefts.length);
    }
  } else {
    const bs = recs.map(r => r.boss2!);
    row.boss = {
      enragedPct: r1((bs.filter(b => b.enragedAt != null).length / bs.length) * 100),
      hpAtEnrageMed: r1(pctl(bs.map(b => (b.hpAtEnrage ?? NaN) * 100).filter(Number.isFinite), 0.5)),
      p2Med: r1(pctl(bs.map(b => b.phases.find(p => p.phase === 2)?.t ?? NaN).filter(Number.isFinite), 0.5)),
      p3Med: r1(pctl(bs.map(b => b.phases.find(p => p.phase === 3)?.t ?? NaN).filter(Number.isFinite), 0.5)),
      deathsBySeg: [0, 1, 2, 3].map(i => r2(bs.reduce((a, b) => a + b.deathsBySeg[i], 0) / bs.length)),
      outsBySeg: [0, 1, 2, 3].map(i => bs.reduce((a, b) => a + b.outsBySeg[i], 0)),
      wipeSeg: [0, 1, 2, 3].map(i => bs.filter(b => b.wipeSeg === i).length),
      wipeAtMed: r1(pctl(bs.map(b => b.wipeAt ?? NaN).filter(Number.isFinite), 0.5)),
      maxTeleP90: pctl(bs.map(b => b.maxTele), 0.9),
      deathsIn5sAfterP2P3: [0, 1].map(i => r2(bs.reduce((a, b) => a + b.deathsAfterPhase[i], 0) / bs.length)),
      overlap2SecBySeg: [0, 1, 2, 3].map(i => r1(recs.reduce((a, r) => a + r.overlapSec[i], 0) / recs.length)),
      overlap3SecBySeg: [0, 1, 2, 3].map(i => r1(recs.reduce((a, r) => a + r.overlap3Sec[i], 0) / recs.length)),
    };
  }
  perFloor.push(row);
}

const totalDmg = Object.values(gDmg).reduce((a, b) => a + b, 0) || 1;
const skillTable = Object.entries(gDmg)
  .sort((a, b) => b[1] - a[1])
  .slice(0, 40)
  .map(([k, v]) => ({
    key: k,
    pct: r1((v / totalDmg) * 100),
    hits: gHits[k] ?? 0,
    casts: gCasts[k] ?? null,
    hitsPerCast: gCasts[k] ? r2((gHits[k] ?? 0) / gCasts[k]) : null,
    kills: gKills[k] ?? 0,
    burstKills: gBurst[k] ?? 0,
  }));
const ends: Record<string, number> = {};
for (const r of runs) {
  const l = r.floors[r.floors.length - 1];
  if (!l || r.victory) continue;
  inc(ends, `${l.floor}:${l.outcome}`);
}
const vict = runs.filter(r => r.victory);
const out = {
  cfg: { RUNS, FLOORS, START, SEED0, POLICY, COMP, HCOMP, HUMANS, REACT, TUN, PATCH },
  runs: {
    victories: vict.length,
    victoryPct: r1((vict.length / runs.length) * 100),
    endFloorMed: pctl(runs.map(r => r.endFloor), 0.5),
    ends: Object.fromEntries(Object.entries(ends).sort((a, b) => parseInt(a[0]) - parseInt(b[0]))),
    // combat seconds of a full (victorious) run; real wall time adds reward screens + floor intros
    fullRunCombatMin: { med: r1(pctl(vict.map(r => r.combatSec / 60), 0.5)), p10: r1(pctl(vict.map(r => r.combatSec / 60), 0.1)), p90: r1(pctl(vict.map(r => r.combatSec / 60), 0.9)) },
    allRunCombatMinMed: r1(pctl(runs.map(r => r.combatSec / 60), 0.5)),
    dodgesPerFloor: r2(runs.reduce((a, r) => a + r.floors.reduce((b, f) => b + f.dodges, 0), 0) / Math.max(1, runs.reduce((a, r) => a + r.floors.length, 0))),
  },
  skillTable,
  monsterHeal: top(gHeal, 10, runs.length),
  perFloor,
};
console.log(JSON.stringify(out, null, 1));
