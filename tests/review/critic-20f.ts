// 기획 8차 critic: independent 20-floor sweeps over the real sim (no rendering), with per-mechanic telemetry.
// Run: npx vite-node tests/review/critic-20f.ts   (all knobs via env, output = one JSON object on stdout)
//
//   RUNS=40 FLOORS=20 START=1 SEED0=1000
//   POLICY=active|dodge|dodgeonly|bot|botseat|idle    player-0 (or every human, HUMANS=n) behaviour
//       active = balance.ts "직접 교체": swap every ~4 s to the best drag spot, pets on clusters, ult 0.5 s after full
//       dodge  = active + swaps OUT of an enemy telegraph about to land on the field character (only telegraphs that
//                were visible ≥ REACT s — a skilled phone player; tells which damage is avoidable at all)
//       dodgeonly = dodge without the 4 s rhythm (swaps only to dodge / at low HP / empty field): avoidability ceiling
//       botseat = a human seat (the harness picks its rewards — random like a bot — and its 괴담 rooms) whose swaps,
//                pets and ult come from the stock bot AI: the bot-style player for room policies ('bot' always leaves)
//       궁극기 개별 게이지 (the rule since 기획 15차; the ult sliders via TUN='{"ultFieldChargeTime":30,"ultBenchRatio":0.33}'):
//       the active seats play it sensibly:
//         · ult: the FIELD character's own gauge, 0.5 s after full.
//         · (1) hold — a field character whose own gauge is ≥ ULT_HOLD full is not rotated out by the 4 s rhythm until
//           it has cast (low HP / dodge still swap); (2) ult swap-in — when the field gauge is below ULT_HOLD and a
//           swappable bench card's own gauge is full in a fight worth an ult (boss / mid boss alive or
//           ≥ BOT.ultSwapEnemies enemies, the bots' rule), swap it in at once (no 4 s wait) and cast 0.5 s later.
//       Seat report 'seat' (POLICY seats only): swaps / min, ults per run and per 10 combat min, swaps into a full-ult
//       bench card, empty-field time, and 'blocked' = the seat wanted a swap (rhythm due, low HP, empty field; bots:
//       their own timers) but no living bench card was off cooldown.
//   REACT=0.6                       dodge reaction time (s)
//   COMP=default|melee|ranged|support|notank|tank   party compositions (all 3 players, see COMPS)
//   HCOMP=ranger,mage,gunner        player 0 only (others keep COMP) — solo player picking a party
//   HUMANS=1                        how many of the 3 players use POLICY (rest = sim bots)
//   TUN='{"maxAliveMonsters":30}'   tunables override
//   PATCH='[["red_mask.skills.0.action.delay",0.7],["ZONES.3.waveSize.max",5],["LATE.factor",0.5],["head_nurse.stats.maxHp","*0.9"]]'
//                                   data edits applied before the run (value "*x" multiplies); first segment = a
//                                   monster/boss/character id, a 돌발 괴담 id or event unit id (기획 12차: e.g.
//                                   ["lucky_toad.reward.value",0] = the event without its reward), or ZONES / LATE (LATE_STAT_GROWTH)
//                                   (기획 16차: waves per normal floor = ["ZONES.0.waves",4] — the old WAVES / FLOOR_WAVES is gone)
//   DETAIL=1                        also print per-floor top damage sources / killers
//   GOEDAM=leave                    기획 10차 괴담 room policy for the humans: off|leave|random|first|greedy|forced:<room>:<opt>
//                                   (tests/playtest/goedam-policy.ts; START > 1 forces off). Output 'goedam' = room report.
//   GOEDAM_DUMP=/path.json          also write one row per run (seed, victory, death floor, player 0's 수첩)
//   FIELD_EVENTS=off                기획 12차 돌발 괴담: off (default, old numbers) | on (tunables.fieldEventChance, default 0.6)
//                                   | forced:<id> (that event at 8 s of every normal floor 2–19). Output 'fieldEvents' = report.
//   GROGGY=on                       기획 13차 보스 그로기: on (default, tunables as in the game) | off (bossGroggyThreshold 0).
//                                   Boss rows get groggy: breaks per fight, first / second break time, share of boss
//                                   damage dealt while it was down.
//                                   기획 13차 밸런스: + drag share of the boss damage inside / outside the windows
//                                   (dragShareDownPct / dragShareUpPct), time down (downTimePct), breaks by a POLICY seat.
//   JUST=on|off                     기획 17차 저스트 교대: on (default, the game's tunables: window 0.5 s, bots try 30 %) | off
//                                   (justSwapWindow 0: no 저스트 for anyone — the bots do not try either)
//   JUST_RATE=1                     POLICY=dodge|dodgeonly: share of the 저스트 windows (an enemy telegraph about to land on
//                                   the seat's field character, inside the 저스트 window) the seat swaps on; rolled per
//                                   telegraph from hash(seed, telegraph id), so the run rng is untouched. With JUST=off the
//                                   seat still swaps on the same windows (the dodge alone, without the reward).
//   PICK=bot|first                  기획 17차: how the human seats pick floor rewards — bot (default, botPickIndex) | first card
//   BANDS='[[80,17,3,0],[77,17,4,2]]'  기획 17차: floor-reward rarity odds (classic 1–10 / 11+) for this run
//   DROP=just_cd,just_ult           기획 17차: families never offered in this run (what they add)
//   POOL=basic                      기획 17차: offers hold only the 12 basic families (every seat), for the pool's own effect
//   PAR=4                           run the seeds in n child processes (SHARD=i/n, RAW_OUT=file) and merge (same output)
//   Output 'just' (기획 17차): per seat (seat 0 / the bots): windows per floor and per combat minute (window = 0.5 s rule,
//   also with JUST=off), share with a ready card, justs and success share; team: just extra drag damage, cooldown saved.
//   Output 'rewards' (기획 17차): picks per category / rarity / family (seat 0 and bots), legendary cards seen per run, set
//   completions per run, reward ('relic') damage share. Both humans and the bot-style seat pick by botPickIndex.
//   FE_SEAT=play                    the human seats (active/dodge) with events on: play (react like a bot: once-per-event swap,
//                                   event pet rules, event drop score) | ignore (event-blind: the bots alone do the events)
//
// Same seeds + same 'active' policy as tests/playtest/balance.ts (SEED0 + k × 7919) → identical runs (cross-check).
// Damage attribution: every monster/boss skill effect amount (damage/heal) is wrapped in a getter that marks the
// index of the event the hit is about to emit, so each 'damage'/'heal' event is tagged "<monster>.<skill>" exactly;
// enemy projectiles get "<monster>.proj" the same way, melee basics "<monster>.basic" (after the attacker's 'attack').
// Per floor: clear/timeout/wipe, character deaths + "burst" deaths (≥ 70 % HP 2 s before), killers, mid-boss life and
// heals received by source, last enemy alive, split copies / deferred queue / max alive, boss enrage, phase timing,
// deaths per phase, deaths ≤ 5 s after a phase change, seconds with ≥ 2 / ≥ 3 boss patterns telegraphed at once.
// 기획 16차 템포 (normal floors, row 'tempo' + out.tempo): emptySec = combat seconds with 0 enemies alive, low2Sec = with
// ≤ 2; wave / mid spawns: distance to the nearest ally field character (med / p90), off-screen share for seat 0 (camera x =
// its field character's x clamped to [12, W − 12]), engage = seconds from spawn to the first hit / attack / cast or an ally
// within 2.2.

