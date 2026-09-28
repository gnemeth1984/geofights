import { RARITIES, type Rarity } from "../database/schema";

/** Drop weights per rarity — used by nature spawns, battle rewards and AI rolls. */
export const RARITY_WEIGHTS: Record<Rarity, number> = {
  common: 55,
  uncommon: 25,
  rare: 13,
  epic: 6,
  legendary: 1,
};

/** Stat budget a generated avatar/booster of each rarity is allowed to spend. */
export const RARITY_POWER: Record<Rarity, number> = {
  common: 1,
  uncommon: 1.25,
  rare: 1.6,
  epic: 2.1,
  legendary: 2.8,
};

export function rollRarity(luck = 1): Rarity {
  const weights = RARITIES.map((r) => ({
    rarity: r,
    weight: RARITY_WEIGHTS[r] * (r === "common" ? 1 : luck),
  }));
  const total = weights.reduce((sum, w) => sum + w.weight, 0);
  let roll = Math.random() * total;
  for (const w of weights) {
    roll -= w.weight;
    if (roll <= 0) return w.rarity;
  }
  return "common";
}

export function randomInt(min: number, max: number) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

export function pick<T>(list: readonly T[]): T {
  return list[randomInt(0, list.length - 1)]!;
}

export function shuffle<T>(list: readonly T[]): T[] {
  const out = [...list];
  for (let i = out.length - 1; i > 0; i--) {
    const j = randomInt(0, i);
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}
