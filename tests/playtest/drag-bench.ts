// Headless drag-skill bench over the real sim (no rendering): what each of the 15 drag skills is worth per cast and
// per second of cooldown (docs/balance.md), and how much aiming by position matters for it.
// Run: npx vite-node tests/playtest/drag-bench.ts
//   env: BENCH_SEEDS=12 BENCH_SEED0=0 BENCH_FLOORS=5 BENCH_CHARS=blade,mage BENCH_POLICIES=designer,best,naive BENCH_SWAP_EVERY=4
//        BENCH_OUT=path.json (machine-readable result)  BENCH_QUIET=1 (only the value table)
//        BENCH_PARTY=same|mixed1|mixed2 (기획 12차: player 0 = X×3 | X+블레이드+메이지 | X+가디언+레인저; mixed parties
//        count only X's casts and X-only effects: its own dispatch, its 흡혼 marks, its drag summons, its attack-down —
//        meant for 메딕 / 퇴마사 / 퍼펫티어, whose value depends on the rest of the party)
//        GOEDAM=leave (기획 10차 괴담 rooms after floors 2–4: off|leave|random|first|greedy|forced:<room>:<opt>, see
//        goedam-policy.ts; 'leave' = 'off' bit for bit, so the drag numbers stay on base values)
//
// Player 0 = a human-like player whose party is the SAME character 3 times (so every drag effect of player 0 belongs to
// that character), swapping every 4 s when a card is ready, ult 0.5 s after full, no pets. 기획 6차 (a card's cooldown
// starts when it LEAVES): with 3 cards one is back every ≈ cd/2 s at best, so this rhythm is cooldown-bound (one swap
// per 4.8–7.2 s, "secPerCast"). The 크로노 cut measured here (크로노×3) is priced via drag-value.ts cdSec, which is
// calibrated on mixed parties by cd-cut.ts. Players 1–2 = the stock bots. Floor rewards: player 0 always takes the offer that least touches drag skills (pet cd > normal cd > ult >
// def > hp > …) so every character is measured on its base numbers. Executed aim policies:
//   best     — bot aim (R29: real footprint, the whole visible screen) = a perfect aimer
//   designer — cluster centre + the offset a designer reads off the card (start LEFT of the pack for → shapes, etc.)
//              = the "realistic aim" the balance targets use
//   naive    — finger right on the densest cluster (what a new player does)
// At every drop all 4 candidate drops (best / designer / naive / self = on my own character) are also scored on the
// same tick (enemies inside the footprint, mid ×2, boss ×3) → counterfactual aim value without extra runs.
//
// Measured per cast (realised in the run, not nominal): drag damage incl. DoT / delayed parts / zone ticks (no
// overkill); enemy-seconds stunned / Σ slow×seconds and the party HP they actually kept (only while the enemy is in
// range of the character it targets — a stun freezes the attack timer, so each such second = one second of its DPS —
// at its DPS after that character's defence); pull / knockback distance actually moved (priced 0, see drag-value.ts);
// ally HP healed (no overheal), shield actually absorbed, damage prevented by a def buff, extra ally damage from
// atk / attack-speed buffs (applied multiplicatively), bench swap cooldown removed. drag-value.ts weighs them. Cross-check by removing effects from the
// live sim and measuring what the run loses: tests/review/drag-ablation.ts (docs/balance.md 5장).

import fs from 'node:fs';
import { BOT_PRESETS, DEFAULT_TUNABLES, TICK_RATE, VIEW_WIDTH_UNITS } from '../../src/config';
import { CHARACTERS, getCharacter } from '../../src/data';
import { bestDropPoint } from '../../src/sim/bot';
import { createGameWithWorld, dispatch, tick } from '../../src/sim/game';
import { hitsArea } from '../../src/sim/geometry';
import { canSwap } from '../../src/sim/players';
import { DEATH_ACTION_NAME } from '../../src/sim/ondeath';
import { previewPartsFor } from '../../src/sim/preview';
import { effStats } from '../../src/sim/stats';
import { activeEntity, clampToArena, edgeDist, getEntity, isAlive, type SimEntity, type SimStatus, type World } from '../../src/sim/world';
import type { BossDef, PlayerSetup, PreviewPart, Vec2 } from '../../src/types';
import { VALUE_WEIGHTS, dragNeutralPick, valueOf, zeroComponents, type DragComponents } from './drag-value';
import { goedamPilot, goedamTunables, parseGoedamPolicy } from './goedam-policy';