import { BOT_PRESETS, DEFAULT_TUNABLES, LATE_STAT_GROWTH, TICK_RATE, VIEW_WIDTH_UNITS, ZONES } from '../../src/config';
import { BOSSES, CHARACTERS, MONSTERS, getPet } from '../../src/data';
import fs from 'node:fs';
import { bestDropPoint, tickBots } from '../../src/sim/bot';
import { EVENT_BLIND, eventPetPoint, eventThink } from '../../src/sim/botEvents';
import { FIELD_EVENT_UNITS, FIELD_EVENTS as FIELD_EVENT_DEFS, isFieldEventId } from '../../src/data';
import { createGameWithWorld, dispatch, tick } from '../../src/sim/game';
import { hitsArea } from '../../src/sim/geometry';
import { canSwap, canUsePet } from '../../src/sim/players';
import { fieldUltGauge, memberUltGauge } from '../../src/sim/ultMode';
import { BOT } from '../../src/sim/constants';
import { applyOffer, botPickIndex, rollOffers } from '../../src/sim/rewards';
import { findJustThreats, justParams } from '../../src/sim/justSwap';
import { mixSeed } from '../../src/sim/rng';
import { FAMILIES, RARITY_BY_BAND, getReward, isBasicFamily, rewardFamily } from '../../src/data';
import { REWARD_CATEGORY } from './reward-cats';
import { spawn } from 'node:child_process';
import { activeEntity, clampToArena, countEnemies, dist, isAlive, type PendingSpawn, type SimEntity, type World } from '../../src/sim/world';
import type { RewardFamilyDef } from '../../src/types';
import type { BossDef, Effect, GameEvent, MonsterDef, PlayerSetup, SimPhase, SkillAction, Tunables, Vec2 } from '../../src/types';
import { goedamPilot, goedamRunRec, goedamSummary, goedamTunables, parseGoedamPolicy, type GoedamRunRec, type RewardPick } from '../playtest/goedam-policy';

type Policy = 'idle' | 'bot' | 'botseat' | 'active' | 'dodge' | 'dodgeonly';
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
const GOEDAM = parseGoedamPolicy(env.GOEDAM, START);
/** 기획 12차: 'off' | 'on' | a forced event id. */
const FIELD_EVENTS = env.FIELD_EVENTS ?? 'off';
const FE_FORCED = FIELD_EVENTS.startsWith('forced:') ? FIELD_EVENTS.slice(7) : null;
if (FE_FORCED != null && !isFieldEventId(FE_FORCED)) throw new Error(`FIELD_EVENTS: unknown event ${FE_FORCED}`);
const FE_SEAT = env.FE_SEAT === 'ignore' ? 'ignore' : 'play';
const feTunables = (): Partial<Tunables> => (FIELD_EVENTS === 'on' ? {} : { fieldEventChance: 0 });
const GROGGY = env.GROGGY ?? 'on';
/** 기획 17차 저스트 교대. */
const JUST = env.JUST === 'off' ? 'off' : 'on';
const JUST_RATE = Math.max(0, Math.min(1, Number(env.JUST_RATE ?? 1)));
const justTunables = (): Partial<Tunables> => (JUST === 'off' ? { justSwapWindow: 0 } : {});
const PAR = Math.max(1, Number(env.PAR ?? 1));
const SHARD = env.SHARD ? env.SHARD.split('/').map(Number) : null;
const groggyTunables = (): Partial<Tunables> => (GROGGY === 'off' ? { bossGroggyThreshold: 0 } : {});

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
  // 기획 12차 (docs/new-characters.md 9장): "힐 의존도" — player 0 = 블레이드·메이지·X with the stock bots
  ...Object.fromEntries(
    ['cleric', 'medic', 'exorcist', 'puppeteer', 'bard', 'chrono'].map(x => [`h_${x}`, [['blade', 'mage', x], [...BOT_PRESETS[0].characters], [...BOT_PRESETS[1].characters]]]),
  ),
  healers2: [['blade', 'medic', 'exorcist'], [...BOT_PRESETS[0].characters], [...BOT_PRESETS[1].characters]],
  nohealer: [['blade', 'mage', 'puppeteer'], ['guardian', 'ranger', 'chrono'], ['berserker', 'gunner', 'bard']],
};

// ─────────────────────────── data patches ───────────────────────────

