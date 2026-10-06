// 기획 14차 교체 에너지 (test toggle Tunables.swapEnergyMode). The whole rule lives here; the sim calls in at its few
// swap / cooldown choke points (swap check + spend, per-tick, cooldown cuts, '쿨 0' resets, floor-clear rejoin, debug)
// and the HUD, bots and audio read the pure helpers.
//
// The MODE IS IN THE STATE: while the toggle is on every player carries PlayerState.energy {value, max} and no character
// has a re-appear cooldown (swapCooldownRemaining stays 0); while it is off there is no pool and today's cooldowns run.
// Pure checks (canSwapState on a client snapshot, the HUD) read the mode from the state; the tunable only drives
// syncEnergyMode (run start, every tick, before a command, after a tunables command).
//  a. one pool per player, shared by its 3 characters: max swapEnergyMax, +swapEnergyRegen per second in combat
//     (the sim only ticks in combat; nothing fills while the player is out / spectating).
//  b. a swap-in costs CharacterDef.swapEnergy (4~8, from the measured drag value per cast, docs/balance.md 13-4);
//     a cost above the pool's max costs the whole (full) pool, so a small max never locks a card out.
//  c. cooldown cuts become energy: a cut of N s on my bench (크로노 정지, 시간 토끼, 사냥꾼의 표식) = N s of
//     regen (+N × swapEnergyRegen); '쿨 0' (괴담 room, 돌발 괴담 '교체 쿨 0', debug 쿨 초기화) = a full pool;
//     the reward 빠른 교대 (one card's re-appear cooldown −v s, min 4 s) = that card's cost −v/2 s of regen
//     (v × ENERGY.rewardPerSec × swapEnergyRegen): with today's two bench cards cooling side by side, one card's v
//     seconds are v/2 s of swap rhythm, and a bench-wide cut of N s (two cards) is N s — the same exchange rate.
//     Exception: a character's own refund priced into its cost (크로노 균열, effect.energy = 2) is that fixed energy,
//     so the cost table (measured at regen 1) holds at every regen slider value.
//  d. the pool carries over between floors; the run starts full, and a player revived at a floor start starts full.
//  e. the character that just left may come back at once if the pool allows (the 0.5 s appear lock stays).
// Toggle mid-run: off → on = every pool starts full and the cooldowns running now are dropped; on → off = the pool goes
// away and every card starts ready (cooldown 0). Lowering the max slider clamps the pool; raising it does not refill.
// Default off: every function below is a no-op / today's value (tests/sim/default-off-golden.test.ts).

import type { PlayerState, SwapEnergy, Tunables } from '../types';
import { getCharacter } from '../data';
import { MIN_SWAP_COOLDOWN } from './constants';
import { swapCooldownReduction } from './modifiers';
import type { SimPlayer, World } from './world';

export const ENERGY = {
  /** Energy off a card's cost per second of re-appear cooldown its 빠른 교대 rewards remove (see c above). */
  rewardPerSec: 0.5,
  /** A cost never goes below this (rewards). */
  minCost: 1,
} as const;

/** Float dust: a pool this close to a cost affords it (regen per tick is 1/30 of the rate). */
const EPS = 1e-6;

// ─────────────────────────── Pure (sim, client snapshot, HUD, bots, audio) ───────────────────────────

/** The energy pool of this player (null while the toggle is off). */
export function swapEnergyOf(p: PlayerState): SwapEnergy | null {
  return p.energy ?? null;
}

/** Energy mode is live for this player (it carries a pool). */
export function energyMode(p: PlayerState): boolean {
  return p.energy != null;
}

/**
 * Card idx's swap-in cost from the data and its 빠른 교대 rewards (before the max cap; see swapCostNow). The reward
 * converts at the pool's regen (rule c: v/2 s of regen); with no pool (mode off) at regen 1.
 */
export function swapEnergyCost(p: PlayerState, idx: number): number {
  const def = getCharacter(p.party[idx].defId);
  // the seconds today's rule actually removes (it stops at MIN_SWAP_COOLDOWN), at the 빠른 교대 exchange rate
  const cut = def.swapCooldown - Math.max(MIN_SWAP_COOLDOWN, def.swapCooldown - swapCooldownReduction(p, idx));
  const regen = p.energy ? p.energy.regen : 1;
  return Math.max(ENERGY.minCost, def.swapEnergy - Math.max(0, cut) * ENERGY.rewardPerSec * regen);
}

/** What a swap-in of card idx takes from the pool now: its cost, at most the whole pool (a cost above max = full pool). */
export function swapCostNow(p: PlayerState, idx: number): number {
  const cost = swapEnergyCost(p, idx);
  return p.energy ? Math.min(cost, p.energy.max) : cost;
}