const env = (globalThis as unknown as { process: { env: Record<string, string | undefined> } }).process.env;
const SEEDS = Number(env.BENCH_SEEDS ?? 12);
const FLOORS = Number(env.BENCH_FLOORS ?? 5);
const GOEDAM = parseGoedamPolicy(env.GOEDAM);
const CHARS = env.BENCH_CHARS ? env.BENCH_CHARS.split(',') : CHARACTERS.map(c => c.id);
const POLICIES = (env.BENCH_POLICIES ?? 'designer,best,naive').split(',') as Policy[];
const SWAP_EVERY = Number(env.BENCH_SWAP_EVERY ?? 4);
/** Seed set offset (noise check: run with 0 and e.g. 100 and compare). */
const SEED0 = Number(env.BENCH_SEED0 ?? 0);
const QUIET = env.BENCH_QUIET === '1';
const PARTY = (env.BENCH_PARTY ?? 'same') as 'same' | 'mixed1' | 'mixed2';
const MIXED: Record<string, string[]> = { mixed1: ['blade', 'mage'], mixed2: ['guardian', 'ranger'] };
const DT = 1 / TICK_RATE;

type Policy = 'best' | 'designer' | 'naive' | 'self';

const AIM_OFFSET: Record<string, Vec2> = {
  blade: { x: -3, y: 0 },
  berserker: { x: -1.6, y: 0 },
  shadow: { x: -2.2, y: 0 },
  ranger: { x: -2.5, y: 0 },
  gunner: { x: 2, y: 0 },
  // 기획 12차: no fixed direction (ring / two side spots) → on the pack; 메딕 aims at hurt allies (healer path)
  exorcist: { x: 0, y: 0 },
  puppeteer: { x: 0, y: 0 },
};

const weight = (e: SimEntity) => (e.tier === 'boss' ? 3 : e.tier === 'mid' ? 2 : 1);

function viewOf(w: World, me: SimEntity | null | undefined): { lo: number; hi: number } {
  const a = w.state.plan.arena;
  const half = VIEW_WIDTH_UNITS / 2;
  const x = me?.pos.x ?? a.width / 2;
  const cx = a.width <= VIEW_WIDTH_UNITS ? a.width / 2 : Math.min(a.width - half, Math.max(half, x));
  return { lo: cx - half, hi: cx + half };
}

function score(parts: PreviewPart[], drop: Vec2, units: SimEntity[], affects: 'enemies' | 'allies', weighted = true): number {
  let n = 0;
  const seen = new Set<number>();
  for (const p of parts) {
    if (p.affects !== affects) continue;
    const c = { x: drop.x + p.offset.x, y: drop.y + p.offset.y };
    for (const u of units) {
      if (seen.has(u.id)) continue;
      if (hitsArea(p.area, c, drop, u.pos, u.radius)) {
        seen.add(u.id);
        n += affects === 'enemies' && weighted ? weight(u) : 1;
      }
    }
  }
  return n;
}

function cluster(units: SimEntity[], healer: boolean): Vec2 | null {
  let best: Vec2 | null = null;
  let bestN = 0;
  for (const f of units) {
    let n = 0;
    let sx = 0;
    let sy = 0;
    for (const q of units) {
      if (Math.hypot(q.pos.x - f.pos.x, q.pos.y - f.pos.y) > 2.5) continue;
      const wq = healer ? 1 + (1 - q.hp / q.maxHp) * 3 : weight(q);
      n += wq;
      sx += q.pos.x * wq;
      sy += q.pos.y * wq;
    }
    if (n > bestN) {
      bestN = n;
      best = { x: sx / n, y: sy / n };
    }
  }
  return best;
}

/** Enemy basic DPS (atk incl. floor scaling, dmg slider, enrage × base attack speed): what a stun / slow keeps off us. */
function threat(w: World, e: SimEntity): number {
  let aps = e.rt.base.atkSpeed;
  if (e.enraged && e.rt.monDef?.tier === 'boss') aps *= (e.rt.monDef as BossDef).enrage.atkSpeedMult;
  return effStats(w, e).atk * aps;
}

/** The ally character this enemy is hitting right now (in attack range, alive), else null. */
function engagedTarget(w: World, e: SimEntity): SimEntity | null {
  const t = getEntity(w, e.targetId);
  if (!t || !isAlive(t) || t.kind !== 'character') return null;
  return edgeDist(e, t) <= e.rt.base.range + 0.05 ? t : null;
}

/** Party HP per second this enemy takes off the character it is hitting: DPS after that character's defence. */
function threatOn(w: World, e: SimEntity, t: SimEntity): number {
  return threat(w, e) * (1 - effStats(w, t).def);
}