function applyPatch(path: string, value: number | string | boolean): void {
  const segs = path.split('.');
  let obj: Record<string, unknown>;
  const head = segs.shift()!;
  if (head === 'ZONES') obj = ZONES as unknown as Record<string, unknown>;
  else if (head === 'LATE') obj = LATE_STAT_GROWTH as unknown as Record<string, unknown>;
  else {
    const def = [...MONSTERS, ...BOSSES, ...CHARACTERS, ...FIELD_EVENT_DEFS, ...FIELD_EVENT_UNITS].find(d => d.id === head);
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
  /** 기획 13차: floor times of the breaks, boss damage while down / in all. */
  groggyAt: number[];
  groggyDmg: number;
  bossDmg: number;
  /** 기획 13차 밸런스: drag damage on the boss while down / up, all damage while up, seconds down, breaks by a POLICY seat. */
  dragDown: number;
  dragUp: number;
  dmgUp: number;
  downSec: number;
  humanBreaks: number;
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
  /** 기획 12차: the 돌발 괴담 of this floor (id) and how it went. */
  event: string | null;
  eventOk: boolean | null;
  eventSec: number | null;
  /** Who got the credit on success: 'human' (a POLICY seat), 'bot', or null (nobody / failed). */
  eventCredit: 'human' | 'bot' | null;
  swaps: number;
  dodges: number;
  maxTeleAll: number;
  /** 기획 16차 템포 (normal floors). */
  emptySec: number;
  low2Sec: number;
  spawnDist: number[];
  spawns: number;
  offscreen: number;
  engage: number[];
}
interface RunRec {
  floors: FloorRec[];
  combatSec: number;
  endFloor: number;
  victory: boolean;
  seed: number;
  goedam: GoedamRunRec;
  seat: SeatRec;
  /** 기획 17차 (per player 0..2). */
  just: JustRec[];
  justExtraDmg: number;
  justCdSaved: number;
  rw: { picks: string[][]; screens: number; cards: Record<string, number>; sets: number[]; relicDmg: number[]; dmg: number[] };
}

// ─────────────────────────── 기획 16차 템포 telemetry ───────────────────────────

interface TempoTrack {
  /** Wave / mid entities not engaged yet → spawn floorTime. */
  born: Map<number, number>;
  /** Seat 0's last field x (camera follow). */
  camX: number | null;
}
const newTempoTrack = (): TempoTrack => ({ born: new Map(), camX: null });

function allyFieldChars(w: World): SimEntity[] {
  return w.state.players.map(p => activeEntity(w, p)).filter((e): e is SimEntity => isAlive(e));
}

/** Seat 0's camera centre: its field character's x clamped to [12, W − 12] (the arena centre when W ≤ 24). */
function seat0CamX(w: World, t: TempoTrack): number {
  const a = w.state.plan.arena;
  const me = activeEntity(w, w.state.players[0]);
  if (isAlive(me)) t.camX = me.pos.x;
  const half = VIEW_WIDTH_UNITS / 2;
  if (a.width <= VIEW_WIDTH_UNITS) return a.width / 2;
  return Math.max(half, Math.min(a.width - half, t.camX ?? a.width / 2));
}

/** One tick of a normal floor: empty / low seconds, wave + mid spawns (distance, off-screen), engage times. */
function trackTempo(w: World, t: TempoTrack, rec: FloorRec, pendBefore: PendingSpawn[], evs: GameEvent[], combat: boolean): void {
  const s = w.state;
  const chars = allyFieldChars(w);
  const camX = seat0CamX(w, t);
  const gone = pendBefore.filter(p => (p.wave >= 0 || p.mid) && !p.printed && !w.spawner.pending.includes(p));
  for (const ev of evs) {
    if (ev.type !== 'spawn' || !gone.some(p => p.pos.x === ev.pos.x && p.pos.y === ev.pos.y)) continue;
    rec.spawns++;
    if (chars.length) rec.spawnDist.push(Math.min(...chars.map(c => dist(c.pos, ev.pos))));
    if (Math.abs(ev.pos.x - camX) > VIEW_WIDTH_UNITS / 2) rec.offscreen++;
    t.born.set(ev.entityId, s.floorTime);
  }
  const engage = (id: number) => {
    const t0 = t.born.get(id);
    if (t0 == null) return;
    rec.engage.push(s.floorTime - t0);
    t.born.delete(id);
  };
  for (const ev of evs) {
    if (ev.type === 'damage' && ev.targetTeam === 'enemy') engage(ev.targetId);
    else if (ev.type === 'attack') engage(ev.sourceId);
    else if (ev.type === 'skillCast' && ev.slot === 'monster' && ev.sourceId != null) engage(ev.sourceId);
  }
  for (const id of [...t.born.keys()]) {
    const e = w.byId.get(id);
    if (!isAlive(e)) t.born.delete(id);
    else if (chars.some(c => dist(c.pos, e.pos) <= 2.2)) engage(id);
  }
  if (!combat) return;
  const n = countEnemies(w);
  if (n === 0) rec.emptySec += 1 / TICK_RATE;
  if (n <= 2) rec.low2Sec += 1 / TICK_RATE;
}

function petTarget(w: World, pi: number, petIdx: number): Vec2 | null {
  const p = w.state.players[pi];
  // 기획 12차: a human who plays the events uses the bots' event pet rules first
  const fe = FIELD_EVENTS !== 'off' && FE_SEAT === 'play' ? eventPetPoint(w, p, petIdx) : undefined;
  if (fe !== undefined) return fe;
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
  /** 기획 14차: the previous think was blocked (one 'blocked' episode per run of blocked thinks). */
  blocked: boolean;
}

/** 기획 14차 per-seat measurements (summed over the POLICY seats of a run). */
interface SeatRec {
  seats: number;
  swaps: number;
  ults: number;
  /** Swaps into a bench card whose own ult gauge was full (per-character mode). */
  ultSwapIns: number;
  /** Swaps-in by player 0's card slot (0..2). */
  byCard: number[];
  blockedEp: number;
  blockedSec: number;
  /** Combat seconds with no character on the field while the seat is not out (waiting to come back in). */
  emptySec: number;
}
const newSeatRec = (): SeatRec => ({ seats: 0, swaps: 0, ults: 0, ultSwapIns: 0, byCard: [0, 0, 0], blockedEp: 0, blockedSec: 0, emptySec: 0 });
let SEAT: SeatRec = newSeatRec();

/** 기획 14차: a field character with its own gauge at least this full is held on the field until it casts. */
const ULT_HOLD = 0.85;

/** Run fn (a seat's decision step) and book the swaps it made into SEAT. */
function measured(w: World, pi: number, fn: () => void): void {
  const p = w.state.players[pi];
  const sw = p.stats.swaps;
  const before = p.party.map((_, i) => memberUltGauge(p, i)?.charge ?? 0);
  fn();
  if (p.stats.swaps > sw && p.activeIndex != null) {
    if (pi === 0) SEAT.byCard[p.activeIndex]++;
    if (before[p.activeIndex] >= 1) SEAT.ultSwapIns++;
  }
}

/** A fight worth an ult swap-in (the bots' rule, src/sim/bot.ts ultCard). */
const ultWorthy = (foes: SimEntity[]) => foes.some(e => e.tier === 'boss' || e.tier === 'mid') || foes.length >= BOT.ultSwapEnemies;

/**
 * 기획 17차: the 저스트 threats on p's field character `me` now (src/sim/justSwap.ts). With JUST=off the game has no
 * window, so the same windows are found with the game's default 0.5 s rule (the dodge alone, without the reward).
 */
function justThreatsOf(w: World, p: World['state']['players'][number], me: SimEntity): ReturnType<typeof findJustThreats> {
  if (w.tunables.justSwapWindow > 0) return findJustThreats(w, p as never, me);
  const view = Object.create(w) as World;
  (view as { tunables: Tunables }).tunables = { ...w.tunables, justSwapWindow: DEFAULT_TUNABLES.justSwapWindow || 0.5 };
  return findJustThreats(view, p as never, me);
}

/** 기획 17차: does the seat take this window? hash(seed, telegraph id) < JUST_RATE (never the run rng). */
const takesWindow = (seed: number, telegraphId: number) => JUST_RATE >= 1 || mixSeed(seed, telegraphId, 0x17) / 2 ** 32 < JUST_RATE;

/** 기획 17차 per-player 저스트 numbers of one run. */
interface JustRec {
  windows: number;
  /** windows with a swappable card at the moment they opened */
  ready: number;
  justs: number;
  dodged: number;
  combatSec: number;
}
const newJustRec = (): JustRec => ({ windows: 0, ready: 0, justs: 0, dodged: 0, combatSec: 0 });

/** One tick: count each player's new 저스트 windows (one per first-seen representative telegraph). */
function trackJustWindows(w: World, seen: Set<number>[], recs: JustRec[]): void {
  const s = w.state;
  if (s.phase !== 'combat') return;
  s.players.forEach((p, pi) => {
    if (p.out) return;
    recs[pi].combatSec += 1 / TICK_RATE;
    const me = activeEntity(w, p);
    if (!isAlive(me)) return;
    const th = justThreatsOf(w, p, me);
    if (!th.length || seen[pi].has(th[0].telegraphId)) return;
    for (const t of th) seen[pi].add(t.telegraphId);
    recs[pi].windows++;
    if ([0, 1, 2].some(i => canSwap(w, pi, i).ok)) recs[pi].ready++;
  });
}

/** 기획 17차 POLICY=dodge|dodgeonly: every tick, swap out on a 저스트 window the seat takes (JUST_RATE). */
function justDodgeThink(w: World, pi: number, st: Brain, rec: FloorRec): void {
  const s = w.state;
  const p = s.players[pi];
  if (p.out || s.phase !== 'combat') return;
  const me = activeEntity(w, p);
  if (!isAlive(me)) return;
  const ready = [0, 1, 2].filter(i => canSwap(w, pi, i).ok);
  if (!ready.length) return;
  const th = justThreatsOf(w, p, me);
  if (!th.length || st.dodgedTele.has(th[0].telegraphId)) return;
  for (const t of th) st.dodgedTele.add(t.telegraphId);
  if (!takesWindow(s.seed, th[0].telegraphId)) return;
  const hpOf = (i: number) => p.party[i].hp / p.party[i].maxHp;
  const idx = [...ready].sort((a, b) => hpOf(b) - hpOf(a))[0];
  if (dispatch(w, { type: 'swap', player: pi, partyIndex: idx, pos: seatDropPoint(w, p, idx) }).ok) {
    st.lastSwap = s.time;
    st.react = null;
    rec.dodges++;
  }
}

function humanThink(w: World, pi: number, st: Brain, policy: Policy, seen: Map<number, number>, rec: FloorRec): void {
  const s = w.state;
  const p = s.players[pi];
  if (p.out || s.phase !== 'combat') return;
  const foes = s.entities.filter(e => e.team === 'enemy' && isAlive(e));
  const me = activeEntity(w, p);
  // the field character's own gauge (기획 15차)
  const ult = fieldUltGauge(p);
  if (ult && ult.charge >= 1 && me && foes.length) {
    if (st.ultAt == null) st.ultAt = s.time + 0.5;
    if (s.time >= st.ultAt && dispatch(w, { type: 'ult', player: pi }).ok) st.ultAt = null;
  }
  // 기획 12차: the once-per-event swap toward the event (same rule as the bots)
  if (FIELD_EVENTS !== 'off' && FE_SEAT === 'play' && eventThink(w, p, cmd => dispatch(w, cmd))) st.lastSwap = s.time;
  const ready = [0, 1, 2].filter(i => canSwap(w, pi, i).ok);
  const holding = !!ult && ult.charge >= ULT_HOLD;
  // 기획 14차 개별 게이지: a full bench card into a fight worth it, now (the field gauge is spent / far from full)
  const ultIn =
    me && !holding && ultWorthy(foes)
      ? ready.filter(i => (memberUltGauge(p, i)?.charge ?? 0) >= 1).sort((a, b) => (memberUltGauge(p, a)!.fullSince ?? 0) - (memberUltGauge(p, b)!.fullSince ?? 0))[0]
      : undefined;
  const lowHp = !!me && me.hp < me.maxHp * 0.35;
  const due = policy !== 'dodgeonly' && s.time - st.lastSwap >= 4 && foes.length > 0 && !holding;
  let go = false;
  if (!me) {
    if (ready.length) {
      if (st.react == null) st.react = s.time + 0.6;
      go = s.time >= st.react;
    }
  } else {
    go = lowHp || due || ultIn != null; // 기획 17차: the dodge seats' swaps are justDodgeThink (every tick)
  }
  const hpOf = (i: number) => p.party[i].hp / p.party[i].maxHp;
  const byHp = (a: number, b: number) => hpOf(b) - hpOf(a);
  let idx: number | undefined;
  let blocked = false;
  if (go) {
    if (ultIn != null) idx = ultIn;
    else {
      idx = [...ready].sort(byHp)[0];
      // nothing swappable although a living card waits on the bench (cooldowns)
      if (idx == null && p.party.some((m, i) => i !== p.activeIndex && !m.dead)) blocked = true;
    }
  }
  if (blocked) {
    SEAT.blockedSec += 0.25;
    if (!st.blocked) SEAT.blockedEp++;
  }
  st.blocked = blocked;
  if (idx != null) {
    if (dispatch(w, { type: 'swap', player: pi, partyIndex: idx, pos: seatDropPoint(w, p, idx) }).ok) {
      st.lastSwap = s.time;
      st.react = null;
    }
  }
  for (let i = 0; i < p.pets.length; i++) {
    if (!canUsePet(w, pi, i).ok) continue;
    const pos = petTarget(w, pi, i);
    if (pos && dispatch(w, { type: 'pet', player: pi, petIndex: i, pos }).ok) break;
  }
}

/**
 * The human seat's swap spot. FE_SEAT=ignore: an event-blind player — the event targets weigh like any monster for
 * its aim (the bots' weight 4 is an event rule), so the tags are hidden for this one (pure) call.
 */
function seatDropPoint(w: World, p: World['state']['players'][number], idx: number): Vec2 {
  if (FE_SEAT !== 'ignore' || !w.state.fieldEvent) return bestDropPoint(w, p, idx);
  const hidden = w.state.entities.filter(e => e.eventTag === 'target');
  for (const e of hidden) e.eventTag = undefined;
  try {
    return bestDropPoint(w, p, idx);
  } finally {
    for (const e of hidden) e.eventTag = 'target';
  }
}

/** 'botseat': player 0's combat turn by the stock bot AI while the sim still treats the seat as human. */
function botSeatThink(w: World): void {
  const ps = w.state.players;
  // 기획 14차 seat report: the bot wants a swap (its own timers: empty field, low HP, periodic swap due) but nothing is
  // swappable although a living card waits on the bench (cooldown / pool short)
  const p = ps[0];
  const me = activeEntity(w, p);
  const foes = w.state.entities.some(e => e.team === 'enemy' && isAlive(e));
  if (!p.out) {
    const want = !me || me.hp < me.maxHp * BOT.lowHpFrac || (foes && w.state.time >= p.rt.bot.nextSwapAt);
    const waiting = p.party.some((m, i) => i !== p.activeIndex && !m.dead);
    const blocked = want && waiting && ![0, 1, 2].some(i => canSwap(w, 0, i).ok);
    if (blocked) {
      SEAT.blockedSec += 1 / TICK_RATE;
      if (!BOTSEAT_BLOCKED.v) SEAT.blockedEp++;
    }
    BOTSEAT_BLOCKED.v = blocked;
  }
  const was = ps.map(q => q.isBot);
  ps.forEach((q, i) => (q.isBot = i === 0));
  measured(w, 0, () => tickBots(w, 1 / TICK_RATE, cmd => dispatch(w, cmd)));
  ps.forEach((q, i) => (q.isBot = was[i]));
}
const BOTSEAT_BLOCKED = { v: false };
/** 기획 17차 reward screens seen by seat 0 (this run): screens, cards by rarity. */
let SEEN = { screens: 0, cards: {} as Record<string, number> };
/**
 * Floor reward (기획 17차): every human seat picks like the bots (botPickIndex, the card's default member). PICK=first:
 * the first card (slot 1 = a basic card at the screen's odds — the 16차 bench's 「첫 장」) for comparisons.
 */
const PICK = env.PICK === 'first' ? 'first' : 'bot';
/** BANDS='[[80,17,3,0],[77,17,4,2]]': floor-reward rarity odds by band (early, late) for this run (balance trials). */
if (env.BANDS) {
  const b = JSON.parse(env.BANDS) as number[][];
  (RARITY_BY_BAND as unknown as number[][]).forEach((row, i) => row.splice(0, row.length, ...b[i]));
}
/** DROP=just_cd,just_ult: these families are never offered (every seat) — what they add. */
if (env.DROP) {
  const all = FAMILIES as RewardFamilyDef[];
  const drop = new Set(env.DROP.split(','));
  const keep = all.filter(f => !drop.has(f.key));
  all.splice(0, all.length, ...keep);
}
/** POOL=basic: only the 12 basic families are ever offered (every seat) — what the new families add on top. */
if (env.POOL === 'basic') {
  const all = FAMILIES as RewardFamilyDef[];
  const keep = all.filter(f => isBasicFamily(f.key));
  all.splice(0, all.length, ...keep);
}
const rewardPick: RewardPick = (offers, pi, w) => {
  if (pi === 0) {
    SEEN.screens++;
    for (const o of offers) if (!o.isRelic) inc(SEEN.cards, o.rarity);
  }
  return PICK === 'first' ? 0 : Math.max(0, botPickIndex(w.state.players[pi], offers));
};

const inc = (o: Record<string, number>, k: string, v = 1) => {
  o[k] = (o[k] ?? 0) + v;
};

function runOnce(seed: number): RunRec {
  const tunables: Tunables = { ...DEFAULT_TUNABLES, ...feTunables(), ...groggyTunables(), ...justTunables(), ...TUN, ...goedamTunables(GOEDAM) };
  const comp = COMPS[COMP];
  if (!comp) throw new Error(`unknown COMP ${COMP}`);
  const humanCount = POLICY === 'bot' || POLICY === 'idle' || POLICY === 'botseat' ? Math.max(1, HUMANS) : HUMANS;
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
      if (offers.length) applyOffer(w, p, offers[Math.max(0, botPickIndex(p, offers))]);
    }
  }
  game.drainEvents();
  const humans = s.players.filter(p => !p.isBot).map(p => p.id);
  EVENT_BLIND.clear();
  if (FE_SEAT === 'ignore') for (const pi of humans) EVENT_BLIND.add(pi);
  let feForcedFloor = -1;
  const pilot = goedamPilot(w, GOEDAM);
  const thinkers = POLICY === 'active' || POLICY === 'dodge' || POLICY === 'dodgeonly' ? humans : [];
  const brains = new Map<number, Brain>(thinkers.map(pi => [pi, { lastSwap: -99, ultAt: null, react: null, dodgedTele: new Set(), blocked: false }]));
  SEAT = newSeatRec();
  SEEN = { screens: 0, cards: {} };
  BOTSEAT_BLOCKED.v = false;
  const justRecs = s.players.map(newJustRec);
  const justSeen = s.players.map(() => new Set<number>());
  const sets = s.players.map(() => 0);
  let justExtraDmg = 0;
  let justCdSaved = 0;
  let justMult = 1.5;
  const dodgeSeats = POLICY === 'dodge' || POLICY === 'dodgeonly' ? thinkers : [];
  const seatIds = POLICY === 'botseat' ? [0] : thinkers;
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
    event: null,
    eventOk: null,
    eventSec: null,
    eventCredit: null,
    boss2:
      s.plan.kind === 'boss'
        ? { phases: [], enragedAt: null, hpAtEnrage: null, deathsBySeg: [0, 0, 0, 0], outsBySeg: [0, 0, 0, 0], maxTele: 0, wipeAt: null, wipeSeg: null, deathsAfterPhase: [0, 0], groggyAt: [], groggyDmg: 0, bossDmg: 0, dragDown: 0, dragUp: 0, dmgUp: 0, downSec: 0, humanBreaks: 0 }
        : null,
    swaps: s.players[0].stats.swaps,
    dodges: 0,
    maxTeleAll: 0,
    emptySec: 0,
    low2Sec: 0,
    spawnDist: [],
    spawns: 0,
    offscreen: 0,
    engage: [],
  });
  let rec = newRec();
  let thinkIn = 0;
  let midId: number | null = null;
  const lastKey = new Map<number, string>();
  const recentDmg = new Map<number, { t: number; key: string; amt: number }[]>();
  const tempo = newTempoTrack();

  const seg = (b: BossRec): number => (s.bossEnraged ? 3 : Math.min(2, b.phases.length));
  const finish = (outcome: FloorRec['outcome'], seconds: number) => {
    const fe = w.fieldEvents.history.find(h => h.floor === rec.floor);
    if (fe) {
      rec.event = fe.id;
      rec.eventOk = fe.success;
      rec.eventSec = fe.seconds;
      rec.eventCredit = fe.credit == null ? null : s.players[fe.credit]?.isBot ? 'bot' : 'human';
    }
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
    if (s.phase === 'reward' || s.phase === 'goedam') {
      pilot.settle(humans, rewardPick);
      continue;
    }
    if (s.phase === 'runOver') break;
    const floorBefore = s.floor;
    if (thinkers.length) {
      thinkIn -= 1 / TICK_RATE;
      if (thinkIn <= 0) {
        thinkIn = 0.25;
        for (const pi of thinkers) measured(w, pi, () => humanThink(w, pi, brains.get(pi)!, POLICY, seen, rec));
      }
    }
    for (const pi of dodgeSeats) measured(w, pi, () => justDodgeThink(w, pi, brains.get(pi)!, rec));
    if (POLICY === 'botseat' && s.phase === 'combat') botSeatThink(w);
    if (s.phase === 'combat') for (const pi of seatIds) if (!s.players[pi].out && !activeEntity(w, s.players[pi])) SEAT.emptySec += 1 / TICK_RATE;
    if (FE_FORCED && s.phase === 'combat' && s.plan.kind === 'normal' && s.floor >= 2 && s.floor <= 19 && s.floor !== feForcedFloor && s.floorTime >= 8) {
      feForcedFloor = s.floor;
      dispatch(w, { type: 'debug', action: { kind: 'fieldEventNext', id: FE_FORCED as never } });
    }
    for (const e of s.entities) {
      if (!info.has(e.id)) info.set(e.id, { defId: e.defId, kind: e.kind, tier: e.tier, team: e.team, maxHp: e.maxHp });
    }
    const outBefore = s.players.map(p => p.out);
    const wavesBefore = w.spawner.nextWave;
    const pendBefore = [...w.spawner.pending];
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
    trackJustWindows(w, justSeen, justRecs);
    for (let i = 0; i < evs.length; i++) {
      const ev = evs[i];
      const mark = MARKS.get(i);
      if (ev.type === 'justSwap') {
        justCdSaved += ev.cdCut;
        justMult = justParams(w, s.players[ev.player]).mult;
      } else if (ev.type === 'tagSet') sets[ev.player]++;
      else if (ev.type === 'damage' && ev.just) justExtraDmg += ev.amount * (1 - 1 / Math.max(1, justMult));
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
          if (rec.boss2 && ev.targetId === s.bossId && ev.targetTeam === 'enemy') {
            rec.boss2.bossDmg += ev.amount;
            if (ev.groggy) rec.boss2.groggyDmg += ev.amount;
            else rec.boss2.dmgUp += ev.amount;
            if (ev.source === 'drag') {
              if (ev.groggy) rec.boss2.dragDown += ev.amount;
              else rec.boss2.dragUp += ev.amount;
            }
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
        case 'bossGroggy':
          if (rec.boss2) {
            rec.boss2.groggyAt.push(s.floorTime);
            if (ev.player != null && !s.players[ev.player]?.isBot) rec.boss2.humanBreaks++;
          }
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
    if (rec.boss2 && s.phase === 'combat' && (s.bossGroggy?.left ?? 0) > 0) rec.boss2.downSec += 1 / TICK_RATE;
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
    if (s.floor === floorBefore && rec.kind === 'normal') trackTempo(w, tempo, rec, pendBefore, evs, phaseAfter === 'combat');
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
      if (phaseAfter === 'reward') pilot.settle(humans, rewardPick);
      rec = newRec();
      midId = null;
      tempo.born.clear();
      lastKey.clear();
      recentDmg.clear();
      for (const b of brains.values()) {
        b.lastSwap = -99;
        b.dodgedTele.clear();
      }
    }
  }
  const lastF = floors[floors.length - 1];
  const endFloor = lastF?.floor ?? START;
  const victory = !!lastF && lastF.outcome === 'clear' && lastF.floor >= LAST;
  SEAT.seats = seatIds.length;
  for (const pi of seatIds) {
    SEAT.swaps += s.players[pi].stats.swaps;
    SEAT.ults += s.players[pi].stats.ultsUsed;
  }
  s.players.forEach((p, pi) => {
    justRecs[pi].justs = p.stats.justSwaps;
    justRecs[pi].dodged = p.stats.justDodged;
  });
  const rw = {
    picks: s.players.map(p => p.rewards.map(r => r.rewardId)),
    screens: SEEN.screens,
    cards: SEEN.cards,
    sets,
    relicDmg: s.players.map(p => p.stats.damageBySource.relic ?? 0),
    dmg: s.players.map(p => p.stats.damageDealt),
  };
  return { floors, combatSec, endFloor, victory, seed, goedam: goedamRunRec(w, victory, endFloor), seat: SEAT, just: justRecs, justExtraDmg, justCdSaved, rw };
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

/** PAR=n: the seeds in n child processes (SHARD=i/n, RAW_OUT=file), merged back in seed order. */
async function runAll(): Promise<RunRec[]> {
  if (SHARD) {
    const out: RunRec[] = [];
    for (let k = SHARD[0]; k < RUNS; k += SHARD[1]) out.push(runOnce(SEED0 + k * 7919));
    return out;
  }
  if (PAR <= 1) {
    const out: RunRec[] = [];
    for (let k = 0; k < RUNS; k++) out.push(runOnce(SEED0 + k * 7919));
    return out;
  }
  const os = await import('node:os');
  const path = await import('node:path');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'critic-'));
  const files = Array.from({ length: PAR }, (_, i) => path.join(dir, `shard${i}.json`));
  await Promise.all(
    files.map(
      (f, i) =>
        new Promise<void>((res, rej) => {
          const ch = spawn('npx', ['vite-node', 'tests/review/critic-20f.ts'], { env: { ...env, SHARD: `${i}/${PAR}`, RAW_OUT: f, PAR: '1' }, stdio: ['ignore', 'ignore', 'inherit'] });
          ch.on('exit', code => (code === 0 ? res() : rej(new Error(`shard ${i} exit ${code}`))));
        }),
    ),
  );
  const parts = files.map(f => JSON.parse(fs.readFileSync(f, 'utf8')) as RunRec[]);
  fs.rmSync(dir, { recursive: true, force: true });
  const out: RunRec[] = [];
  for (let k = 0; k < RUNS; k++) out.push(parts[k % PAR][Math.floor(k / PAR)]);
  return out;
}
const runs: RunRec[] = await runAll();
if (SHARD) {
  fs.writeFileSync(env.RAW_OUT!, JSON.stringify(runs));
  (globalThis as unknown as { process: { exit(c: number): never } }).process.exit(0);
}

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
    row.tempo = tempoRow(recs);
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
      groggy: {
        breaksPerFight: r2(bs.reduce((a, b) => a + b.groggyAt.length, 0) / bs.length),
        firstMed: r1(pctl(bs.map(b => b.groggyAt[0] ?? NaN).filter(Number.isFinite), 0.5)),
        secondMed: r1(pctl(bs.map(b => b.groggyAt[1] ?? NaN).filter(Number.isFinite), 0.5)),
        downDmgPct: r1((bs.reduce((a, b) => a + b.groggyDmg, 0) / Math.max(1, bs.reduce((a, b) => a + b.bossDmg, 0))) * 100),
        // 기획 13차 밸런스: drag share of the boss damage inside vs outside the windows ('지금이다!' = higher inside)
        dragShareDownPct: r1((bs.reduce((a, b) => a + b.dragDown, 0) / Math.max(1, bs.reduce((a, b) => a + b.groggyDmg, 0))) * 100),
        dragShareUpPct: r1((bs.reduce((a, b) => a + b.dragUp, 0) / Math.max(1, bs.reduce((a, b) => a + b.dmgUp, 0))) * 100),
        downTimePct: r1((bs.reduce((a, b) => a + b.downSec, 0) / Math.max(1, recs.reduce((a, r) => a + r.seconds, 0))) * 100),
        humanBreakPct: r1((bs.reduce((a, b) => a + b.humanBreaks, 0) / Math.max(1, bs.reduce((a, b) => a + b.groggyAt.length, 0))) * 100),
      },
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

