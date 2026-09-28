/**
 * Stats for a fight that is not scored.
 *
 * A real battle reads `attack`, `defense` and `speed` off `battle_state` —
 * rolled once when the match starts, boosters folded in, owned by the server.
 * The training area has no match and therefore no row, so a training exchange
 * has nothing to put through the damage formula.
 *
 * This derives the same three numbers from what the client already knows: the
 * body, its rarity and the level its boosters are on. It is the midpoint of
 * the spread `rollBaseStats` rolls from, scaled by the same rarity power and
 * the same level curve, weighted by the same `statWeightsForForm` — so a
 * training number lands in the range the engine would have produced for that
 * character instead of being a made-up figure.
 *
 * Deliberately deterministic: the variance in a training hit comes from the
 * damage formula, not from re-rolling the fighter between presses. Nothing in
 * here imports the database, so the browser can read it.
 */

import { statWeightsForForm, type CreatureForm } from "./creature-form";

/** Mirrors `RARITY_POWER` in `api/lib/rng.ts`, without its schema import. */
const RARITY_POWER: Record<string, number> = {
  common: 1,
  uncommon: 1.25,
  rare: 1.6,
  epic: 2.1,
  legendary: 2.8,
};

/** Midpoints of the spreads `rollBaseStats` rolls a real avatar from. */
const BASE = { attack: 13, defense: 11.5, speed: 11.5, health: 105 };

/** Mirrors `levelScale` in `api/services/boosters.ts`. */
function levelScale(level: number) {
  return 1 + (Math.min(5, Math.max(1, Math.round(level))) - 1) * 0.1;
}

export interface TrainingStats {
  attack: number;
  defense: number;
  speed: number;
  health: number;
}

export function trainingStats(input: {
  form: CreatureForm | null | undefined;
  rarity?: string | null;
  level?: number | null;
}): TrainingStats {
  const power = RARITY_POWER[input.rarity ?? "common"] ?? 1;
  const scale = power * levelScale(input.level ?? 1);
  const weights = input.form
    ? statWeightsForForm(input.form)
    : { attack: 1, defense: 1, speed: 1, health: 1 };
  return {
    attack: Math.round(BASE.attack * scale * weights.attack),
    defense: Math.round(BASE.defense * scale * weights.defense),
    speed: Math.round(BASE.speed * scale * weights.speed),
    health: Math.round(BASE.health * scale * weights.health),
  };
}
