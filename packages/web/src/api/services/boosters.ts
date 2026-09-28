import { and, desc, eq, inArray, isNotNull, isNull } from "drizzle-orm";
import { ORPCError } from "@orpc/server";
import { db } from "../database";
import * as schema from "../database/schema";
import { RARITIES, type Rarity } from "../database/schema";
import { generateBoosterContent } from "../ai/content";
import { ids } from "../lib/ids";
import { RARITY_POWER, pick, randomInt, rollRarity } from "../lib/rng";
import { adjustCurrency, logTransaction } from "./players";
import type { StatBlock } from "../battle/stats";

/** Max boosters that can be equipped to one avatar at a time. */
export const MAX_EQUIPPED_BOOSTERS = 3;
/** Cost in currency to upgrade a booster instance one tier. */
export const UPGRADE_COST_PER_TIER = 250;

/* ------------------------------------------------------- Instance leveling */

/** Hard cap on per-instance level. */
export const BOOSTER_MAX_LEVEL = 5;
/** XP needed to leave level n (index = n - 1). Level 5 is terminal. */
export const BOOSTER_XP_CURVE = [100, 240, 460, 800] as const;
/** XP a booster banks per event, before any multiplier. */
export const BOOSTER_XP_REWARD = { battle_loss: 14, battle_win: 36, exploration: 9 } as const;

export function xpToNextLevel(level: number) {
  if (level >= BOOSTER_MAX_LEVEL) return null;
  return BOOSTER_XP_CURVE[Math.max(0, level - 1)] ?? null;
}

/** Level multiplier applied to stat modifiers and ability damage: 1.0 → 1.4. */
export function levelScale(level: number) {
  const clamped = Math.min(BOOSTER_MAX_LEVEL, Math.max(1, Math.round(level)));
  return 1 + (clamped - 1) * 0.1;
}

/* ------------------------------------------------------------ Booster packs */

export const PACK_TIERS = ["common", "rare", "epic", "mythic"] as const;
export type PackTier = (typeof PACK_TIERS)[number];

export interface PackDef {
  tier: PackTier;
  name: string;
  /** Price in in-game currency. */
  price: number;
  /** How many booster instances the pack mints. */
  size: number;
  /** Weighted rarity table, rolled once per instance. */
  weights: Record<Rarity, number>;
  /** At least one instance rolls at this rarity or better. */
  guarantee: Rarity;
  blurb: string;
}

/**
 * The marketplace sells packs, never single boosters. Each pack rolls its
 * contents from its own weighted rarity table, with a floor guarantee so the
 * expensive tiers always feel worth it.
 */
export const PACKS: Record<PackTier, PackDef> = {
  common: {
    tier: "common",
    name: "Scrap Cache",
    price: 300,
    size: 3,
    weights: { common: 60, uncommon: 30, rare: 8, epic: 2, legendary: 0 },
    guarantee: "common",
    blurb: "Three salvaged cores. Cheap, honest, occasionally surprising.",
  },
  rare: {
    tier: "rare",
    name: "Field Kit",
    price: 900,
    size: 4,
    weights: { common: 28, uncommon: 38, rare: 24, epic: 9, legendary: 1 },
    guarantee: "rare",
    blurb: "Four cores with a rare floor — the standard loadout refresh.",
  },
  epic: {
    tier: "epic",
    name: "Vault Run",
    price: 2_200,
    size: 5,
    weights: { common: 8, uncommon: 24, rare: 36, epic: 27, legendary: 5 },
    guarantee: "epic",
    blurb: "Five cores, one epic guaranteed. Built for serious rosters.",
  },
  mythic: {
    tier: "mythic",
    name: "Mythic Seal",
    price: 5_000,
    size: 5,
    weights: { common: 0, uncommon: 8, rare: 28, epic: 42, legendary: 22 },
    guarantee: "legendary",
    blurb: "A guaranteed legendary and four high rolls behind it.",
  },
};