/**
 * 기획 12차 돌발 괴담 report: count / success % / seconds to resolve per event; event floors vs the others (median clear
 * time, timeouts %); character deaths on the floor right after an event floor vs after a floor without; floor 20 deaths.
 */
function fieldEventReport(rs: RunRec[]): unknown {
  const all = rs.flatMap(r => r.floors);
  const evFloors = all.filter(f => f.event != null && (f.eventSec ?? 0) > 0);
  const byId: Record<string, { n: number; ok: number; okSec: number[]; human: number; bot: number }> = {};
  for (const f of evFloors) {
    const b = (byId[f.event!] ??= { n: 0, ok: 0, okSec: [], human: 0, bot: 0 });
    b.n++;
    if (f.eventOk) {
      b.ok++;
      b.okSec.push(f.eventSec ?? 0);
      if (f.eventCredit) b[f.eventCredit]++;
    }
  }
  const normal = all.filter(f => f.kind === 'normal');
  const plain = normal.filter(f => f.event == null);
  const evNormal = normal.filter(f => f.event != null);
  const med = (fs: FloorRec[]) => r1(pctl(fs.filter(f => f.outcome === 'clear').map(f => f.seconds), 0.5));
  const toPct = (fs: FloorRec[]) => r2((fs.filter(f => f.outcome === 'timeout').length / Math.max(1, fs.length)) * 100);
  const nextDeaths = (pred: (f: FloorRec) => boolean) => {
    let d = 0;
    let n = 0;
    for (const r of rs)
      for (let i = 1; i < r.floors.length; i++) {
        if (!pred(r.floors[i - 1])) continue;
        n++;
        d += r.floors[i].deaths;
      }
    return r2(d / Math.max(1, n));
  };
  const f20 = all.filter(f => f.floor === 20);
  return {
    perRun: r2(evFloors.length / Math.max(1, rs.length)),
    successPct: r1((evFloors.filter(f => f.eventOk).length / Math.max(1, evFloors.length)) * 100),
    byId: Object.fromEntries(
      Object.entries(byId).map(([k, b]) => [k, { n: b.n, okPct: r1((b.ok / b.n) * 100), okSecMed: r1(pctl(b.okSec, 0.5)), humanCredit: b.human, botCredit: b.bot }]),
    ),
    clearSecMed: { eventFloors: med(evNormal), otherNormal: med(plain) },
    timeoutPct: { eventFloors: toPct(evNormal), otherNormal: toPct(plain) },
    nextFloorDeaths: { afterEvent: nextDeaths(f => f.event != null), afterOtherNormal: nextDeaths(f => f.kind === 'normal' && f.event == null) },
    floor20: { reached: f20.length, deathsAvg: r2(f20.reduce((a, f) => a + f.deaths, 0) / Math.max(1, f20.length)), clearPct: r1((f20.filter(f => f.outcome === 'clear').length / Math.max(1, f20.length)) * 100) },
  };
}
/** 기획 16차 템포: empty / low-2 seconds (cleared floors, mean), spawn distance, off-screen %, engage (all floors' spawns). */
function tempoRow(recs: FloorRec[]): unknown {
  const cl = recs.filter(r => r.outcome === 'clear');
  const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN);
  const dists = recs.flatMap(r => r.spawnDist);
  const eng = recs.flatMap(r => r.engage);
  const spawns = recs.reduce((a, r) => a + r.spawns, 0);
  return {
    emptySec: r1(mean(cl.map(r => r.emptySec))),
    // a 돌발 괴담 floor holds its last wave until the event is over: the party plays the event on an empty field
    emptySecByEvent: { event: r1(mean(cl.filter(r => r.event != null).map(r => r.emptySec))), none: r1(mean(cl.filter(r => r.event == null).map(r => r.emptySec))) },
    low2Sec: r1(mean(cl.map(r => r.low2Sec))),
    spawnDist: { med: r1(pctl(dists, 0.5)), p90: r1(pctl(dists, 0.9)) },
    offscreenPct: r1((recs.reduce((a, r) => a + r.offscreen, 0) / Math.max(1, spawns)) * 100),
    engage: { med: r1(pctl(eng, 0.5)), p90: r1(pctl(eng, 0.9)) },
  };
}

