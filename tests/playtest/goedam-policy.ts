// 기획 10차: shared between-floor auto-chooser for the headless benches — floor reward + 괴담 room (docs/goedam-rooms.md 7장).
// Without it a harness would tick forever in phase 'goedam' (time is frozen there).
//
//   GOEDAM=off|leave|random|first|greedy|forced:<room>:<option>     (default 'leave' = bit-identical to 'off')
//     off     — no rooms (tunables.goedamRoomsPerZone = 0)
//     leave   — always 'leave' (the room still opens; the run must equal 'off' except the 수첩)
//     random  — any visible option, on its own rng (seed + floor + player; never the run rng)
//     first   — the top (boldest) visible option
//     greedy  — the highest expected value by the data numbers (rough value model below; reads the corridor right)
//     forced  — no scheduled rooms; <room> is forced (debug goedamNext) after one floor of its zone, picked by seed,
//               and <option> is taken there ('leave' if it is hidden for that player)
// A run that starts mid-way (START > 1) skipped the earlier rooms: the policy is forced to 'off' with a warning.

import { ZONES, zoneOf } from '../../src/config';
import { getGoedamOption, getGoedamRoom, getGoedamTrace, getReward, goedamRoomWeight } from '../../src/data';
import { dispatch } from '../../src/sim/game';
import { goedamFloorsOf } from '../../src/sim/goedam';
import { mixSeed, Rng } from '../../src/sim/rng';
import type { World } from '../../src/sim/world';
import type { GoedamEffect, GoedamLogEntry, GoedamOptionDef, GoedamParams, PlayerState, Rarity, RewardOffer, Tunables } from '../../src/types';

export type GoedamPolicyKind = 'off' | 'leave' | 'random' | 'first' | 'greedy' | 'forced';

export interface GoedamPolicy {
  kind: GoedamPolicyKind;
  /** forced only */
  room?: string;
  option?: string;
  /** As given (for the report). */
  name: string;
}

const KINDS: GoedamPolicyKind[] = ['off', 'leave', 'random', 'first', 'greedy'];

/** GOEDAM env value → policy. START > 1 forces 'off' (the rooms of floors 1..START−1 never happened). */
export function parseGoedamPolicy(raw: string | undefined, start = 1): GoedamPolicy {
  const name = (raw ?? 'leave').trim() || 'leave';
  if (start > 1 && name !== 'off') {
    console.warn(`[goedam] START=${start}: earlier rooms are skipped, so GOEDAM=${name} is forced to 'off'`);
    return { kind: 'off', name: 'off' };
  }
  if (name.startsWith('forced:')) {
    const [, room, option] = name.split(':');
    const opt = getGoedamOption(room, option); // throws on an unknown room
    if (!opt) throw new Error(`GOEDAM=${name}: room ${room} has no option ${option}`);
    return { kind: 'forced', room, option, name };
  }
  if (!KINDS.includes(name as GoedamPolicyKind)) throw new Error(`GOEDAM=${name}: use off|leave|random|first|greedy|forced:<room>:<option>`);
  return { kind: name as GoedamPolicyKind, name };
}

/** Tunables this policy needs on top of the harness's own (off / forced: no scheduled rooms). */
export function goedamTunables(pol: GoedamPolicy): Partial<Tunables> {
  return pol.kind === 'off' || pol.kind === 'forced' ? { goedamRoomsPerZone: 0 } : {};
}

/** forced: the floor after which the room opens — one its zone allows, by room weight, from the seed. */
export function goedamForcedFloor(seed: number, room: string): number {
  const def = getGoedamRoom(room);
  const floors = ZONES.flatMap(z => goedamFloorsOf(z)).filter(f => goedamRoomWeight(def, f, zoneOf(f).theme) > 0);
  return new Rng(mixSeed(seed, 0xf0ced)).weighted(floors, f => goedamRoomWeight(def, f, zoneOf(f).theme));
}

// ─────────────────────────── choosing ───────────────────────────

/** Rough worth of one reward / relic in "rare reward" units (greedy only). */
const RARITY_VALUE: Record<Rarity, number> = { common: 0.6, rare: 1, epic: 1.6 };
const RELIC_VALUE = 2;
/** Worth of 100 % of a stat for one floor (a +15 % atk reward kept ~10 floors ≈ 1 unit). */
const PER_FLOOR = { atkPct: 0.6, hpPct: 0.5, atkSpeedPct: 0.6, critChance: 0.3, damageTaken: -0.6, ultCharge: 0.1 };
/** Worth of 100 % of current HP lost (or max HP healed). */
const HP_VALUE = 2.5;
const ULT_VALUE = 0.6;

function rewardValue(weights: Record<Rarity, number>): number {
  const tot = weights.common + weights.rare + weights.epic || 1;
  return (weights.common * RARITY_VALUE.common + weights.rare * RARITY_VALUE.rare + weights.epic * RARITY_VALUE.epic) / tot;
}