interface Acc {
  casts: number;
  totalDmg: number;
  bySrc: Record<string, number>;
  simSec: number;
  hitsExec: number;
  enemiesExec: number;
  cf: Record<Policy, number>;
  naiveUnderHalf: number;
  cfN: number;
  floorsCleared: number;
  runs: number;
  wipes: number;
  myDeaths: number;
  /** Ally characters (any player) inside the ally parts of the executed drop. */
  allyHits: number;
  comp: DragComponents;
  perFloor: Map<number, { casts: number; comp: DragComponents }>;
  partyDealt: number;
  partyTaken: number;
  partyHealed: number;
}

const newAcc = (): Acc => ({
  casts: 0,
  totalDmg: 0,
  bySrc: {},
  simSec: 0,
  hitsExec: 0,
  enemiesExec: 0,
  cf: { best: 0, designer: 0, naive: 0, self: 0 },
  naiveUnderHalf: 0,
  cfN: 0,
  floorsCleared: 0,
  runs: 0,
  wipes: 0,
  myDeaths: 0,
  allyHits: 0,
  comp: zeroComponents(),
  perFloor: new Map(),
  partyDealt: 0,
  partyTaken: 0,
  partyHealed: 0,
});

/** Self shield granted by one cast, tracked until it is used up / expires / the caster leaves. */
interface ShieldLedger {
  entityId: number;
  left: number;
  until: number;
  prev: number;
}

