// One headless bench run over the real sim (no rendering), shared by the drag bench (drag-bench.ts) and the 기획 13차
// ult bench (ult-bench.ts): player 0 plays a fixed rhythm (swap every SWAP_EVERY s to an aimed spot, ult 0.5 s after
// full, no pets) and every effect of ONE skill slot (drag or ult) of the measured character is priced in
// DragComponents (drag-value.ts weighs them). Players 1–2 = the stock bots. Floor rewards: the drag-neutral pick.
//
// Attribution (기획 13차 리뉴얼: most effects now land later than the swap tick):
//   damage        p0's damageBySource[slot] (incl. charm hits and the stasis rebound, both credited to the caster)
//   heals         the measured skill's heal / healPerHit / benchHeal amounts are read through getters that mark the
//                 event index the heal is about to emit; p0's stats.healing setter confirms the heal was p0's
//                 (a bot with the same character reads the same getter, but credits its own player)
//   shields       the measured skill's shield (and overflow-shield heal) getters flag the frame; shields that grew
//                 on allies in that frame go into a ledger and count as they are actually absorbed
//   statuses      src = slot and sourcePlayer = 0 (stun / stasis / slow / atkDown / taunt / charm / vulnerable on
//                 enemies, atkUp / haste / defUp / regen on allies incl. bench cards that carry them in)
//   cooldown cut  'swapCdCut' from p0 (ult: every player's bench, realised = min(cooldown left, cut)); revive cut
//                 seconds from 'reviveCut'

import { BOT_PRESETS, DEFAULT_TUNABLES, TICK_RATE, VIEW_WIDTH_UNITS } from '../../src/config';
import { getCharacter } from '../../src/data';
import { bestDropPoint } from '../../src/sim/bot';
import { createGameWithWorld, dispatch, tick } from '../../src/sim/game';
import { hitsArea } from '../../src/sim/geometry';
import { canSwap } from '../../src/sim/players';
import { DEATH_ACTION_NAME } from '../../src/sim/ondeath';
import { previewPartsFor } from '../../src/sim/preview';
import { effStats } from '../../src/sim/stats';
import { activeEntity, clampToArena, edgeDist, getEntity, isAlive, type SimEntity, type SimStatus, type World } from '../../src/sim/world';
import type { BossDef, Effect, GameEvent, PlayerSetup, PreviewPart, SkillAction, Vec2 } from '../../src/types';
import { dragNeutralPick, zeroComponents, type DragComponents } from './drag-value';
import { goedamPilot, goedamTunables, type GoedamPolicy } from './goedam-policy';

export type Policy = 'best' | 'designer' | 'naive' | 'self';
export type Slot = 'drag' | 'ult';
export type Party = 'same' | 'mixed1' | 'mixed2';

export interface BenchOpts {
  slot: Slot;
  floors: number;
  swapEvery: number;
  party: Party;
  goedam: GoedamPolicy;
}

const MIXED: Record<string, string[]> = { mixed1: ['blade', 'mage'], mixed2: ['guardian', 'ranger'] };
const DT = 1 / TICK_RATE;

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

