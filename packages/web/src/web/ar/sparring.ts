import {
  COMBO_MOVES,
  modelIdForForm,
  movesForForm,
  nameForForm,
  parseCreatureDescription,
  type AttackMove,
  type ComboMove,
  type CreatureForm,
  type DefenseMove,
} from "../../api/lib/creature-form";

/**
 * The training partner.
 *
 * A sparring creature is rolled the same way every other creature in the game
 * is: `parseCreatureDescription` with an empty sentence, so every trait comes
 * off the seed and the body is a legal one the mesh already knows how to build
 * and animate. There is no bot asset, no separate move table and no server
 * round trip — a seed is the whole thing, which also means the same seed always
 * brings back the same opponent.
 *
 * Nothing it does resolves. It has no battle state, deals no damage and awards
 * nothing; the timer that drives it only chooses which animation to play next.
 */

const RARITIES = ["common", "rare", "epic", "legendary"] as const;

export type SparringPartner = {
  seed: number;
  name: string;
  modelId: string;
  rarity: string;
  /** Booster level the partner animates at — high enough to show combos off. */
  level: number;
  form: CreatureForm;
  /** What it can throw: its own body's attacks, plus the combos its level unlocks. */
  offence: ReadonlyArray<AttackMove | ComboMove>;
  /** What it can answer with, for the moments the player throws first. */
  defence: ReadonlyArray<DefenseMove>;
};

/** A partner from a seed. Same seed, same creature, forever. */
export function rollSparringPartner(seed: number): SparringPartner {
  const form = parseCreatureDescription("", seed);
  // 3 to 5: below 3 almost nothing unlocks, and a partner that only ever
  // bites is a poor demonstration of what the move system does.
  const level = 3 + (Math.abs(Math.round(seed)) % 3);
  const rarity = RARITIES[Math.abs(Math.round(seed)) % RARITIES.length]!;
  const moves = movesForForm(form, level);
  // Combos that open off an incoming hit belong to the defending roll, so the
  // partner's own offence is its attacks plus whatever combos are not those.
  const combos = moves.combos.filter((move) => move !== "dodge_counter" && move !== "absorb_burst");
  return {
    seed,
    name: nameForForm(form, seed),
    modelId: modelIdForForm(form),
    rarity,
    level,
    form,
    offence: [...moves.attacks, ...combos],
    defence: moves.defenses,
  };
}

/** A fresh seed, for "new partner". */
export function newSparringSeed(): number {
  return Math.floor(Math.random() * 1_000_000_000);
}

/** Pick one of a pool at random — which move comes next is not worth seeding. */
export function pickRandom<T>(pool: ReadonlyArray<T>): T | null {
  if (pool.length === 0) return null;
  return pool[Math.floor(Math.random() * pool.length)] ?? null;
}

/**
 * What the partner says when it squares up. Local strings on purpose: the
 * server's voice lines belong to the player's own character, and a training
 * dummy asking the API for dialogue would be a round trip for a joke.
 */
const TAUNTS = [
  "Again. Slower this time.",
  "Show me the combination.",
  "Nothing lands here. Swing anyway.",
  "You are dropping your guard.",
  "Same body, better footwork.",
];

/** The line this partner opens with — stable for the seed, like its body. */
export function sparTaunt(seed: number): string {
  return TAUNTS[Math.abs(Math.round(seed)) % TAUNTS.length]!;
}

/** How often the bot reaches for a combination rather than a single move. */
export const SPAR_COMBO_CHANCE = 0.35;
/** How often the bot blocks the player's swing instead of wearing it. */
export const SPAR_GUARD_CHANCE = 0.45;

/**
 * What the bot throws next.
 *
 * Its offence already holds both kinds — the single moves its body can throw
 * and whatever combinations its level unlocked — so all that is left here is
 * the weighting: roughly a third of its swings reach for a combination, and a
 * body that unlocked none simply never does, because the pool it picks from is
 * its own move list and nothing else.
 */
export function pickBotMove<T extends string>(offence: ReadonlyArray<T>): T | null {
  const isCombo = (move: T) => (COMBO_MOVES as readonly string[]).includes(move);
  const combos = offence.filter(isCombo);
  const singles = offence.filter((move) => !isCombo(move));
  if (combos.length > 0 && Math.random() < SPAR_COMBO_CHANCE) return pickRandom(combos);
  return pickRandom(singles.length > 0 ? singles : combos);
}
