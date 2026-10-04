/**
 * The damage formula, on its own.
 *
 * It used to live inside the battle engine, next to the database. That was
 * fine while the only thing that needed a number was the engine writing it to
 * `battle_state` — but the training area needs the *same* number on the
 * client, where a sparring bout takes it off a local health bar.
 *
 * So the arithmetic moved here, where it has no imports and can be read by the
 * client. The engine still owns the authoritative call for matches: a training
 * bout is computed locally and is never sent anywhere.
 */

/** Damage variance applied to every hit. */
export const DAMAGE_VARIANCE = 0.15;

/** What a crit multiplies the blow by. */
export const CRIT_MULTIPLIER = 1.8;

export interface DamageResult {
  damage: number;
  crit: boolean;
  targetHealth: number;
  killed: boolean;
  /**
   * The rolls, reported rather than hidden.
   *
   * Two of the three terms in this formula are dice, and for months they were
   * invisible: the same move on the same target came out at 14 and then at 19
   * and the player had no way to know that was variance rather than something
   * they did. These come back in the event payload so the feed can show the
   * odds it just rolled against.
   */
  critChance: number;
  /** The variance roll applied, around 1. */
  variance: number;
  /** What the blow would have been at zero variance and no crit. */
  expected: number;
}

export function computeDamage(input: {
  attack: number;
  defense: number;
  attackerSpeed: number;
  targetHealth: number;
  /**
   * Everything outside the stat line: the move's own power, how winded the
   * attacker is, whether the target has a wall behind it. One number so the
   * rounding and the health arithmetic still happen in exactly one place.
   */
  multiplier?: number;
  /** The move's own crit chance, added before the speed term is capped. */
  critBonus?: number;
}): DamageResult {
  const multiplier = input.multiplier ?? 1;
  const mitigation = 100 / (100 + Math.max(0, input.defense) * 2.2);
  const variance = 1 + (Math.random() * 2 - 1) * DAMAGE_VARIANCE;
  const critChance = Math.min(0.35, 0.05 + (input.critBonus ?? 0) + input.attackerSpeed / 400);
  const crit = Math.random() < critChance;
  const base = input.attack * mitigation * multiplier;
  const raw = base * variance * (crit ? CRIT_MULTIPLIER : 1);
  // A blow scaled to nothing deals nothing. Everything else still floors at 1,
  // so a hit is never a no-op the player cannot see.
  const damage = raw <= 0 ? 0 : Math.max(1, Math.round(raw));
  const targetHealth = Math.max(0, input.targetHealth - damage);
  return {
    damage,
    crit,
    targetHealth,
    killed: targetHealth === 0,
    critChance: Math.round(critChance * 1000) / 1000,
    variance: Math.round(variance * 1000) / 1000,
    expected: Math.round(base),
  };
}