export interface Acc {
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

export const newAcc = (): Acc => ({
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

/** 기획 13차 charm: would this enemy be hitting one of us (an ally character within its reach)? */
function wouldEngage(w: World, e: SimEntity): SimEntity | null {
  let best: SimEntity | null = null;
  let bd = Infinity;
  for (const a of w.state.entities) {
    if (a.team !== 'ally' || a.kind !== 'character' || !isAlive(a)) continue;
    const d = edgeDist(e, a);
    if (d < bd) {
      bd = d;
      best = a;
    }
  }
  return best && bd <= e.rt.base.range + 0.5 ? best : null;
}

/** 기획 13차 taunt: HP kept = the taunted enemy's DPS × (taunter's defence − the other field characters' mean). */
function tauntGain(w: World, e: SimEntity, t: SimEntity): number {
  const others = w.state.entities.filter(a => a.team === 'ally' && a.kind === 'character' && isAlive(a) && a.id !== t.id);
  if (!others.length) return 0;
  const ref = others.reduce((s, a) => s + effStats(w, a).def, 0) / others.length;
  return threat(w, e) * Math.max(0, effStats(w, t).def - ref);
}

/** Self / ally shield granted by one cast, tracked until it is used up / expires / the unit leaves. */
interface ShieldLedger {
  entityId: number;
  left: number;
  until: number;
}

/**
 * Getter marks on the measured skill's effects: which event index a heal is about to emit, whether a shield was
 * touched this frame, and from which index a bench heal starts (all reset every frame).
 */
interface Marks {
  heal: number;
  bench: number | null;
  shieldTouched: boolean;
  mine: Set<number>;
}

const wrapped = new WeakSet<object>();

function wrapAmount(obj: { amount: number }, onRead: () => void): void {
  if (wrapped.has(obj)) return;
  wrapped.add(obj);
  const val = obj.amount;
  Object.defineProperty(obj, 'amount', {
    enumerable: true,
    configurable: true,
    get() {
      onRead();
      return val;
    },
  });
}

/**
 * Getter marks on every heal / shield / bench-heal amount of a skill's actions. They mark only while that skill is the
 * one being measured (a bot may play an earlier-measured character in a later run).
 */
function markSkill(skillId: string, actions: readonly SkillAction[], m: Marks): void {
  const live = () => CUR != null && ACTIVE === skillId;
  const evLen = () => CUR?.events.length ?? 0;
  for (const a of actions) {
    if (a.healPerHit) wrapAmount(a.healPerHit, () => live() && (m.heal = evLen()));
    for (const e of a.effects as Effect[]) {
      if (e.kind === 'heal')
        wrapAmount(e, () => {
          if (!live()) return;
          m.heal = evLen();
          if (e.overflowShield) m.shieldTouched = true;
        });
      else if (e.kind === 'shield') wrapAmount(e, () => live() && (m.shieldTouched = true));
      else if (e.kind === 'benchHeal') wrapAmount(e, () => live() && (m.bench = evLen()));
    }
  }
}
let CUR: World | null = null;
let ACTIVE: string | null = null;
const MARKS: Marks = { heal: -1, bench: null, shieldTouched: false, mine: new Set() };
let SLOT: Slot = 'drag';

/** A heal p0 got through a lifesteal the measured skill gave (버서커 혈귀 강림). */
function lifestealHeal(w: World, ev: GameEvent | undefined): boolean {
  if (ev?.type !== 'heal' || ev.from != null) return false;
  const t = getEntity(w, ev.targetId);
  return !!t && (t.statuses as SimStatus[]).some(x => x.id === 'lifesteal' && x.sourcePlayer === 0 && x.src === SLOT);
}

/** p0's healing counter as an accessor: a write right after the marked heal / bench heal confirms it was p0's. */
function watchHealing(w: World, pi: number): void {
  const st = w.state.players[pi].stats;
  let v = st.healing;
  Object.defineProperty(st, 'healing', {
    enumerable: true,
    configurable: true,
    get: () => v,
    set: (nv: number) => {
      v = nv;
      const last = w.events.length - 1;
      if (MARKS.heal === last && w.events[last]?.type === 'heal') MARKS.mine.add(last);
      else if (lifestealHeal(w, w.events[last])) MARKS.mine.add(last);
      if (MARKS.bench != null) for (let i = MARKS.bench; i <= last; i++) if (w.events[i].type === 'benchHeal') MARKS.mine.add(i);
      MARKS.bench = null;
    },
  });
}

const markedFor = new Set<string>();

/**
 * BENCH_PATCH (tuning sweeps without editing the data): [[charId, 'drag' | 'ult', stage | '*', '*1.3' | 2.1, kind?]] —
 * multiplies (or sets) the amount of every `kind` effect (default 'damage') of that skill's actions with that stage.
 * kind 'benchStatus' / 'status' patch `value` ('status:haste' = only that status), 'shield' / 'heal' / 'benchHeal' patch `amount`, 'duration' patches status
 * durations, 'inheritHp' the summon's inherited HP share, 'healPerHit' its amount. Applied once, before any run.
 */
export function applyBenchPatch(raw: string | undefined): void {
  if (!raw) return;
  for (const [charId, slot, stage, v, kind = 'damage'] of JSON.parse(raw) as [string, Slot, string, number | string, string?][]) {
    const sk = getCharacter(charId)[slot];
    const set = (x: number) => (typeof v === 'string' && v.startsWith('*') ? x * Number(v.slice(1)) : Number(v));
    let n = 0;
    for (const a of sk.actions) {
      if (stage !== '*' && a.stage !== stage) continue;
      if (kind === 'healPerHit' && a.healPerHit) {
        a.healPerHit.amount = set(a.healPerHit.amount);
        n++;
        continue;
      }
      if (kind === 'inheritHp' && a.summon?.inherit) {
        a.summon.inherit.hp = set(a.summon.inherit.hp);
        n++;
        continue;
      }
      for (const e of a.effects as (Effect & { amount?: number; value?: number; duration?: number })[]) {
        const [k, only] = kind.split(':');
        if (only && (e as { status?: string }).status !== only) continue;
        if (k === 'duration' && (e.kind === 'status' || e.kind === 'benchStatus')) e.duration = set(e.duration!);
        else if (e.kind !== k) continue;
        else if (e.kind === 'status' || e.kind === 'benchStatus') e.value = set(e.value!);
        else if (e.amount != null) e.amount = set(e.amount);
        else continue;
        n++;
      }
    }
    if (!n) throw new Error(`BENCH_PATCH: nothing matched ${charId}.${slot}.${stage}.${kind}`);
  }
}

export function runOne(charId: string, policy: Policy, seed: number, acc: Acc, o: BenchOpts): void {
  const def = getCharacter(charId);
  const skill = o.slot === 'drag' ? def.drag : def.ult;
  if (!markedFor.has(skill.id)) {
    markedFor.add(skill.id);
    markSkill(skill.id, skill.actions, MARKS);
  }
  ACTIVE = skill.id;
  SLOT = o.slot;
  const party = o.party === 'same' ? [charId, charId, charId] : [charId, ...MIXED[o.party]];
  const mixed = o.party !== 'same';
  // mixed party: a status counts unless a partner's same-slot skill can apply it too (then it cannot be told apart)
  const shared = mixed ? partnerStatuses(MIXED[o.party], o.slot) : new Set<string>();
  const human: PlayerSetup = { name: '나', isBot: false, characters: party, pets: ['frog_bomb', 'fairy_heal', 'cat_void'] };
  const players: PlayerSetup[] = [human, ...BOT_PRESETS.map(b => ({ name: b.name, isBot: true, characters: [...b.characters], pets: [...b.pets] }))];
  // 기획 12차: 돌발 괴담 off — the skill numbers are measured on plain floors (docs/balance.md 11장)
  const { world: w } = createGameWithWorld({ seed, players, tunables: { ...DEFAULT_TUNABLES, fieldEventChance: 0, ...goedamTunables(o.goedam) } });
  CUR = w;
  watchHealing(w, 0);
  const s = w.state;
  const p = s.players[0];
  const pilot = goedamPilot(w, o.goedam);
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
    if (m && m.sourcePlayer === 0 && m.src === o.slot) add('drainHealHp', amount);
  };
  const decoys = new Map<number, { e: SimEntity; last: number }>();
  const xName = skill.name;
  const shields: ShieldLedger[] = [];
  const shieldDur = skill.actions
    .flatMap(a => a.effects)
    .reduce((d, e) => (e.kind === 'shield' ? Math.max(d, e.duration) : e.kind === 'heal' && e.overflowShield ? Math.max(d, e.overflowShield.duration) : d), 0);
  // per-player running totals (buff attribution)
  const prevDealt = s.players.map(q => q.stats.damageDealt - (q.id === 0 ? q.stats.damageBySource[o.slot] : 0));
  const prevBasic = s.players.map(q => q.stats.damageBySource.basic);
  const prevTaken = s.players.map(q => q.stats.damageTaken);
  let prevSlotDmg = p.stats.damageBySource[o.slot];
  const shieldPrev = new Map<number, number>();
  let shieldBefore = new Map<number, number>();
  const snapShields = () => {
    shieldBefore = new Map(s.entities.filter(e => e.team === 'ally' && isAlive(e)).map(e => [e.id, e.shield]));
  };
  /** Shields that grew on allies since the snapshot, if the measured skill touched a shield. */
  const ledgerShields = () => {
    if (!MARKS.shieldTouched) return;
    MARKS.shieldTouched = false;
    for (const e of s.entities) {
      if (e.team !== 'ally' || !isAlive(e)) continue;
      const granted = e.shield - (shieldBefore.get(e.id) ?? 0);
      if (granted > 1e-6) {
        add('shieldGranted', granted);
        shields.push({ entityId: e.id, left: granted, until: s.time + shieldDur });
        // the grant is not a drop: absorption is measured from the shield right after it
        shieldPrev.set(e.id, (shieldPrev.get(e.id) ?? e.shield - granted) + granted);
      }
    }
  };

  for (let t = 0; t < maxTicks; t++) {
    // (player 0 out → no reward phase for it: the sim moves on by itself, so also stop on the floor number)
    if (s.floor > o.floors) break;
    if (s.phase === 'reward') {
      if (s.floor >= o.floors) break;
      pilot.settle([0], dragNeutralPick);
      lastSwap = -99;
      continue;
    }
    if (s.phase === 'runOver') {
      if (s.runResult?.reason === 'wipe') acc.wipes++;
      break;
    }
    MARKS.heal = -1;
    MARKS.bench = null;
    MARKS.mine.clear();
    snapShields();
    const benchCdAll = s.players.map(q => q.party.map(m => m.swapCooldownRemaining));
    think -= DT;
    if (think <= 0 && s.phase === 'combat' && !p.out) {
      think = 0.25;
      const me = activeEntity(w, p);
      const foes = s.entities.filter(e => e.team === 'enemy' && isAlive(e));
      if (p.ult.charge >= 1 && me && foes.length) {
        if (ultAt == null) ultAt = s.time + 0.5;
        const mineUlt = !mixed || me.defId === charId;
        if (s.time >= ultAt && dispatch(w, { type: 'ult', player: 0 }).ok) {
          ultAt = null;
          if (o.slot === 'ult' && mineUlt) {
            acc.casts++;
            floorBucket().casts++;
          }
        }
      }
      const ready = [0, 1, 2].filter(i => canSwap(w, 0, i).ok);
      const due = (s.time - lastSwap >= o.swapEvery || !me) && (foes.length > 0 || !me);
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
        const measured = o.slot === 'drag' && (!mixed || p.party[idx].defId === charId);
        const sc = {} as Record<Policy, number>;
        for (const k of Object.keys(cand) as Policy[]) sc[k] = score(parts, cand[k], pool, affects);
        if (pool.length && measured) {
          acc.cfN++;
          for (const k of Object.keys(cand) as Policy[]) acc.cf[k] += sc[k];
          if (sc.best > 0 && sc.naive < sc.best / 2) acc.naiveUnderHalf++;
        }
        // snapshot for the instant parts (pull / knockback / cooldown cut)
        const enemyPos = new Map(foes.map(e => [e.id, { x: e.pos.x, y: e.pos.y }]));
        const benchCd = p.party.map(m => m.swapCooldownRemaining);
        const leaving = p.activeIndex;
        const enemiesInFoot = score(parts, cand[policy], foes, 'enemies', false);
        const dragBefore = p.stats.damageBySource.drag;
        const swapped = dispatch(w, { type: 'swap', player: 0, partyIndex: idx, pos: cand[policy] }).ok;
        if (swapped) {
          lastSwap = s.time;
          card = idx;
        }
        if (swapped && measured) {
          if (mixed) add('dmg', p.stats.damageBySource.drag - dragBefore);
          acc.casts++;
          floorBucket().casts++;
          acc.hitsExec += sc[policy];
          acc.enemiesExec += enemiesInFoot;
          if (parts.some(pt => pt.affects === 'allies')) acc.allyHits += score(parts, cand[policy], allyChars, 'allies');
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
        }
      }
    }
    // shields the dispatches above granted
    ledgerShields();
    snapShields();

    marks.clear();
    const hpBefore = new Map<number, number>();
    const vuln = new Map<number, number>();
    for (const e of s.entities) {
      if (e.team !== 'enemy' || !isAlive(e)) continue;
      const m = e.statuses.find(x => x.id === 'drain');
      if (m) marks.set(e.id, m as SimStatus);
      hpBefore.set(e.id, e.hp + e.shield);
      const v = (e.statuses as SimStatus[]).find(x => x.id === 'vulnerable' && x.sourcePlayer === 0 && x.src === o.slot);
      if (v && !shared.has('vulnerable')) vuln.set(e.id, v.value);
    }
    if (!shared.has('regen')) regenHeal(w, o.slot, add);

    const tickFrom = w.events.length;
    tick(w);
    ledgerShields();
    scanFrame(w, o, xName, mixed, { add, drainHeal, hpBefore, vuln, benchCdAll, tickFrom });
    w.events.length = 0;

    // skill damage (incl. burn ticks, delayed hits, charm hits, stasis rebound)
    if (!mixed) add('dmg', p.stats.damageBySource[o.slot] - prevSlotDmg);
    prevSlotDmg = p.stats.damageBySource[o.slot];

    // 기획 12차: HP my drag summons (종이 인형) lost — hits that did not land on the party
    for (const e of s.entities) {
      if (e.kind === 'summon' && e.team === 'ally' && e.ownerPlayer === 0 && e.rt.summonSlot === o.slot && !decoys.has(e.id)) decoys.set(e.id, { e, last: e.hp });
    }
    for (const [id, d] of decoys) {
      const dead = d.e.rt.gone || d.e.hp <= 0;
      const now = dead ? (d.e.hp <= 0 ? 0 : d.last) : d.e.hp;
      if (now < d.last) add('decoyHp', d.last - now);
      d.last = now;
      if (dead) decoys.delete(id);
    }

    enemyControl(w, o.slot, shared, add);
    allyBuffs(w, o.slot, shared, add, { prevDealt, prevBasic, prevTaken });
    absorbShields(w, shields, shieldPrev, add);

    p.party.forEach((m, i) => {
      if (m.dead && !deadPrev[i]) acc.myDeaths++;
    });
    deadPrev = p.party.map(m => m.dead);
  }
  CUR = null;
  ACTIVE = null;
  acc.floorsCleared += w.floorTimes.filter(f => f.outcome === 'clear' && f.floor <= o.floors).length;
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

type Add = (k: keyof DragComponents, v: number) => void;

/** Status ids the partners' same-slot skills apply (on anyone, incl. bench statuses). */
function partnerStatuses(ids: readonly string[], slot: Slot): Set<string> {
  const out = new Set<string>();
  for (const id of ids)
    for (const a of getCharacter(id)[slot].actions) for (const e of a.effects) if (e.kind === 'status' || e.kind === 'benchStatus') out.add(e.status);
  return out;
}

/** Regen from the measured skill on allies (메딕 주사, 클레릭·바드 궁극기): the HP it restores this tick, no overheal. */
function regenHeal(w: World, slot: Slot, add: Add): void {
  for (const a of w.state.entities) {
    if (a.team !== 'ally' || !isAlive(a)) continue;
    const r = (a.statuses as SimStatus[]).find(x => x.id === 'regen' && x.sourcePlayer === 0 && x.src === slot);
    if (r) add('heal', Math.min(a.maxHp - a.hp, r.value * a.maxHp * DT));
  }
}

/**
 * Everything the frame's events tell (dispatches + tick): marked heals / bench heals, 흡혼 heals, decoy-free damage in
 * mixed parties, extra damage others dealt to enemies my skill made vulnerable, revive cuts, ult cooldown cuts.
 */
function scanFrame(
  w: World,
  o: BenchOpts,
  xName: string,
  mixed: boolean,
  c: { add: Add; drainHeal: (from: number, amount: number) => void; hpBefore: Map<number, number>; vuln: Map<number, number>; benchCdAll: number[][]; tickFrom: number },
): void {
  const cutPlayers = new Map<number, number>();
  w.events.forEach((ev: GameEvent, i) => {
    // (healPerHit heals carry the enemy hit as `from` too: the mark decides first)
    if (ev.type === 'heal' && MARKS.mine.has(i)) c.add('heal', ev.amount);
    else if (ev.type === 'heal' && ev.from != null) c.drainHeal(ev.from, ev.amount);
    else if (ev.type === 'benchHeal' && MARKS.mine.has(i)) c.add('benchHealHp', ev.amount);
    else if (ev.type === 'reviveCut' && ev.from === 0 && o.slot === 'ult') c.add('reviveSec', ev.seconds);
    else if (ev.type === 'swapCdCut' && ev.from === 0 && o.slot === 'ult') cutPlayers.set(ev.player, ev.seconds);
    else if (ev.type === 'damage' && ev.targetTeam === 'enemy') {
      const ownHit = ev.source === o.slot && (ev.skillName === xName || ev.skillName === DEATH_ACTION_NAME);
      // mixed party: only X's hits (its own name) and its summons' bursts (only X leaves drag summons); the swap's own
      // hits were counted from the stats at the dispatch
      if (mixed && ownHit && i >= c.tickFrom) c.add('dmg', Math.min(ev.amount, c.hpBefore.get(ev.targetId) ?? ev.amount));
      const v = c.vuln.get(ev.targetId);
      if (v != null && !ownHit) c.add('vulnDmg', Math.min(ev.amount, c.hpBefore.get(ev.targetId) ?? ev.amount) * (v / (1 + v)));
    }
  });
  for (const [pi, sec] of cutPlayers) {
    const q = w.state.players[pi];
    q.party.forEach((m, i) => {
      if (i !== q.activeIndex) c.add('cdSec', Math.min(c.benchCdAll[pi][i] ?? 0, sec));
    });
  }
}

/**
 * Realised control on enemies from the measured skill. Only time that actually kept an attack off us is priced
 * (balance critic, outcome ablation: most stunned / slowed seconds land on enemies still walking in):
 *   stun / stasis — the enemy is in range of the character it targets. 기획 4차: the attack timer is frozen during a
 *          stun (src/sim/units.ts), so every stunned second pushes all its later swings back by that second → S × DPS
 *   slow — the enemy is in range of the character it targets (slow cuts attack speed by v), not stunned at the same time
 *   taunt — engaged on its taunter: DPS × the taunter's extra defence (tauntGain)
 *   charm — it would be hitting one of us (wouldEngage) but hits its own side: its full DPS
 *   root / tether — seconds only (priced 0 like pull / knockback: enemies in reach keep hitting)
 */
function enemyControl(w: World, slot: Slot, shared: ReadonlySet<string>, add: Add): void {
  for (const e of w.state.entities) {
    if (e.team !== 'enemy' || !isAlive(e)) continue;
    let stunned = false;
    for (const st of e.statuses as SimStatus[]) if (st.id === 'stun' || st.id === 'stasis') stunned = true;
    const t = engagedTarget(w, e);
    for (const st of e.statuses as SimStatus[]) {
      if (st.sourcePlayer !== 0 || st.src !== slot || shared.has(st.id)) continue;
      if (st.id === 'atkDown') {
        // 기획 12차 (퍼펫티어): effStats already has the cut in → the DPS it would have had is threat / (1 − v)
        if (t && !stunned) add('atkDownHp', DT * threatOn(w, e, t) * (st.value / Math.max(0.1, 1 - st.value)));
      } else if (st.id === 'stun' || st.id === 'stasis') {
        add('stunSec', DT);
        if (t) {
          add('stunEngSec', DT);
          add('stunHp', DT * threatOn(w, e, t));
        }
      } else if (st.id === 'slow') {
        add('slowSec', st.value * DT);
        if (t && !stunned) add('slowHp', st.value * DT * threatOn(w, e, t));
      } else if (st.id === 'taunt') {
        add('tauntSec', DT);
        if (t && !stunned) add('tauntHp', DT * tauntGain(w, e, t));
      } else if (st.id === 'charm') {
        const would = wouldEngage(w, e);
        if (would && !stunned) add('charmHp', DT * threatOn(w, e, would));
      } else if (st.id === 'root' || st.id === 'tether') {
        add('holdSec', DT);
      }
    }
  }
}

/** Realised ally buffs (statuses from the measured skill on any player's field character, incl. bench-carried ones). */
function allyBuffs(w: World, slot: Slot, shared: ReadonlySet<string>, add: Add, prev: { prevDealt: number[]; prevBasic: number[]; prevTaken: number[] }): void {
  for (const q of w.state.players) {
    const dealt = q.stats.damageDealt - (q.id === 0 ? q.stats.damageBySource[slot] : 0);
    const dDealt = dealt - prev.prevDealt[q.id];
    const dBasic = q.stats.damageBySource.basic - prev.prevBasic[q.id];
    const dTaken = q.stats.damageTaken - prev.prevTaken[q.id];
    prev.prevDealt[q.id] = dealt;
    prev.prevBasic[q.id] = q.stats.damageBySource.basic;
    prev.prevTaken[q.id] = q.stats.damageTaken;
    const e = activeEntity(w, q);
    if (!e || !isAlive(e)) continue;
    let buffed = false;
    // atk and attack-speed buffs multiply on basic attacks: extra = dealt × (1 − 1 / ((1 + a)(1 + h)))
    let a = 0;
    let h = 0;
    for (const st of e.statuses as SimStatus[]) {
      if (st.sourcePlayer !== 0 || st.src !== slot || shared.has(st.id)) continue;
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
    if (a > 0 || h > 0) add('buffDmg', dBasic * (1 - 1 / ((1 + a) * (1 + h))) + Math.max(0, dDealt - dBasic) * (a / (1 + a)));
    if (buffed) add('buffAllySec', DT);
  }
}

/** Shield actually absorbed: each unit's drop this tick goes to its oldest ledger entries first. */
function absorbShields(w: World, shields: ShieldLedger[], prevOf: Map<number, number>, add: Add): void {
  const s = w.state;
  for (let i = shields.length - 1; i >= 0; i--) {
    const L = shields[i];
    const e = getEntity(w, L.entityId);
    if (!e || !isAlive(e) || s.time > L.until || L.left <= 0) shields.splice(i, 1);
  }
  const ids = new Set(shields.map(L => L.entityId));
  for (const id of ids) {
    const e = getEntity(w, id)!;
    let drop = Math.max(0, (prevOf.get(id) ?? e.shield) - e.shield);
    for (const L of shields) {
      if (L.entityId !== id || drop <= 0) continue;
      const used = Math.min(drop, L.left);
      L.left -= used;
      drop -= used;
      add('shield', used);
    }
  }
  prevOf.clear();
  for (const id of ids) prevOf.set(id, getEntity(w, id)!.shield);
}