/** Roll one rarity out of a pack's weighted table. */
function rollPackRarity(weights: Record<Rarity, number>): Rarity {
  const total = RARITIES.reduce((sum, r) => sum + (weights[r] ?? 0), 0);
  if (total <= 0) return "common";
  let roll = Math.random() * total;
  for (const rarity of RARITIES) {
    roll -= weights[rarity] ?? 0;
    if (roll <= 0) return rarity;
  }
  return "common";
}

function rarityIndex(rarity: Rarity) {
  return RARITIES.indexOf(rarity);
}

/** Public pack catalogue — what the marketplace lists. */
export function packCatalogue() {
  return PACK_TIERS.map((tier) => {
    const pack = PACKS[tier];
    const total = RARITIES.reduce((sum, r) => sum + pack.weights[r], 0);
    return {
      ...pack,
      odds: Object.fromEntries(
        RARITIES.map((r) => [r, total ? Math.round((pack.weights[r] / total) * 1000) / 10 : 0]),
      ) as Record<Rarity, number>,
    };
  });
}

/**
 * Buy and open a pack: charges the player, rolls `size` rarities from the
 * pack's table (upgrading one roll when the guarantee was not hit) and mints a
 * `booster_instance` per roll. Reuses the existing definition pool.
 */
export async function buyPack(input: { tier: PackTier; playerId: string }) {
  const pack = PACKS[input.tier];
  if (!pack) throw new ORPCError("NOT_FOUND", { message: "Unknown pack" });

  await adjustCurrency(input.playerId, -pack.price);

  const rolls: Rarity[] = [];
  for (let i = 0; i < pack.size; i++) rolls.push(rollPackRarity(pack.weights));
  // Honour the floor guarantee: promote the weakest roll when nothing hit it.
  if (!rolls.some((r) => rarityIndex(r) >= rarityIndex(pack.guarantee))) {
    let weakest = 0;
    for (let i = 1; i < rolls.length; i++) {
      if (rarityIndex(rolls[i]!) < rarityIndex(rolls[weakest]!)) weakest = i;
    }
    rolls[weakest] = pack.guarantee;
  }

  const contents = [];
  for (const rarity of rolls) {
    const definition = await pickBoosterDefinition(rarity, "shop");
    const instance = await mintBoosterInstance({
      boosterId: definition.id,
      ownerId: input.playerId,
      acquiredVia: "pack",
    });
    contents.push({
      instance,
      booster: {
        ...definition,
        statModifiers: JSON.parse(definition.statModifiers) as Partial<StatBlock>,
      },
    });
  }

  await logTransaction({
    type: "shop_purchase",
    fromPlayerId: input.playerId,
    amount: pack.price,
    netAmount: -pack.price,
    note: `Opened ${pack.name} (${contents.length} boosters)`,
  });

  return { pack, spent: pack.price, contents };
}

/**
 * Bank XP on a player's equipped boosters and level them up. Called after
 * battles and nature pickups — exploring levels a loadout as surely as
 * fighting does, just slower.
 */
export async function awardBoosterXp(input: {
  ownerId: string;
  avatarId?: string | null;
  amount: number;
}) {
  if (input.amount <= 0) return [];

  const filters = [
    eq(schema.boosterInstance.ownerId, input.ownerId),
    isNull(schema.boosterInstance.supersededAt),
  ];
  if (input.avatarId) filters.push(eq(schema.boosterInstance.equippedAvatarId, input.avatarId));
  else filters.push(isNotNull(schema.boosterInstance.equippedAvatarId));

  const equipped = await db
    .select({ instance: schema.boosterInstance, booster: schema.booster })
    .from(schema.boosterInstance)
    .innerJoin(schema.booster, eq(schema.booster.id, schema.boosterInstance.boosterId))
    .where(and(...filters));

  const progressed = [];
  for (const row of equipped) {
    const before = row.instance.level;
    let level = before;
    let xp = row.instance.xp + input.amount;
    for (;;) {
      const need = xpToNextLevel(level);
      if (need === null || xp < need) break;
      xp -= need;
      level += 1;
    }
    if (level >= BOOSTER_MAX_LEVEL) xp = 0;

    await db
      .update(schema.boosterInstance)
      .set({ level, xp })
      .where(eq(schema.boosterInstance.id, row.instance.id));

    progressed.push({
      instanceId: row.instance.id,
      name: row.booster.name,
      rarity: row.booster.rarity,
      level,
      xp,
      xpToNext: xpToNextLevel(level),
      leveledUp: level > before,
    });
  }
  return progressed;
}

