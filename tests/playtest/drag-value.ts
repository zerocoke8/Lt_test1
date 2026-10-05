// Drag-skill value model (docs/balance.md 3장): every effect of a drag cast → damage-equivalent ("가치").
// The bench (drag-bench.ts) MEASURES the components in real runs; this file only weighs them. Tweak the weights here
// and re-run the bench — docs/balance.md explains each one.

import { getReward } from '../../src/data';
import type { RewardEffect, RewardOffer } from '../../src/types';

/** Weights. 1.0 = "one point of this is worth one point of damage". */
export const VALUE_WEIGHTS = {
  /**
   * 1 HP kept on an ally (healed without overheal, shield actually absorbed, damage prevented by def buff / stun / slow /
   * displacement) = this much damage. Bounds from the bench: the party deals ≈ 2.7× the damage it takes (bench output
   * "dealt/taken"), so if every HP point decided the fight 1 HP ≈ 2.7 damage; if nobody were ever in danger, ≈ 0.
   * Default floors 1–5 sit near the low end (< 0.5 character deaths per active run) but the run is meant to grow to
   * 20 floors → the neutral 1:1, which also makes a pure heal skill worth about a pure damage skill.
   */
  hp: 1.0,
  /**
   * Stun: seconds the stunned enemy was in range of its target × its basic DPS (after that target's defence) = HP
   * prevented. × this. 기획 4차: the attack timer is frozen while stunned (src/sim/units.ts), so a stun of S s on an
   * engaged enemy pushes every later swing back by S (2차 rule: the timer kept running → only the part of the stun
   * after the swing was due counted). Seconds on enemies still walking in are not priced: outcome ablation
   * (tests/review/drag-ablation.ts) showed they keep almost no HP on the party.
   */
  stun: 1.0,
  /** Slow v for t s while the enemy is in range of its target (and not stunned): v × t × basic DPS = HP prevented. */
  slow: 1.0,
  /**
   * Pull / knockback. Was 0.5 × (distance ÷ move speed × DPS); the outcome ablation measured 0 ± 3 HP per cast for
   * both 워든's pull and 거너's knockback (enemies walk straight back in, ranged ones keep firing) → 0. The distance is
   * still reported (disp column).
   */
  displace: 0,
  /** Ally attack / attack-speed buff: realised extra damage of buffed allies (all players) × this. */
  buff: 1.0,
  /**
   * 1 s of my bench cards' swap cooldown removed (크로노, as this bench measures it in a 크로노×3 party) = this × the
   * roster's mean value per cooldown-second. Calibrated on mixed parties (tests/playtest/cd-cut.ts: extra casts the cut
   * buys × one cast's worth, midpoint of the 4 s rhythm and "swap as soon as ready").
   * 2차–5차 (cooldown from appearing): 0 at a 4 s rhythm (cards were back anyway) … 1 when swapping fast → 0.5.
   * 기획 6차 (cooldown from leaving): every swap is cooldown-bound and the card that just left always carries a fresh
   * cooldown → the same midpoint is 0.8 (with the 2 s cut; 1.0 with the old 4 s cut). docs/balance.md 0-2.
   */
  cdSec: 0.8,
};

/** Per-cast averages measured by the bench (raw units). */
export interface DragComponents {
  /** Raw drag damage dealt (incl. DoT / delayed parts / zone ticks), overkill excluded. */
  dmg: number;
  /** Enemy-seconds stunned (realised: while alive), of those in range of its target, and the HP that prevented. */
  stunSec: number;
  stunEngSec: number;
  stunHp: number;
  /** Σ slow strength × seconds (realised) and the HP that prevented. */
  slowSec: number;
  slowHp: number;
  /** Realised pull / knockback distance (Σ units over enemies) and the HP that prevented. */
  dispUnits: number;
  dispHp: number;
  /** Ally HP healed (no overheal). */
  heal: number;
  /** Self / ally shield actually absorbed (granted is reported separately). */
  shield: number;
  shieldGranted: number;
  /** Damage prevented on allies by a def buff. */
  defHp: number;
  /** Extra damage dealt by allies thanks to an atk / attack-speed buff. */
  buffDmg: number;
  /** Ally-seconds under one of my drag buffs. */
  buffAllySec: number;
  /** Seconds of bench swap cooldown removed. */
  cdSec: number;
}

export const zeroComponents = (): DragComponents => ({
  dmg: 0,
  stunSec: 0,
  stunEngSec: 0,
  stunHp: 0,
  slowSec: 0,
  slowHp: 0,
  dispUnits: 0,
  dispHp: 0,
  heal: 0,
  shield: 0,
  shieldGranted: 0,
  defHp: 0,
  buffDmg: 0,
  buffAllySec: 0,
  cdSec: 0,
});

/** Damage-equivalent split into the four groups the doc shows. cdValuePerSec = roster mean value per cooldown-second. */
export function valueOf(c: DragComponents, cdValuePerSec: number, wt = VALUE_WEIGHTS) {
  const damage = c.dmg;
  const cc = wt.hp * (wt.stun * c.stunHp + wt.slow * c.slowHp + wt.displace * c.dispHp);
  const support = wt.hp * (c.heal + c.shield + c.defHp) + wt.buff * c.buffDmg;
  const special = wt.cdSec * c.cdSec * cdValuePerSec;
  return { damage, cc, support, special, total: damage + cc + support + special };
}

/** Floor reward that leaves drag skills untouched (lower = preferred): pet cd > normal cd > ult > def > hp > … */
function rewardRank(eff: RewardEffect): number {
  switch (eff.kind) {
    case 'petCooldown':
      return 0;
    case 'skill':
      return eff.slot === 'normal' ? 1 : eff.slot === 'ult' ? 2 : eff.slot === 'basic' ? 3 : 20;
    case 'stat':
      return eff.mods.defFlat ? 4 : eff.mods.hpPct ? 5 : eff.mods.atkSpeedPct ? 6 : eff.mods.critChance ? 7 : 8;
    case 'appearShield':
      return 15;
    case 'swapCooldown':
      return 16;
  }
}

/** The drag benches' floor-reward pick (drag-bench, cd-cut, drag-ablation): every character stays on its base numbers. */
export function dragNeutralPick(offers: readonly RewardOffer[]): number {
  let pick = 0;
  offers.forEach((o, i) => {
    if (!o.isRelic && rewardRank(getReward(o.rewardId).effect) < rewardRank(getReward(offers[pick].rewardId).effect)) pick = i;
  });
  return pick;
}