/** 기획 14차: the POLICY seats' swap / ult numbers (per seat; ends of runs included). */
function seatReport(rs: RunRec[]): unknown {
  const seats = rs.reduce((a, r) => a + r.seat.seats, 0);
  if (!seats) return null;
  const min = rs.reduce((a, r) => a + (r.combatSec / 60) * r.seat.seats, 0);
  const sum = (k: keyof Omit<SeatRec, 'byCard'>) => rs.reduce((a, r) => a + (r.seat[k] as number), 0);
  const vict = rs.filter(r => r.victory);
  const vSeats = vict.reduce((a, r) => a + r.seat.seats, 0);
  const byCard = [0, 1, 2].map(i => rs.reduce((a, r) => a + r.seat.byCard[i], 0));
  return {
    swapsPerMin: r2(sum('swaps') / Math.max(1e-9, min)),
    ultsPerRun: r2(sum('ults') / seats),
    ultsPerRunVictory: vSeats ? r2(vict.reduce((a, r) => a + r.seat.ults, 0) / vSeats) : null,
    ultsPer10Min: r2((sum('ults') / Math.max(1e-9, min)) * 10),
    ultSwapInsPerRun: r2(sum('ultSwapIns') / seats),
    blockedPer10Min: r2((sum('blockedEp') / Math.max(1e-9, min)) * 10),
    blockedTimePct: r1((sum('blockedSec') / Math.max(1e-9, min * 60)) * 100),
    emptyFieldPct: r1((sum('emptySec') / Math.max(1e-9, min * 60)) * 100),
    p0SwapsByCardPerRun: byCard.map(x => r1(x / rs.length)),
  };
}
/** 기획 17차: 저스트 windows / justs per seat group (seat 0 = the POLICY seat; bots = seats with isBot). */
function justReport(rs: RunRec[]): unknown {
  const group = (pick: (pi: number) => boolean) => {
    const recs = rs.flatMap(r => r.just.filter((_, pi) => pick(pi)));
    const floors = rs.reduce((a, r) => a + r.floors.length * r.just.filter((_, pi) => pick(pi)).length, 0);
    const sum = (k: keyof JustRec) => recs.reduce((a, j) => a + j[k], 0);
    const min = sum('combatSec') / 60;
    return {
      windowsPerFloor: r2(sum('windows') / Math.max(1, floors)),
      windowsPerMin: r2(sum('windows') / Math.max(1e-9, min)),
      readyPct: r1((sum('ready') / Math.max(1, sum('windows'))) * 100),
      justsPerRun: r2(sum('justs') / Math.max(1, recs.length)),
      justsPerMin: r2(sum('justs') / Math.max(1e-9, min)),
      landedPct: r1((sum('justs') / Math.max(1, sum('windows'))) * 100),
      dodgedPerJust: r2(sum('dodged') / Math.max(1, sum('justs'))),
    };
  };
  const bots = (pi: number) => pi >= Math.max(POLICY === 'bot' ? 0 : 1, HUMANS);
  const justs = rs.reduce((a, r) => a + r.just.reduce((b, j) => b + j.justs, 0), 0);
  return {
    seat0: group(pi => pi === 0),
    bots: group(bots),
    team: {
      extraDragDmgPerRun: r1(rs.reduce((a, r) => a + r.justExtraDmg, 0) / rs.length),
      extraDragDmgPerJust: r1(rs.reduce((a, r) => a + r.justExtraDmg, 0) / Math.max(1, justs)),
      cdSavedSecPerJust: r2(rs.reduce((a, r) => a + r.justCdSaved, 0) / Math.max(1, justs)),
    },
  };
}