/** Roll stat modifiers inside the rarity's power budget. */
export function rollStatModifiers(rarity: Rarity): Partial<StatBlock> {
  const budget = Math.round(12 * RARITY_POWER[rarity]);
  const focus = pick(["attack", "defense", "speed", "health"] as const);
  const mods: Partial<StatBlock> = {};
  // Health scales in bigger numbers than the other stats.
  const scale = focus === "health" ? 4 : 1;
  mods[focus] = budget * scale;
  if (rarity !== "common") {
    const second = pick((["attack", "defense", "speed", "health"] as const).filter((s) => s !== focus));
    mods[second] = Math.round((budget * (second === "health" ? 4 : 1)) / 2);
  }
  return mods;
}

export function priceForRarity(rarity: Rarity) {
  return { common: 120, uncommon: 260, rare: 550, epic: 1_100, legendary: 2_400 }[rarity];
}

/** Create a new AI-generated booster definition. */
export async function createBoosterDefinition(input: {
  rarity?: Rarity;
  origin?: "shop" | "nature" | "battle" | "any";
  tier?: number;
}) {
  const rarity = input.rarity ?? rollRarity();
  const tier = input.tier ?? 1;
  const origin = input.origin ?? "any";
  const statModifiers = rollStatModifiers(rarity);
  const content = await generateBoosterContent({ rarity, statModifiers, origin, tier });

  const [row] = await db
    .insert(schema.booster)
    .values({
      id: ids.booster(),
      name: content.name,
      rarity,
      statModifiers: JSON.stringify(statModifiers),
      description: content.description,
      unlocksAbility: content.unlocksAbility,
      abilityDescription: content.abilityDescription,
      tier,
      price: priceForRarity(rarity),
      origin,
    })
    .returning();
  return row!;
}

/** Pick an existing definition for a rarity, generating one if the pool is thin. */
export async function pickBoosterDefinition(rarity: Rarity, origin: "shop" | "nature" | "battle" | "any") {
  const pool = await db
    .select()
    .from(schema.booster)
    .where(
      and(
        eq(schema.booster.rarity, rarity),
        inArray(schema.booster.origin, [origin, "any"]),
        eq(schema.booster.tier, 1),
      ),
    )
    .limit(40);
  if (pool.length >= 4) return pick(pool);
  return createBoosterDefinition({ rarity, origin });
}

/** How many shop-visible definitions each rarity keeps in stock. */
export const SHOP_STOCK_PER_RARITY = 3;

/**
 * Guarantee the shop always has something to sell. Counts the shop-visible
 * definitions per rarity and mints the missing ones (AI-generated, with the
 * deterministic fallback when the gateway is down). Cheap after the first run:
 * once stocked it is a single count query per rarity.
 */
export async function ensureShopStock(perRarity = SHOP_STOCK_PER_RARITY) {
  const rows = await db
    .select({ id: schema.booster.id, rarity: schema.booster.rarity })
    .from(schema.booster)
    .where(and(inArray(schema.booster.origin, ["shop", "any"]), eq(schema.booster.tier, 1)));

  const missing: Rarity[] = [];
  for (const rarity of RARITIES) {
    const have = rows.filter((row) => row.rarity === rarity).length;
    for (let i = have; i < perRarity; i++) missing.push(rarity);
  }
  if (missing.length === 0) return [];
  return Promise.all(
    missing.map((rarity) => createBoosterDefinition({ rarity, origin: "shop" })),
  );
}