function runOne(charId: string, policy: Policy, seed: number, acc: Acc): void {
  const def = getCharacter(charId);
  const party = PARTY === 'same' ? [charId, charId, charId] : [charId, ...MIXED[PARTY]];
  const mixed = PARTY !== 'same';
  const human: PlayerSetup = { name: '나', isBot: false, characters: party, pets: ['frog_bomb', 'fairy_heal', 'cat_void'] };
  const players: PlayerSetup[] = [human, ...BOT_PRESETS.map(b => ({ name: b.name, isBot: true, characters: [...b.characters], pets: [...b.pets] }))];
  // 기획 12차: 돌발 괴담 off — the drag numbers are measured on plain floors (docs/balance.md 11장)
  const { world: w } = createGameWithWorld({ seed, players, tunables: { ...DEFAULT_TUNABLES, fieldEventChance: 0, ...goedamTunables(GOEDAM) } });
  const s = w.state;
  const p = s.players[0];
  const pilot = goedamPilot(w, GOEDAM);
  let lastSwap = -99;
  let ultAt: number | null = null;
  let think = 0;
  let card = 0;
  const maxTicks = TICK_RATE * 60 * 30;
  let deadPrev = p.party.map(m => m.dead);
  const floorBucket = () => {
    let b = acc.perFloor.get(s.floor);
    if (!b) acc.perFloor.set(s.floor, (b = { casts: 0, comp: zeroComponents() }));
    return b;
  };
  const add = (k: keyof DragComponents, v: number) => {
    acc.comp[k] += v;
    floorBucket().comp[k] += v;
  };
  // 기획 12차: 흡혼 marks seen before each tick (a killing blow removes the enemy before we can look) and my drag summons
  const marks = new Map<number, SimStatus>();
  const drainHeal = (fromId: number, amount: number) => {
    const m = marks.get(fromId) ?? ((getEntity(w, fromId)?.statuses ?? []).find(x => x.id === 'drain') as SimStatus | undefined);
    if (m && m.sourcePlayer === 0 && m.src === 'drag') add('drainHealHp', amount);
  };
  const decoys = new Map<number, { e: SimEntity; last: number }>();
  const xDrag = def.drag.name;
  const shields: ShieldLedger[] = [];
  const selfShieldAmt = def.drag.actions
    .filter(a => a.affects === 'self')
    .flatMap(a => a.effects)
    .reduce((sum, e) => sum + (e.kind === 'shield' ? e.amount : 0), 0);
  const selfShieldDur = def.drag.actions.flatMap(a => a.effects).reduce((d, e) => (e.kind === 'shield' ? Math.max(d, e.duration) : d), 0);
  // per-player running totals (buff attribution)
  const prevDealt = s.players.map(q => q.stats.damageDealt - (q.id === 0 ? q.stats.damageBySource.drag : 0));
  const prevBasic = s.players.map(q => q.stats.damageBySource.basic);
  const prevTaken = s.players.map(q => q.stats.damageTaken);
  let prevDrag = p.stats.damageBySource.drag;

  for (let t = 0; t < maxTicks; t++) {
    // (player 0 out → no reward phase for it: the sim moves on by itself, so also stop on the floor number)
    if (s.floor > FLOORS) break;
    if (s.phase === 'reward') {
      if (s.floor >= FLOORS) break;
      pilot.settle([0], dragNeutralPick);
      lastSwap = -99;
      continue;
    }
    if (s.phase === 'runOver') {
      if (s.runResult?.reason === 'wipe') acc.wipes++;
      break;
    }
    think -= DT;
    if (think <= 0 && s.phase === 'combat' && !p.out) {
      think = 0.25;
      const me = activeEntity(w, p);
      const foes = s.entities.filter(e => e.team === 'enemy' && isAlive(e));
      if (p.ult.charge >= 1 && me && foes.length) {
        if (ultAt == null) ultAt = s.time + 0.5;
        if (s.time >= ultAt && dispatch(w, { type: 'ult', player: 0 }).ok) ultAt = null;
      }
      const ready = [0, 1, 2].filter(i => canSwap(w, 0, i).ok);
      const due = (s.time - lastSwap >= SWAP_EVERY || !me) && (foes.length > 0 || !me);
      if (ready.length && due) {
        const idx = [1, 2, 0].map(k => (card + k) % 3).find(i => ready.includes(i))!;
        const parts = previewPartsFor(s, 0, 'swap', idx);
        const healer = !parts.some(pt => pt.affects === 'enemies');
        const affects = healer ? 'allies' : 'enemies';
        const view = viewOf(w, me);
        const inView = (e: SimEntity) => e.pos.x >= view.lo && e.pos.x <= view.hi;
        const allyChars = s.entities.filter(e => e.team === 'ally' && e.kind === 'character' && isAlive(e));
        const pool = healer ? allyChars : foes.filter(inView);
        const c = cluster(pool, healer);
        const selfPos = me ? { ...me.pos } : { x: (view.lo + view.hi) / 2, y: s.plan.arena.height / 2 };
        const off = AIM_OFFSET[charId] ?? { x: 0, y: 0 };
        const clampView = (q: Vec2) => clampToArena(w, { x: Math.min(view.hi, Math.max(view.lo, q.x)), y: q.y });
        const cand: Record<Policy, Vec2> = {
          best: bestDropPoint(w, p, idx),
          naive: clampView(c ?? selfPos),
          designer: clampView(c ? { x: c.x + off.x, y: c.y + off.y } : selfPos),
          self: clampView(selfPos),
        };
        const sc = {} as Record<Policy, number>;
        for (const k of Object.keys(cand) as Policy[]) sc[k] = score(parts, cand[k], pool, affects);
        if (pool.length) {
          acc.cfN++;
          for (const k of Object.keys(cand) as Policy[]) acc.cf[k] += sc[k];
          if (sc.best > 0 && sc.naive < sc.best / 2) acc.naiveUnderHalf++;
        }
        // snapshot for the instant parts (pull / knockback / cooldown cut / instant heal)
        const enemyPos = new Map(foes.map(e => [e.id, { x: e.pos.x, y: e.pos.y }]));
        const benchCd = p.party.map(m => m.swapCooldownRemaining);
        const leaving = p.activeIndex;
        const memberShield = p.party[idx].shield;
        const evBefore = w.events.length;
        const enemiesInFoot = score(parts, cand[policy], foes, 'enemies', false);
        const mine = !mixed || p.party[idx].defId === charId;
        const dragBefore = p.stats.damageBySource.drag;
        const swapped = dispatch(w, { type: 'swap', player: 0, partyIndex: idx, pos: cand[policy] }).ok;
        if (swapped && !mine) {
          // mixed party: another card's cast — played, not measured
          lastSwap = s.time;
          card = idx;
        } else if (swapped) {
          lastSwap = s.time;
          card = idx;
          if (mixed) add('dmg', p.stats.damageBySource.drag - dragBefore);
          acc.casts++;
          floorBucket().casts++;
          acc.hitsExec += sc[policy];
          acc.enemiesExec += enemiesInFoot;
          if (parts.some(pt => pt.affects === 'allies')) acc.allyHits += score(parts, cand[policy], allyChars, 'allies');
          // instant heals (only the drag skill can heal inside this dispatch)
          for (let i = evBefore; i < w.events.length; i++) {
            const ev = w.events[i];
            if (ev.type === 'heal' && ev.from == null) add('heal', ev.amount);
            else if (ev.type === 'heal') drainHeal(ev.from!, ev.amount);
            else if (ev.type === 'benchHeal' && ev.player === 0) add('benchHealHp', ev.amount);
          }
          // pull / knockback actually moved
          for (const [id, before] of enemyPos) {
            const e = getEntity(w, id);
            if (!e || !isAlive(e)) continue;
            const d = Math.hypot(e.pos.x - before.x, e.pos.y - before.y);
            if (d > 1e-6) {
              add('dispUnits', d);
              add('dispHp', (d / Math.max(0.5, e.rt.base.moveSpeed)) * threat(w, e));
            }
          }
          // bench swap cooldown removed (크로노). The appearing card is on field now, skip it. 기획 6차: the LEAVING
          // card's cooldown starts at this swap (its full total, set before the drag skill cuts it) → that total is its
          // baseline; earlier rule (cooldown from appearing, appearing card > 0 after the swap): its running cooldown.
          const leaveStartsCd = p.party[idx].swapCooldownRemaining <= 1e-9;
          p.party.forEach((m, i) => {
            if (i === idx) return;
            const base = i === leaving && leaveStartsCd ? m.swapCooldownTotal : benchCd[i];
            add('cdSec', Math.max(0, base - m.swapCooldownRemaining));
          });
          // self shield
          const me2 = activeEntity(w, p);
          if (me2 && selfShieldAmt > 0) {
            const granted = Math.min(me2.shield - memberShield, selfShieldAmt * me2.maxHp);
            if (granted > 0) {
              add('shieldGranted', granted);
              shields.push({ entityId: me2.id, left: granted, until: s.time + selfShieldDur, prev: me2.shield });
            }
          }
        }
      }
    }

    // zone heals about to tick this frame (drag zones of player 0) — predicted, since the passive aura / ult regen
    // heal on the same 0.5 s rhythm and heal events carry no source
    for (const z of w.state.zones) {
      if (z.ownerPlayer !== 0 || z.rt.ctx.slot !== 'drag') continue;
      if (!(z.rt.nextTick - DT <= 1e-6 && z.remaining - DT > 1e-6)) continue;
      const area = z.area ?? { shape: 'circle' as const, radius: z.radius };
      for (const eff of z.rt.action.effects) {
        if (eff.kind !== 'heal' || z.rt.action.affects !== 'allies') continue;
        for (const a of w.state.entities) {
          if (a.team !== 'ally' || !isAlive(a)) continue;
          if (!hitsArea(area, z.center, z.center, a.pos, a.radius)) continue;
          add('heal', Math.min(a.maxHp - a.hp, eff.amount * a.maxHp * z.rt.ctx.healMult));
        }
      }
    }

    // events from this frame's dispatch were read above; the scan below reads only what the tick adds
    const scanFrom = w.events.length;
    marks.clear();
    const hpBefore = new Map<number, number>();
    for (const e of s.entities) {
      if (e.team !== 'enemy' || !isAlive(e)) continue;
      const m = e.statuses.find(x => x.id === 'drain');
      if (m) marks.set(e.id, m as SimStatus);
      if (mixed) hpBefore.set(e.id, e.hp + e.shield);
    }

    tick(w);
    for (let i = scanFrom; i < w.events.length; i++) {
      const ev = w.events[i];
      if (ev.type === 'heal' && ev.from != null) drainHeal(ev.from, ev.amount);
      // mixed party: only X's drag hits (its own name) and its summons' bursts (only X leaves drag summons)
      else if (mixed && ev.type === 'damage' && ev.source === 'drag' && (ev.skillName === xDrag || ev.skillName === DEATH_ACTION_NAME)) {
        add('dmg', Math.min(ev.amount, hpBefore.get(ev.targetId) ?? ev.amount));
      }
    }
    w.events.length = 0;

    // drag damage (incl. burn ticks, delayed hits)
    if (!mixed) add('dmg', p.stats.damageBySource.drag - prevDrag);
    prevDrag = p.stats.damageBySource.drag;

    // 기획 12차: HP my drag summons (종이 인형) lost — hits that did not land on the party
    for (const e of s.entities) {
      if (e.kind === 'summon' && e.team === 'ally' && e.ownerPlayer === 0 && e.rt.summonSlot === 'drag' && !decoys.has(e.id)) decoys.set(e.id, { e, last: e.hp });
    }
    for (const [id, d] of decoys) {
      const dead = d.e.rt.gone || d.e.hp <= 0;
      const now = dead ? (d.e.hp <= 0 ? 0 : d.last) : d.e.hp;
      if (now < d.last) add('decoyHp', d.last - now);
      d.last = now;
      if (dead) decoys.delete(id);
    }

    // realised CC on enemies (statuses from my drag skill). Only time that actually kept an attack off us is priced
    // (balance critic, outcome ablation: most stunned / slowed seconds land on enemies still walking in):
    //   stun — the enemy is in range of the character it targets. 기획 4차: the attack timer is frozen during a stun
    //          (src/sim/units.ts), so every stunned second pushes all its later swings back by that second → S × DPS
    //          (2차 rule, timer kept running: only the seconds after the swing was due counted)
    //   slow — the enemy is in range of the character it targets (slow cuts attack speed by v), not stunned at the same time
    //   both priced at the enemy's DPS after that character's defence (= the HP it would have lost)
    for (const e of s.entities) {
      if (e.team !== 'enemy' || !isAlive(e)) continue;
      let stunned = false;
      for (const st of e.statuses as SimStatus[]) if (st.id === 'stun') stunned = true;
      const t = engagedTarget(w, e);
      for (const st of e.statuses as SimStatus[]) {
        if (st.sourcePlayer !== 0 || st.src !== 'drag') continue;
        if (st.id === 'stun' && !mixed) {
          add('stunSec', DT);
          if (t) {
            add('stunEngSec', DT);
            add('stunHp', DT * threatOn(w, e, t));
          }
        } else if (st.id === 'slow' && !mixed) {
          add('slowSec', st.value * DT);
          if (t && !stunned) add('slowHp', st.value * DT * threatOn(w, e, t));
        } else if (st.id === 'atkDown' && t && !stunned) {
          // 기획 12차 (퍼펫티어): effStats already has the cut in → the DPS it would have had is threat / (1 − v)
          add('atkDownHp', DT * threatOn(w, e, t) * (st.value / Math.max(0.1, 1 - st.value)));
        }
      }
    }

    // realised ally buffs (statuses from my drag skill on any player's field character)
    for (const q of s.players) {
      const dealt = q.stats.damageDealt - (q.id === 0 ? q.stats.damageBySource.drag : 0);
      const dDealt = dealt - prevDealt[q.id];
      const dBasic = q.stats.damageBySource.basic - prevBasic[q.id];
      const dTaken = q.stats.damageTaken - prevTaken[q.id];
      prevDealt[q.id] = dealt;
      prevBasic[q.id] = q.stats.damageBySource.basic;
      prevTaken[q.id] = q.stats.damageTaken;
      const e = activeEntity(w, q);
      if (!e || !isAlive(e) || mixed) continue;
      let buffed = false;
      // atk and attack-speed buffs multiply on basic attacks: extra = dealt × (1 − 1 / ((1 + a)(1 + h)))
      let a = 0;
      let h = 0;
      for (const st of e.statuses as SimStatus[]) {
        if (st.sourcePlayer !== 0 || st.src !== 'drag') continue;
        if (st.id === 'atkUp') {
          a = st.value;
          buffed = true;
        } else if (st.id === 'haste') {
          h = st.value;
          buffed = true;
        } else if (st.id === 'defUp') {
          const d = effStats(w, e).def;
          add('defHp', dTaken * (st.value / Math.max(0.1, 1 - d)));
          buffed = true;
        }
      }
      if (a > 0 || h > 0) {
        add('buffDmg', dBasic * (1 - 1 / ((1 + a) * (1 + h))) + Math.max(0, dDealt - dBasic) * (a / (1 + a)));
      }
      if (buffed) add('buffAllySec', DT);
    }

    // self shield actually absorbed
    for (let i = shields.length - 1; i >= 0; i--) {
      const L = shields[i];
      const e = getEntity(w, L.entityId);
      if (!e || !isAlive(e) || s.time > L.until || L.left <= 0) {
        shields.splice(i, 1);
        continue;
      }
      const drop = Math.max(0, L.prev - e.shield);
      const used = Math.min(drop, L.left);
      if (used > 0) add('shield', used);
      L.left -= used;
      L.prev = e.shield;
    }

    p.party.forEach((m, i) => {
      if (m.dead && !deadPrev[i]) acc.myDeaths++;
    });
    deadPrev = p.party.map(m => m.dead);
  }
  acc.floorsCleared += w.floorTimes.filter(f => f.outcome === 'clear' && f.floor <= FLOORS).length;
  acc.runs++;
  acc.simSec += s.time;
  acc.totalDmg += p.stats.damageDealt;
  for (const [k, v] of Object.entries(p.stats.damageBySource)) acc.bySrc[k] = (acc.bySrc[k] ?? 0) + v;
  for (const q of s.players) {
    acc.partyDealt += q.stats.damageDealt;
    acc.partyTaken += q.stats.damageTaken;
    acc.partyHealed += q.stats.healing;
  }
}