/** 기획 17차: floor-reward picks (seat 0 vs bots) by category / rarity / family, legendary seen, sets, reward damage. */
function rewardReport(rs: RunRec[]): unknown {
  const bots = (pi: number) => pi >= Math.max(POLICY === 'bot' ? 0 : 1, HUMANS);
  const group = (pick: (pi: number) => boolean) => {
    const ids = rs.flatMap(r => r.rw.picks.filter((_, pi) => pick(pi)).flat());
    const seats = rs.reduce((a, r) => a + r.rw.picks.filter((_, pi) => pick(pi)).length, 0);
    const cat: Record<string, number> = {};
    const rar: Record<string, number> = {};
    const fam: Record<string, number> = {};
    for (const id of ids) {
      const f = rewardFamily(id);
      inc(cat, REWARD_CATEGORY[f] ?? '?');
      inc(rar, getReward(id).rarity);
      inc(fam, f);
    }
    const pct = (o: Record<string, number>) => Object.fromEntries(Object.entries(o).sort((a, b) => b[1] - a[1]).map(([k, v]) => [k, r1((v / Math.max(1, ids.length)) * 100)]));
    const relic = rs.reduce((a, r) => a + r.rw.relicDmg.filter((_, pi) => pick(pi)).reduce((x, y) => x + y, 0), 0);
    const dmg = rs.reduce((a, r) => a + r.rw.dmg.filter((_, pi) => pick(pi)).reduce((x, y) => x + y, 0), 0);
    return {
      picksPerSeatRun: r2(ids.length / Math.max(1, seats)),
      categoryPct: pct(cat),
      rarityPct: pct(rar),
      setsPerSeatRun: r2(rs.reduce((a, r) => a + r.rw.sets.filter((_, pi) => pick(pi)).reduce((x, y) => x + y, 0), 0) / Math.max(1, seats)),
      relicDmgPct: r1((relic / Math.max(1, dmg)) * 100),
      familyPicksPer100Seats: Object.fromEntries(Object.entries(fam).sort((a, b) => b[1] - a[1]).map(([k, v]) => [k, r1((v / Math.max(1, seats)) * 100)])),
    };
  };
  const cards: Record<string, number> = {};
  for (const r of rs) for (const [k, v] of Object.entries(r.rw.cards)) inc(cards, k, v);
  const nCards = Object.values(cards).reduce((a, b) => a + b, 0);
  return {
    seat0: group(pi => pi === 0),
    bots: group(bots),
    seat0Seen: {
      screensPerRun: r2(rs.reduce((a, r) => a + r.rw.screens, 0) / rs.length),
      legendPerRun: r2((cards.legendary ?? 0) / rs.length),
      cardRarityPct: Object.fromEntries(Object.entries(cards).map(([k, v]) => [k, r1((v / Math.max(1, nCards)) * 100)])),
    },
  };
}