/** Give a player a copy of a booster definition. */
export async function mintBoosterInstance(input: {
  boosterId: string;
  ownerId: string;
  acquiredVia: (typeof schema.boosterInstance.$inferInsert)["acquiredVia"];
  upgradedFromId?: string;
  /** Carried over when an upgrade replaces an already-levelled instance. */
  level?: number;
  xp?: number;
}) {
  const [row] = await db
    .insert(schema.boosterInstance)
    .values({
      id: ids.boosterInstance(),
      boosterId: input.boosterId,
      ownerId: input.ownerId,
      acquiredVia: input.acquiredVia,
      level: Math.min(BOOSTER_MAX_LEVEL, Math.max(1, input.level ?? 1)),
      xp: Math.max(0, input.xp ?? 0),
      upgradedFromId: input.upgradedFromId ?? null,
    })
    .returning();
  return row!;
}

export async function inventory(ownerId: string) {
  const rows = await db
    .select({ instance: schema.boosterInstance, booster: schema.booster })
    .from(schema.boosterInstance)
    .innerJoin(schema.booster, eq(schema.booster.id, schema.boosterInstance.boosterId))
    .where(eq(schema.boosterInstance.ownerId, ownerId))
    .orderBy(desc(schema.boosterInstance.createdAt));
  return rows.map((row) => ({
    ...row.instance,
    booster: { ...row.booster, statModifiers: JSON.parse(row.booster.statModifiers) as Partial<StatBlock> },
  }));
}

export async function getInstanceOwned(instanceId: string, ownerId: string) {
  const [row] = await db
    .select({ instance: schema.boosterInstance, booster: schema.booster })
    .from(schema.boosterInstance)
    .innerJoin(schema.booster, eq(schema.booster.id, schema.boosterInstance.boosterId))
    .where(and(eq(schema.boosterInstance.id, instanceId), eq(schema.boosterInstance.ownerId, ownerId)));
  if (!row) throw new ORPCError("NOT_FOUND", { message: "Booster not in your inventory" });
  return row;
}

export async function equip(input: { instanceId: string; avatarId: string; ownerId: string }) {
  const { instance } = await getInstanceOwned(input.instanceId, input.ownerId);
  if (instance.supersededAt) {
    throw new ORPCError("BAD_REQUEST", { message: "Superseded boosters cannot be equipped" });
  }
  if (instance.listedListingId) {
    throw new ORPCError("BAD_REQUEST", { message: "Unlist the booster before equipping it" });
  }

  const [avatar] = await db
    .select()
    .from(schema.avatar)
    .where(and(eq(schema.avatar.id, input.avatarId), eq(schema.avatar.ownerId, input.ownerId)));
  if (!avatar) throw new ORPCError("NOT_FOUND", { message: "Avatar not found" });

  const current = await db
    .select({ id: schema.boosterInstance.id })
    .from(schema.boosterInstance)
    .where(
      and(
        eq(schema.boosterInstance.equippedAvatarId, input.avatarId),
        isNull(schema.boosterInstance.supersededAt),
      ),
    );
  if (current.length >= MAX_EQUIPPED_BOOSTERS && !current.some((c) => c.id === instance.id)) {
    throw new ORPCError("BAD_REQUEST", {
      message: `An avatar can hold ${MAX_EQUIPPED_BOOSTERS} boosters — unequip one first`,
    });
  }

  const [updated] = await db
    .update(schema.boosterInstance)
    .set({ equippedAvatarId: input.avatarId })
    .where(eq(schema.boosterInstance.id, instance.id))
    .returning();
  return updated!;
}

export async function unequip(instanceId: string, ownerId: string) {
  await getInstanceOwned(instanceId, ownerId);
  const [updated] = await db
    .update(schema.boosterInstance)
    .set({ equippedAvatarId: null })
    .where(eq(schema.boosterInstance.id, instanceId))
    .returning();
  return updated!;
}

/** Buy a shop booster with in-game currency. */
export async function purchase(input: { boosterId: string; playerId: string }) {
  const [definition] = await db
    .select()
    .from(schema.booster)
    .where(eq(schema.booster.id, input.boosterId));
  if (!definition) throw new ORPCError("NOT_FOUND", { message: "Booster not found" });
  if (definition.price <= 0) throw new ORPCError("BAD_REQUEST", { message: "Not for sale" });

  await adjustCurrency(input.playerId, -definition.price);
  const instance = await mintBoosterInstance({
    boosterId: definition.id,
    ownerId: input.playerId,
    acquiredVia: "purchase",
  });
  await logTransaction({
    type: "shop_purchase",
    fromPlayerId: input.playerId,
    amount: definition.price,
    netAmount: -definition.price,
    note: `Bought ${definition.name}`,
  });
  return { instance, booster: definition };
}