/** The pool allows card idx now (always true while the toggle is off). */
export function canAffordSwap(p: PlayerState, idx: number): boolean {
  return !p.energy || p.energy.value >= swapCostNow(p, idx) - EPS;
}

/** Seconds until the pool affords card idx at `regen` per second (0 = now, Infinity = never at regen 0 / mode off). */
export function energySecondsTo(p: PlayerState, idx: number, regen: number): number {
  if (!p.energy) return Infinity;
  const short = swapCostNow(p, idx) - p.energy.value;
  if (short <= EPS) return 0;
  return regen > 0 ? short / regen : Infinity;
}

/**
 * 'Ready' for the HUD / audio / bots: alive, and no re-appear cooldown (today) or the pool affords it (energy mode).
 * Does not look at the field / appear lock / phase — canSwapState does.
 */
export function cardReady(p: PlayerState, idx: number): boolean {
  const m = p.party[idx];
  if (!m || m.dead) return false;
  return p.energy ? canAffordSwap(p, idx) : m.swapCooldownRemaining <= 0;
}

// ─────────────────────────── Sim ───────────────────────────

const maxOf = (t: Pick<Tunables, 'swapEnergyMax'>) => Math.max(1, t.swapEnergyMax);
const regenOf = (t: Pick<Tunables, 'swapEnergyRegen'>) => Math.max(0, t.swapEnergyRegen);

/** Make every player's mode follow the toggle (run start, every tick, before / after commands). No-op when they agree. */
export function syncEnergyMode(w: World): void {
  const on = !!w.tunables.swapEnergyMode;
  const max = maxOf(w.tunables);
  const regen = regenOf(w.tunables);
  for (const p of w.state.players) {
    if (on) {
      if (!p.energy) {
        // off → on (or the run start): a full pool, today's running cooldowns are dropped
        p.energy = { value: max, max, regen };
        for (const m of p.party) m.swapCooldownRemaining = 0;
      } else {
        if (p.energy.max !== max) {
          p.energy.max = max;
          p.energy.value = Math.min(p.energy.value, max);
        }
        p.energy.regen = regen;
      }
    } else if (p.energy) {
      // on → off: no pool, every card ready (no cooldown was running in energy mode)
      delete p.energy;
      for (const m of p.party) m.swapCooldownRemaining = 0;
    }
  }
}

/** Per-tick regen of one player that is not out (combat only: the sim does not tick otherwise). */
export function tickEnergy(w: World, p: SimPlayer, dt: number): void {
  const e = p.energy;
  if (!e) return;
  if (w.tunables.instantCooldowns) {
    e.value = e.max; // debug 쿨타임 없음: swaps are free
    return;
  }
  const r = e.regen;
  if (e.value < e.max) e.value = Math.min(e.max, e.value + dt * r);
  if (e.max - e.value < EPS) e.value = e.max;
}

/** A swap-in of card idx was accepted: take its cost (nothing with debug 쿨타임 없음). */
export function spendSwapEnergy(w: World, p: SimPlayer, idx: number): void {
  const e = p.energy;
  if (!e || w.tunables.instantCooldowns) return;
  e.value = Math.max(0, e.value - swapCostNow(p, idx));
  if (e.value < EPS) e.value = 0;
}

/**
 * A cooldown cut of `seconds` on this player's bench (크로노, 시간 토끼, 사냥꾼의 표식): today's per-card cut, or in
 * energy mode `seconds` of regen — or exactly `energy` when the effect fixes it (크로노 균열, rule c's exception).
 * The one place both rules meet (combat.ts reduceBenchSwapCd calls it).
 */
export function cutBenchSwap(_w: World, p: SimPlayer, seconds: number, energy?: number): void {
  const e = p.energy;
  if (e) {
    const add = energy ?? Math.max(0, seconds) * e.regen;
    e.value = Math.min(e.max, e.value + Math.max(0, add));
    return;
  }
  p.party.forEach((m, i) => {
    if (i === p.activeIndex) return;
    m.swapCooldownRemaining = Math.max(0, m.swapCooldownRemaining - seconds);
  });
}

/** '쿨 0' for swaps: today = these cards' re-appear cooldowns to 0; energy mode = a full pool. */
export function resetSwapCooldowns(p: SimPlayer, which: 'all' | 'bench' = 'all'): void {
  if (p.energy) {
    p.energy.value = p.energy.max;
    return;
  }
  p.party.forEach((m, i) => {
    if (which === 'bench' && i === p.activeIndex) return;
    m.swapCooldownRemaining = 0;
  });
}