const out = {
  cfg: { RUNS, FLOORS, START, SEED0, POLICY, COMP, HCOMP, HUMANS, REACT, TUN, PATCH, GOEDAM: GOEDAM.name, FIELD_EVENTS, FE_SEAT, JUST, JUST_RATE, PICK, POOL: env.POOL ?? 'all', BANDS: env.BANDS ?? null, DROP: env.DROP ?? null },
  runs: {
    victories: vict.length,
    victoryPct: r1((vict.length / runs.length) * 100),
    /** 기획 17차: one char per run in seed order ('1' = victory) — sub-samples and matched-seed comparisons. */
    victoryBits: runs.map(r => (r.victory ? '1' : '0')).join(''),
    endFloorMed: pctl(runs.map(r => r.endFloor), 0.5),
    ends: Object.fromEntries(Object.entries(ends).sort((a, b) => parseInt(a[0]) - parseInt(b[0]))),
    // combat seconds of a full (victorious) run; real wall time adds reward screens + floor intros
    fullRunCombatMin: { med: r1(pctl(vict.map(r => r.combatSec / 60), 0.5)), p10: r1(pctl(vict.map(r => r.combatSec / 60), 0.1)), p90: r1(pctl(vict.map(r => r.combatSec / 60), 0.9)) },
    allRunCombatMinMed: r1(pctl(runs.map(r => r.combatSec / 60), 0.5)),
    dodgesPerFloor: r2(runs.reduce((a, r) => a + r.floors.reduce((b, f) => b + f.dodges, 0), 0) / Math.max(1, runs.reduce((a, r) => a + r.floors.length, 0))),
  },
  skillTable,
  monsterHeal: top(gHeal, 10, runs.length),
  goedam: goedamSummary(GOEDAM, runs.map(r => r.goedam)),
  fieldEvents: fieldEventReport(runs),
  seat: seatReport(runs),
  just: justReport(runs),
  rewards: rewardReport(runs),
  tempo: tempoRow(runs.flatMap(r => r.floors).filter(f => f.kind === 'normal')),
  perFloor,
};
if (env.GOEDAM_DUMP) fs.writeFileSync(env.GOEDAM_DUMP, JSON.stringify(runs.map(r => ({ seed: r.seed, ...r.goedam }))));
console.log(JSON.stringify(out, null, 1));