/**
 * Upgrade a booster instance: mints a tier+1 definition/instance and marks the
 * old instance superseded — it stays in the inventory as a tradable item.
 */
export async function upgrade(input: { instanceId: string; playerId: string }) {
  const { instance, booster } = await getInstanceOwned(input.instanceId, input.playerId);
  if (instance.supersededAt) {
    throw new ORPCError("BAD_REQUEST", { message: "Already upgraded" });
  }
  const cost = UPGRADE_COST_PER_TIER * booster.tier;
  await adjustCurrency(input.playerId, -cost);

  const nextTier = booster.tier + 1;
  const mods = JSON.parse(booster.statModifiers) as Partial<StatBlock>;
  const [upgradedDefinition] = await db
    .insert(schema.booster)
    .values({
      id: ids.booster(),
      name: `${booster.name} Mk${romanize(nextTier)}`,
      rarity: booster.rarity,
      statModifiers: JSON.stringify(scaleMods(mods, 1.5)),
      description: `${booster.description} Refitted to tier ${nextTier}.`,
      unlocksAbility: booster.unlocksAbility,
      abilityDescription: booster.abilityDescription,
      tier: nextTier,
      price: Math.round(booster.price * 1.8),
      origin: booster.origin,
      aiGenerated: booster.aiGenerated,
    })
    .returning();

  const newInstance = await mintBoosterInstance({
    boosterId: upgradedDefinition!.id,
    ownerId: input.playerId,
    acquiredVia: "upgrade",
    upgradedFromId: instance.id,
    level: instance.level,
    xp: instance.xp,
  });

  await db
    .update(schema.boosterInstance)
    .set({ supersededAt: new Date(), equippedAvatarId: null, tradable: true })
    .where(eq(schema.boosterInstance.id, instance.id));

  if (instance.equippedAvatarId) {
    await db
      .update(schema.boosterInstance)
      .set({ equippedAvatarId: instance.equippedAvatarId })
      .where(eq(schema.boosterInstance.id, newInstance.id));
  }

  await logTransaction({
    type: "upgrade",
    fromPlayerId: input.playerId,
    amount: cost,
    netAmount: -cost,
    note: `Upgraded ${booster.name} to tier ${nextTier}`,
  });

  return { instance: newInstance, booster: upgradedDefinition!, cost, supersededInstanceId: instance.id };
}

/** Battle reward drop — returns the minted instance, or null when nothing drops. */
export async function rollBattleDrop(playerId: string, luck = 1) {
  if (Math.random() > 0.45 * luck) return null;
  const rarity = rollRarity(luck);
  const definition = await pickBoosterDefinition(rarity, "battle");
  const instance = await mintBoosterInstance({
    boosterId: definition.id,
    ownerId: playerId,
    acquiredVia: "battle",
  });
  return { instance, booster: definition };
}

/** Three starter commons for a brand new player. */
export async function grantStarterKit(playerId: string) {
  const granted = [];
  for (let i = 0; i < 2; i++) {
    const definition = await pickBoosterDefinition(i === 0 ? "common" : "uncommon", "any");
    granted.push(
      await mintBoosterInstance({
        boosterId: definition.id,
        ownerId: playerId,
        acquiredVia: "starter",
      }),
    );
  }
  return granted;
}

export function scaleMods(mods: Partial<StatBlock>, factor: number): Partial<StatBlock> {
  const out: Partial<StatBlock> = {};
  for (const [key, value] of Object.entries(mods)) {
    if (typeof value === "number" && value !== 0) out[key as keyof StatBlock] = Math.round(value * factor);
  }
  return out;
}

function romanize(n: number) {
  return ["", "I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X"][n] ?? String(n);
}

export { randomInt };
