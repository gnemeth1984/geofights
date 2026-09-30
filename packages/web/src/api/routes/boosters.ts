import { z } from "zod";
import { and, desc, eq, inArray } from "drizzle-orm";
import { base } from "../__core/app";
import { playerProc } from "../middleware/auth";
import { db } from "../database";
import * as schema from "../database/schema";
import { RARITIES } from "../database/schema";
import {
  BOOSTER_MAX_LEVEL,
  BOOSTER_XP_CURVE,
  BOOSTER_XP_REWARD,
  MAX_EQUIPPED_BOOSTERS,
  PACK_TIERS,
  UPGRADE_COST_PER_TIER,
  buyPack,
  ensureShopStock,
  packCatalogue,
  equip,
  getInstanceOwned,
  inventory,
  purchase,
  unequip,
  upgrade,
} from "../services/boosters";

/**
 * Boosters. A `booster` row is the AI-generated definition (stat modifiers,
 * optional unlocked ability, tier, price); a `booster_instance` is an owned
 * copy. Instances are permanent: upgrading mints a tier+1 instance and leaves
 * the old one in the inventory as a tradable item rather than destroying it.
 */
export const boosters = {
  /** The caller's booster instances, definition inlined. */
  inventory: playerProc.handler(({ context }) => inventory(context.player.id)),

  limits: base.handler(() => ({
    maxEquippedPerAvatar: MAX_EQUIPPED_BOOSTERS,
    upgradeCostPerTier: UPGRADE_COST_PER_TIER,
    maxInstanceLevel: BOOSTER_MAX_LEVEL,
    xpCurve: [...BOOSTER_XP_CURVE],
    xpRewards: BOOSTER_XP_REWARD,
  })),

  /** The pack tiers the marketplace sells, with their drop odds. */
  packs: base.handler(() => packCatalogue()),

  /** Buy and open a pack — charges currency and mints the rolled instances. */
  buyPack: playerProc
    .input(z.object({ tier: z.enum(PACK_TIERS) }))
    .handler(({ input, context }) => buyPack({ tier: input.tier, playerId: context.player.id })),

  get: playerProc
    .input(z.object({ instanceId: z.string() }))
    .handler(({ input, context }) => getInstanceOwned(input.instanceId, context.player.id)),

  /** Purchasable definitions — the rotating shop stock. */
  shop: base
    .input(
      z.object({
        rarity: z.enum(RARITIES).optional(),
        limit: z.number().int().min(1).max(100).default(40),
      }).optional(),
    )
    .handler(async ({ input }) => {
      // Keeps the stock topped up, so a fresh server still has a shop.
      await ensureShopStock();
      const rows = await db
        .select()
        .from(schema.booster)
        // Tier 1 only. `upgrade()` mints a tier+1 definition that inherits the
        // origin of the one it refits, so without this the shop fills up with
        // other players' upgrade artifacts — each 1.8x the price of the last.
        .where(
          input?.rarity
            ? and(
                eq(schema.booster.rarity, input.rarity),
                inArray(schema.booster.origin, ["shop", "any"]),
                eq(schema.booster.tier, 1),
              )
            : and(
                inArray(schema.booster.origin, ["shop", "any"]),
                eq(schema.booster.tier, 1),
              ),
        )
        .orderBy(desc(schema.booster.createdAt))
        .limit(input?.limit ?? 40);
      return rows.map((row) => ({
        ...row,
        statModifiers: JSON.parse(row.statModifiers) as Record<string, number>,
      }));
    }),

  buy: playerProc
    .input(z.object({ boosterId: z.string() }))
    .handler(({ input, context }) =>
      purchase({ boosterId: input.boosterId, playerId: context.player.id }),
    ),

  equip: playerProc
    .input(z.object({ instanceId: z.string(), avatarId: z.string() }))
    .handler(({ input, context }) =>
      equip({
        instanceId: input.instanceId,
        avatarId: input.avatarId,
        ownerId: context.player.id,
      }),
    ),

  unequip: playerProc
    .input(z.object({ instanceId: z.string() }))
    .handler(({ input, context }) => unequip(input.instanceId, context.player.id)),

  /** Spend currency to mint the next tier; the old instance becomes tradable. */
  upgrade: playerProc
    .input(z.object({ instanceId: z.string() }))
    .handler(({ input, context }) =>
      upgrade({ instanceId: input.instanceId, playerId: context.player.id }),
    ),
};
