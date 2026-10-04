// Drag-skill value model (docs/balance.md 3장): every effect of a drag cast → damage-equivalent ("가치").
// The bench (drag-bench.ts) MEASURES the components in real runs; this file only weighs them. Tweak the weights here
// and re-run the bench — docs/balance.md explains each one.

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
   * Stun: seconds the stunned enemy was in range of its target with its attack ready (= how long its next swing was
   * pushed back; the sim keeps the attack timer running during a stun) × its basic DPS = HP prevented. × this.
   * Seconds on enemies still walking in are not priced: outcome ablation (tests/review/drag-ablation.ts) showed they
   * keep almost no HP on the party.
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
   * 1 s of my bench cards' swap cooldown removed (크로노) = this × the roster's mean value per cooldown-second.
   * 1.0 would mean the player always swaps the instant a card is ready; humans don't → 0.5.
   */
  cdSec: 0.5,
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