function traceValue(id: string, floor: number): number {
  const t = getGoedamTrace(id);
  const floors = t.floors ?? Math.max(1, 20 - floor);
  const m = t.mods ?? {};
  const perFloor =
    (m.atkPct ?? 0) * PER_FLOOR.atkPct +
    (m.hpPct ?? 0) * PER_FLOOR.hpPct +
    (m.atkSpeedPct ?? 0) * PER_FLOOR.atkSpeedPct +
    (m.critChance ?? 0) * PER_FLOOR.critChance +
    (t.damageTaken ?? 0) * PER_FLOOR.damageTaken +
    (t.ultCharge ?? 0) * PER_FLOOR.ultCharge;
  return perFloor * floors;
}

function effectValue(e: GoedamEffect, p: PlayerState, params: GoedamParams, floor: number): number {
  const living = p.party.filter(m => !m.dead);
  const missing = living.length ? living.reduce((a, m) => a + 1 - m.hp / m.maxHp, 0) / living.length : 0;
  switch (e.kind) {
    case 'hpLoss':
      return -HP_VALUE * e.pct * (1 - missing);
    case 'heal':
      return HP_VALUE * Math.min(e.pct, missing);
    case 'revive':
      return 0.5 * p.party.filter(m => m.dead).length;
    case 'ultSet':
      return ULT_VALUE * (e.value - p.ult.charge);
    case 'ultAdd':
      return ULT_VALUE * Math.min(e.value, 1 - p.ult.charge);
    case 'resetCooldowns':
      return e.petsOnly ? 0.08 : 0.15;
    case 'reward':
      return rewardValue(e.weights);
    case 'rewardFixed':
      return RARITY_VALUE[getReward(e.rewardId).rarity];
    case 'copyReward':
      return params.copy ? RARITY_VALUE[getReward(params.copy.rewardId).rarity] : 0;
    case 'relic':
      return params.relicId ? RELIC_VALUE : RARITY_VALUE.epic;
    case 'trace':
      return traceValue(e.traceId, floor);
  }
}

/** Expected value of an option for this player (greedy). The corridor is read right (the anomaly is on screen). */
export function goedamOptionValue(o: GoedamOptionDef, p: PlayerState, params: GoedamParams, floor: number): number {
  const sum = (es: GoedamEffect[]) => es.reduce((a, e) => a + effectValue(e, p, params, floor), 0);
  let v = sum(o.cost ?? []);
  if (o.outcomes.some(x => x.when)) {
    const seen = params.anomaly ? 'anomaly' : 'normal';
    return v + sum((o.outcomes.find(x => x.when === seen) ?? o.outcomes[0]).effects);
  }
  for (const x of o.outcomes) v += (x.chance ?? 0) * sum(x.effects);
  return v;
}

/** The option this policy takes for player `pi` in the open room (an option id; 'leave' when nothing else applies). */
export function goedamPick(w: World, pi: number, pol: GoedamPolicy): string {
  const g = w.state.goedam!;
  const pr = g.players[pi];
  const visible = pr.options.filter(o => !o.hidden).map(o => o.id);
  switch (pol.kind) {
    case 'off':
    case 'leave':
      return 'leave';
    case 'first':
      return visible[0];
    case 'random':
      return new Rng(mixSeed(w.state.seed, 0x5eed6d, g.floor, pi)).pick(visible);
    case 'forced':
      return g.roomId === pol.room && visible.includes(pol.option!) ? pol.option! : 'leave';
    case 'greedy': {
      const room = getGoedamRoom(g.roomId);
      const p = w.state.players[pi];
      let best = 'leave';
      let bestV = 0;
      for (const id of visible) {
        const v = goedamOptionValue(room.options.find(o => o.id === id)!, p, pr.params, g.floor);
        if (v > bestV + 1e-9) [best, bestV] = [id, v];
      }
      return best;
    }
  }
}

// ─────────────────────────── between floors ───────────────────────────

export type RewardPick = (offers: RewardOffer[], pi: number, w: World) => number;
/** Default: the first offer (balance.ts / critic-20f.ts "human"). */
export const firstOffer: RewardPick = () => 0;

export interface GoedamPilot {
  readonly policy: GoedamPolicy;
  /**
   * Call whenever the sim may be between floors: picks rewards (pick) and room options (policy) for `humans`, then
   * 계속, until the next floor starts or the run ends. Also arms the forced room. Returns true if it did anything.
   */
  settle(humans: readonly number[], pick?: RewardPick): boolean;
}