const r1 = (x: number) => Math.round(x * 10) / 10;
const r0 = (x: number) => Math.round(x);
const perCast = (c: DragComponents, n: number): DragComponents => {
  const o = zeroComponents();
  for (const k of Object.keys(o) as (keyof DragComponents)[]) o[k] = c[k] / Math.max(1, n);
  return o;
};

interface Result {
  char: string;
  name: string;
  aim: Policy;
  cd: number;
  casts: number;
  comp: DragComponents;
  perFloor: { floor: number; casts: number; comp: DragComponents }[];
  hitsPerCast: number;
  enemiesPerCast: number;
  alliesPerCast: number;
  acc: Acc;
}

const results: Result[] = [];
const cfRows: Record<string, unknown>[] = [];
const rows: Record<string, unknown>[] = [];
let lanchester = { dealt: 0, taken: 0, healed: 0 };
const t0 = Date.now();
for (const id of CHARS) {
  const def = getCharacter(id);
  for (const pol of POLICIES) {
    const acc = newAcc();
    for (let k = 0; k < SEEDS; k++) runOne(id, pol, 7001 + (SEED0 + k) * 104729, acc);
    const tot = acc.totalDmg || 1;
    results.push({
      char: id,
      name: def.name,
      aim: pol,
      cd: def.swapCooldown,
      casts: acc.casts,
      comp: perCast(acc.comp, acc.casts),
      perFloor: [...acc.perFloor.entries()].filter(([f]) => f <= FLOORS).sort((a, b) => a[0] - b[0]).map(([floor, b]) => ({ floor, casts: b.casts, comp: perCast(b.comp, b.casts) })),
      hitsPerCast: acc.hitsExec / Math.max(1, acc.casts),
      enemiesPerCast: acc.enemiesExec / Math.max(1, acc.casts),
      alliesPerCast: acc.allyHits / Math.max(1, acc.casts),
      acc,
    });
    if (pol === 'designer') {
      lanchester = { dealt: lanchester.dealt + acc.partyDealt, taken: lanchester.taken + acc.partyTaken, healed: lanchester.healed + acc.partyHealed };
    }
    rows.push({
      char: id,
      aim: pol,
      cd: def.swapCooldown,
      casts: acc.casts,
      secPerCast: r1(acc.simSec / Math.max(1, acc.casts)),
      hitsPerCast: r1(acc.hitsExec / Math.max(1, acc.casts)),
      alliesPerCast: r1(acc.allyHits / Math.max(1, acc.casts)),
      dragPerCast: r0(acc.comp.dmg / Math.max(1, acc.casts)),
      dragPct: r1((100 * (acc.bySrc.drag ?? 0)) / tot),
      basicPct: r1((100 * (acc.bySrc.basic ?? 0)) / tot),
      normalPct: r1((100 * (acc.bySrc.normal ?? 0)) / tot),
      ultPct: r1((100 * (acc.bySrc.ult ?? 0)) / tot),
      dpm: r0(acc.totalDmg / Math.max(1, acc.simSec / 60)),
      floors: r1(acc.floorsCleared / acc.runs),
      wipes: acc.wipes,
      myDeaths: r1(acc.myDeaths / acc.runs),
    });
    if (pol === POLICIES[0]) {
      cfRows.push({
        char: id,
        shape: def.drag.name,
        best: r1(acc.cf.best / Math.max(1, acc.cfN)),
        designer: r1(acc.cf.designer / Math.max(1, acc.cfN)),
        naive: r1(acc.cf.naive / Math.max(1, acc.cfN)),
        self: r1(acc.cf.self / Math.max(1, acc.cfN)),
        naiveUnderHalfPct: r1((100 * acc.naiveUnderHalf) / Math.max(1, acc.cfN)),
        n: acc.cfN,
      });
    }
  }
  console.error(`${id} done ${((Date.now() - t0) / 1000).toFixed(0)} s`);
}