export function goedamPilot(w: World, pol: GoedamPolicy): GoedamPilot {
  const s = w.state;
  const forcedAt = pol.kind === 'forced' ? goedamForcedFloor(s.seed, pol.room!) : null;
  let armed = false;
  const arm = () => {
    if (forcedAt == null || armed || s.phase !== 'combat' || s.floor !== forcedAt) return;
    armed = dispatch(w, { type: 'debug', action: { kind: 'goedamNext', room: pol.room } }).ok;
  };
  arm();
  return {
    policy: pol,
    settle(humans, pick = firstOffer) {
      let acted = false;
      for (let guard = 0; guard < 16 && (s.phase === 'reward' || s.phase === 'goedam'); guard++) {
        acted = true;
        if (s.phase === 'reward') {
          for (const pi of humans) {
            const offers = s.rewardOffersByPlayer[pi];
            if (offers) dispatch(w, { type: 'chooseReward', player: pi, offerIndex: pick(offers, pi, w) });
          }
          continue;
        }
        const g = s.goedam!;
        for (const pi of humans) {
          if (g.players[pi]?.stage === 'choosing') dispatch(w, { type: 'goedam', player: pi, option: goedamPick(w, pi, pol) });
        }
        for (const pi of humans) if (g.players[pi]?.stage === 'result') dispatch(w, { type: 'goedam', player: pi, option: 'continue' });
      }
      if ((s.phase as string) === 'reward' || (s.phase as string) === 'goedam') throw new Error(`[goedam] stuck in phase ${s.phase} on floor ${s.floor}`);
      arm();
      return acted;
    },
  };
}

// ─────────────────────────── report ───────────────────────────

/** One run as the room report needs it (player 0's 수첩 + where the run ended). */
export interface GoedamRunRec {
  victory: boolean;
  /** Floor the run ended on when it did not win (wipe / timeout), else null. */
  deathFloor: number | null;
  /** Last floor reached. */
  endFloor: number;
  log: GoedamLogEntry[];
}

export function goedamRunRec(w: World, victory: boolean, endFloor: number): GoedamRunRec {
  return { victory, deathFloor: victory ? null : endFloor, endFloor, log: w.state.players[0].goedamLog.map(e => ({ ...e })) };
}

/** Did this pick cost HP (fixed cost or the rolled outcome)? */
export function goedamHpCost(e: GoedamLogEntry): boolean {
  const o = getGoedamOption(e.roomId, e.optionId);
  if (!o) return false;
  const out = o.outcomes.find(x => x.id === e.outcome.id);
  return [...(o.cost ?? []), ...(out?.effects ?? [])].some(x => x.kind === 'hpLoss');
}

const pct1 = (a: number, b: number) => (b > 0 ? Math.round((a / b) * 1000) / 10 : null);

/**
 * Room report: rooms per run, per option (picks, outcomes, clear % of runs that took it), death rate on the floor
 * right after a room (all picks / after an HP cost), and every floor's own death rate (reached → ended there).
 */
export function goedamSummary(pol: GoedamPolicy, runs: GoedamRunRec[]): Record<string, unknown> {
  const n = runs.length || 1;
  const opts: Record<string, { n: number; wins: number; outcomes: Record<string, number> }> = {};
  const after: Record<number, { n: number; died: number; hpN: number; hpDied: number }> = {};
  const floorRate: Record<number, { reached: number; died: number }> = {};
  let rooms = 0;
  let taken = 0;
  for (const r of runs) {
    for (let f = 1; f <= r.endFloor; f++) {
      const x = (floorRate[f] ??= { reached: 0, died: 0 });
      x.reached++;
      if (r.deathFloor === f) x.died++;
    }
    for (const e of r.log) {
      rooms++;
      if (e.optionId !== 'leave') taken++;
      const k = `${e.roomId}:${e.optionId}`;
      const o = (opts[k] ??= { n: 0, wins: 0, outcomes: {} });
      o.n++;
      if (r.victory) o.wins++;
      o.outcomes[e.outcome.id] = (o.outcomes[e.outcome.id] ?? 0) + 1;
      const a = (after[e.floor] ??= { n: 0, died: 0, hpN: 0, hpDied: 0 });
      const died = r.deathFloor === e.floor + 1;
      a.n++;
      if (died) a.died++;
      if (goedamHpCost(e)) {
        a.hpN++;
        if (died) a.hpDied++;
      }
    }
  }
  return {
    policy: pol.name,
    roomsPerRun: Math.round((rooms / n) * 100) / 100,
    nonLeavePerRun: Math.round((taken / n) * 100) / 100,
    options: Object.fromEntries(
      Object.entries(opts)
        .sort((a, b) => a[0].localeCompare(b[0]))
        .map(([k, o]) => [k, { n: o.n, clearPct: pct1(o.wins, o.n), outcomes: o.outcomes }]),
    ),
    afterRoom: Object.fromEntries(
      Object.entries(after).map(([f, a]) => [f, { n: a.n, nextDeathPct: pct1(a.died, a.n), hpCostN: a.hpN, hpCostNextDeathPct: pct1(a.hpDied, a.hpN) }]),
    ),
    floorDeathPct: Object.fromEntries(Object.entries(floorRate).map(([f, x]) => [f, { reached: x.reached, died: x.died, pct: pct1(x.died, x.reached) }])),
  };
}