// value per cooldown-second; the 크로노 cooldown cut is priced at the mean of the OTHER skills (same aim policy)
function valueTable(pol: Policy, wt = VALUE_WEIGHTS) {
  const rs = results.filter(r => r.aim === pol);
  const base = rs.map(r => ({ r, v: valueOf(r.comp, 0, wt) }));
  const others = base.filter(x => x.r.comp.cdSec < 1e-6);
  const meanVps = others.reduce((a, x) => a + x.v.total / x.r.cd, 0) / Math.max(1, others.length);
  const vals = rs.map(r => ({ r, v: valueOf(r.comp, meanVps, wt) }));
  const allMean = vals.reduce((a, x) => a + x.v.total / x.r.cd, 0) / Math.max(1, vals.length);
  return { meanVps, allMean, vals };
}

const summary: Record<string, unknown> = { seeds: SEEDS, floors: FLOORS, swapEvery: SWAP_EVERY, party: PARTY, weights: VALUE_WEIGHTS };
for (const pol of POLICIES) {
  const { meanVps, allMean, vals } = valueTable(pol);
  const table = vals.map(({ r, v }) => ({
    char: r.char,
    cd: r.cd,
    hits: r1(r.enemiesPerCast),
    allies: r1(r.alliesPerCast),
    dmg: r0(r.comp.dmg),
    stunS: r1(r.comp.stunSec),
    stunEngS: r1(r.comp.stunEngSec),
    stunHp: r0(r.comp.stunHp),
    slowS: r1(r.comp.slowSec),
    slowHp: r0(r.comp.slowHp),
    disp: r1(r.comp.dispUnits),
    heal: r0(r.comp.heal),
    shieldG: r0(r.comp.shieldGranted),
    shield: r0(r.comp.shield),
    defHp: r0(r.comp.defHp),
    buffAllyS: r1(r.comp.buffAllySec),
    buffDmg: r0(r.comp.buffDmg),
    cdSec: r1(r.comp.cdSec),
    benchH: r0(r.comp.benchHealHp),
    drainH: r0(r.comp.drainHealHp),
    decoy: r0(r.comp.decoyHp),
    atkDnHp: r0(r.comp.atkDownHp),
    vDmg: r0(v.damage),
    vCC: r0(v.cc),
    vSup: r0(v.support),
    vSpec: r0(v.special),
    value: r0(v.total),
    perSec: r1(v.total / r.cd),
    vsMean: `${Math.round((100 * v.total) / r.cd / allMean)}%`,
  }));
  console.log(`=== value per cast [aim=${pol}] (weights: ${JSON.stringify(VALUE_WEIGHTS)}; cd-cut priced at ${r1(meanVps)}/s) ===`);
  console.table(table);
  const spread = vals.map(x => x.v.total / x.r.cd / allMean);
  console.log(`value/sec mean ${r1(allMean)}, min ${Math.round(100 * Math.min(...spread))}%, max ${Math.round(100 * Math.max(...spread))}%`);
  summary[pol] = { meanVps, allMean, table };
  if (pol === 'designer' && !QUIET) {
    const fl: Record<string, unknown>[] = [];
    for (const { r } of vals) {
      const row: Record<string, unknown> = { char: r.char };
      for (const f of r.perFloor) {
        const v = valueOf(f.comp, meanVps);
        row[`F${f.floor}`] = `${r0(v.total)} (${r0(f.comp.dmg)}d/${f.casts})`;
      }
      fl.push(row);
    }
    console.log('=== designer aim: value per cast by floor — "value (raw damage d / casts)"; F1–F4 normal floors incl. mid boss, F5 boss ===');
    console.table(fl);
    summary.perFloor = fl;
  }
}
// sensitivity: the same measurements under other weights (value/sec as % of the roster mean, designer aim)
if (POLICIES.includes('designer')) {
  const variants: [string, Partial<typeof VALUE_WEIGHTS>][] = [
    ['base', {}],
    ['hp×0.5', { hp: VALUE_WEIGHTS.hp * 0.5 }],
    ['hp×1.5', { hp: VALUE_WEIGHTS.hp * 1.5 }],
    ['cc×0.5', { stun: VALUE_WEIGHTS.stun * 0.5, slow: VALUE_WEIGHTS.slow * 0.5, displace: VALUE_WEIGHTS.displace * 0.5 }],
    ['cc×1.5', { stun: VALUE_WEIGHTS.stun * 1.5, slow: VALUE_WEIGHTS.slow * 1.5, displace: VALUE_WEIGHTS.displace * 1.5 }],
    ['buff×0.5', { buff: VALUE_WEIGHTS.buff * 0.5 }],
    ['cdSec 0', { cdSec: 0 }],
    ['cdSec 1', { cdSec: 1 }],
  ];
  const sens: Record<string, Record<string, string>> = {};
  for (const [name, patch] of variants) {
    const { allMean, vals } = valueTable('designer', { ...VALUE_WEIGHTS, ...patch });
    for (const { r, v } of vals) (sens[r.char] ??= {})[name] = `${Math.round((100 * v.total) / r.cd / allMean)}%`;
  }
  console.log('=== sensitivity (designer aim): value/sec as % of roster mean under other weights ===');
  console.table(sens);
  summary.sensitivity = sens;
}
console.log(
  `party (all 3 players, designer runs): dealt ${r0(lanchester.dealt)}, taken ${r0(lanchester.taken)}, healed ${r0(lanchester.healed)} → dealt/taken ${r1(lanchester.dealt / Math.max(1, lanchester.taken))}`,
);
summary.lanchester = lanchester;
if (!QUIET) {
  console.log('=== executed aim policy → outcome (player 0 = same character ×3, swap every', SWAP_EVERY, 's) ===');
  console.table(rows);
  console.log('=== counterfactual footprint score at the same decision points (enemies in footprint; mid ×2, boss ×3; cleric = allies) ===');
  console.table(cfRows);
}
summary.rows = rows;
summary.cfRows = cfRows;
if (env.BENCH_OUT) {
  fs.writeFileSync(env.BENCH_OUT, JSON.stringify(summary, null, 1));
}
