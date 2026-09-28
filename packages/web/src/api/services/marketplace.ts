import { and, desc, eq, gte, inArray, isNull, lte, sql } from "drizzle-orm";
import { ORPCError } from "@orpc/server";
import { db } from "../database";
import * as schema from "../database/schema";
import { type Rarity } from "../database/schema";
import { ids } from "../lib/ids";
import { adjustCurrency, getPlayer, logTransaction } from "./players";

/**
 * Marketplace — fixed-price, in-game-currency only.
 *
 * Sellers list boosters (instances), avatars, skins or abilities at a price
 * they set. A buyer pays the full price; the house takes `FEE_RATE` and the
 * seller is credited the remainder. Transfer is instant and atomic from the
 * client's point of view: ownership moves in the same call that settles the
 * currency, and every movement is written to the `transaction` ledger.
 */

/** House cut on every sale. */
export const FEE_RATE = 0.1;
export const MIN_PRICE = 10;
export const MAX_PRICE = 1_000_000;

export type MarketItemType = (typeof schema.MARKET_ITEM_TYPES)[number];

export function feeFor(price: number) {
  const fee = Math.round(price * FEE_RATE);
  return { fee, net: price - fee };
}

/* ------------------------------------------------------------------ Browsing */

export async function browse(input: {
  itemType?: MarketItemType;
  rarity?: Rarity;
  minPrice?: number;
  maxPrice?: number;
  sellerId?: string;
  sort?: "recent" | "price_asc" | "price_desc" | "rarity";
  limit?: number;
} = {}) {
  const filters = [eq(schema.marketplaceListing.status, "active")];
  if (input.itemType) filters.push(eq(schema.marketplaceListing.itemType, input.itemType));
  if (input.rarity) filters.push(eq(schema.marketplaceListing.itemRarity, input.rarity));
  if (input.minPrice !== undefined) filters.push(gte(schema.marketplaceListing.price, input.minPrice));
  if (input.maxPrice !== undefined) filters.push(lte(schema.marketplaceListing.price, input.maxPrice));
  if (input.sellerId) filters.push(eq(schema.marketplaceListing.sellerId, input.sellerId));

  const order = {
    recent: desc(schema.marketplaceListing.createdAt),
    price_asc: schema.marketplaceListing.price,
    price_desc: desc(schema.marketplaceListing.price),
    rarity: desc(schema.marketplaceListing.price),
  }[input.sort ?? "recent"];

  const rows = await db
    .select({ listing: schema.marketplaceListing, sellerName: schema.player.username })
    .from(schema.marketplaceListing)
    .innerJoin(schema.player, eq(schema.player.id, schema.marketplaceListing.sellerId))
    .where(and(...filters))
    .orderBy(order)
    .limit(Math.min(100, input.limit ?? 50));

  return rows.map((row) => shapeListing(row.listing, row.sellerName));
}

export async function getListing(listingId: string) {
  const [row] = await db
    .select({ listing: schema.marketplaceListing, sellerName: schema.player.username })
    .from(schema.marketplaceListing)
    .innerJoin(schema.player, eq(schema.player.id, schema.marketplaceListing.sellerId))
    .where(eq(schema.marketplaceListing.id, listingId));
  if (!row) throw new ORPCError("NOT_FOUND", { message: "Listing not found" });
  return shapeListing(row.listing, row.sellerName);
}

export async function myListings(sellerId: string) {
  const rows = await db
    .select()
    .from(schema.marketplaceListing)
    .where(eq(schema.marketplaceListing.sellerId, sellerId))
    .orderBy(desc(schema.marketplaceListing.createdAt))
    .limit(100);
  return rows.map((row) => shapeListing(row));
}

export async function salesHistory(limit = 50) {
  const rows = await db
    .select()
    .from(schema.marketplaceListing)
    .where(eq(schema.marketplaceListing.status, "sold"))
    .orderBy(desc(schema.marketplaceListing.soldAt))
    .limit(limit);
  return rows.map((row) => shapeListing(row));
}

/* ------------------------------------------------------------------- Selling */

/** List an owned item for sale. The item is locked until sold or cancelled. */
export async function list(input: {
  sellerId: string;
  itemType: MarketItemType;
  itemId: string;
  price: number;
}) {
  const price = Math.round(input.price);
  if (price < MIN_PRICE || price > MAX_PRICE) {
    throw new ORPCError("BAD_REQUEST", {
      message: `Price must be between ${MIN_PRICE} and ${MAX_PRICE}`,
    });
  }

  const subject = await loadSellable(input.itemType, input.itemId, input.sellerId);
  const [existing] = await db
    .select({ id: schema.marketplaceListing.id })
    .from(schema.marketplaceListing)
    .where(
      and(
        eq(schema.marketplaceListing.itemId, input.itemId),
        eq(schema.marketplaceListing.status, "active"),
      ),
    );
  if (existing) throw new ORPCError("BAD_REQUEST", { message: "Already listed" });

  const [listing] = await db
    .insert(schema.marketplaceListing)
    .values({
      id: ids.listing(),
      sellerId: input.sellerId,
      itemType: input.itemType,
      itemId: input.itemId,
      itemName: subject.name,
      itemRarity: subject.rarity,
      itemSnapshot: JSON.stringify(subject.snapshot),
      price,
    })
    .returning();

  await lockItem(input.itemType, input.itemId, listing!.id);
  return shapeListing(listing!);
}

export async function cancel(input: { listingId: string; sellerId: string }) {
  const [listing] = await db
    .select()
    .from(schema.marketplaceListing)
    .where(eq(schema.marketplaceListing.id, input.listingId));
  if (!listing) throw new ORPCError("NOT_FOUND", { message: "Listing not found" });
  if (listing.sellerId !== input.sellerId) {
    throw new ORPCError("FORBIDDEN", { message: "Not your listing" });
  }
  if (listing.status !== "active") {
    throw new ORPCError("BAD_REQUEST", { message: `Listing is ${listing.status}` });
  }

  const [updated] = await db
    .update(schema.marketplaceListing)
    .set({ status: "cancelled" })
    .where(eq(schema.marketplaceListing.id, listing.id))
    .returning();
  await lockItem(listing.itemType, listing.itemId, null);
  return shapeListing(updated!);
}

/* -------------------------------------------------------------------- Buying */

/** Buy a listing: charge the buyer, pay the seller net of fee, transfer the item. */
export async function buy(input: { listingId: string; buyerId: string }) {
  const [listing] = await db
    .select()
    .from(schema.marketplaceListing)
    .where(eq(schema.marketplaceListing.id, input.listingId));
  if (!listing) throw new ORPCError("NOT_FOUND", { message: "Listing not found" });
  if (listing.status !== "active") {
    throw new ORPCError("BAD_REQUEST", { message: `Listing is ${listing.status}` });
  }
  if (listing.sellerId === input.buyerId) {
    throw new ORPCError("BAD_REQUEST", { message: "You already own this" });
  }

  const buyer = await getPlayer(input.buyerId);
  if (buyer.currency < listing.price) {
    throw new ORPCError("BAD_REQUEST", { message: "Not enough currency" });
  }
  if (listing.itemType === "avatar") await assertAvatarSlot(input.buyerId);

  // Claim the listing first — the conditional update is the sale lock.
  const claimed = await db
    .update(schema.marketplaceListing)
    .set({ status: "sold", buyerId: input.buyerId, soldAt: new Date() })
    .where(
      and(
        eq(schema.marketplaceListing.id, listing.id),
        eq(schema.marketplaceListing.status, "active"),
      ),
    )
    .returning();
  if (claimed.length === 0) {
    throw new ORPCError("BAD_REQUEST", { message: "Someone else bought it first" });
  }

  const { fee, net } = feeFor(listing.price);
  try {
    await adjustCurrency(input.buyerId, -listing.price);
  } catch (error) {
    // Roll the listing back so a failed charge does not consume the item.
    await db
      .update(schema.marketplaceListing)
      .set({ status: "active", buyerId: null, soldAt: null })
      .where(eq(schema.marketplaceListing.id, listing.id));
    throw error;
  }
  await adjustCurrency(listing.sellerId, net);
  await transferItem(listing.itemType, listing.itemId, input.buyerId);
  await lockItem(listing.itemType, listing.itemId, null);

  const ledgerEntry = await logTransaction({
    type: "market_sale",
    listingId: listing.id,
    fromPlayerId: input.buyerId,
    toPlayerId: listing.sellerId,
    amount: listing.price,
    fee,
    netAmount: net,
    note: `${listing.itemName} (${listing.itemType})`,
  });

  return {
    bought: true,
    listing: shapeListing(claimed[0]!),
    paid: listing.price,
    fee,
    sellerReceived: net,
    transactionId: ledgerEntry.id,
  };
}

/* ------------------------------------------------------------------- Helpers */

/** Everything the player owns that is currently sellable. */
export async function sellableInventory(ownerId: string) {
  const boosters = await db
    .select({ instance: schema.boosterInstance, booster: schema.booster })
    .from(schema.boosterInstance)
    .innerJoin(schema.booster, eq(schema.booster.id, schema.boosterInstance.boosterId))
    .where(
      and(
        eq(schema.boosterInstance.ownerId, ownerId),
        eq(schema.boosterInstance.tradable, true),
        isNull(schema.boosterInstance.listedListingId),
      ),
    );

  const avatars = await db
    .select()
    .from(schema.avatar)
    .where(eq(schema.avatar.ownerId, ownerId));

  const items = await db
    .select()
    .from(schema.item)
    .where(and(eq(schema.item.ownerId, ownerId), isNull(schema.item.listedListingId)));

  return {
    boosters: boosters.map((row) => ({
      itemType: "booster" as const,
      itemId: row.instance.id,
      name: row.booster.name,
      rarity: row.booster.rarity,
      tier: row.booster.tier,
      equippedAvatarId: row.instance.equippedAvatarId,
      superseded: Boolean(row.instance.supersededAt),
      suggestedPrice: Math.round(row.booster.price * 0.8),
    })),
    avatars: avatars.map((row) => ({
      itemType: "avatar" as const,
      itemId: row.id,
      name: row.name,
      rarity: row.rarity,
      suggestedPrice: 300,
    })),
    items: items.map((row) => ({
      itemType: row.type === "skin" ? ("skin" as const) : ("ability" as const),
      itemId: row.id,
      name: row.name,
      rarity: row.rarity,
      suggestedPrice: 200,
    })),
  };
}

async function loadSellable(itemType: MarketItemType, itemId: string, sellerId: string) {
  if (itemType === "booster") {
    const [row] = await db
      .select({ instance: schema.boosterInstance, booster: schema.booster })
      .from(schema.boosterInstance)
      .innerJoin(schema.booster, eq(schema.booster.id, schema.boosterInstance.boosterId))
      .where(
        and(eq(schema.boosterInstance.id, itemId), eq(schema.boosterInstance.ownerId, sellerId)),
      );
    if (!row) throw new ORPCError("NOT_FOUND", { message: "Booster not in your inventory" });
    if (!row.instance.tradable) {
      throw new ORPCError("BAD_REQUEST", { message: "This booster is bound and cannot be traded" });
    }
    return {
      name: row.booster.name,
      rarity: row.booster.rarity,
      snapshot: {
        boosterId: row.booster.id,
        tier: row.booster.tier,
        description: row.booster.description,
        statModifiers: JSON.parse(row.booster.statModifiers),
        unlocksAbility: row.booster.unlocksAbility,
        superseded: Boolean(row.instance.supersededAt),
      },
    };
  }

  if (itemType === "avatar") {
    const [row] = await db
      .select()
      .from(schema.avatar)
      .where(and(eq(schema.avatar.id, itemId), eq(schema.avatar.ownerId, sellerId)));
    if (!row) throw new ORPCError("NOT_FOUND", { message: "Avatar not found" });
    const busy = await db
      .select({ id: schema.matchPlayer.id })
      .from(schema.matchPlayer)
      .innerJoin(schema.match, eq(schema.match.id, schema.matchPlayer.matchId))
      .where(
        and(
          eq(schema.matchPlayer.avatarId, itemId),
          isNull(schema.matchPlayer.leftAt),
          inArray(schema.match.status, ["waiting", "active"]),
        ),
      );
    if (busy.length > 0) {
      throw new ORPCError("BAD_REQUEST", { message: "Avatar is in a match" });
    }
    return {
      name: row.name,
      rarity: row.rarity,
      snapshot: {
        modelId: row.modelId,
        attack: row.attack,
        defense: row.defense,
        speed: row.speed,
        health: row.health,
        specialAbility: row.specialAbility,
        lore: row.lore,
      },
    };
  }

  const [row] = await db
    .select()
    .from(schema.item)
    .where(and(eq(schema.item.id, itemId), eq(schema.item.ownerId, sellerId)));
  if (!row) throw new ORPCError("NOT_FOUND", { message: "Item not found" });
  const expected = itemType === "skin" ? "skin" : "ability";
  if (row.type !== expected) {
    throw new ORPCError("BAD_REQUEST", { message: `That item is a ${row.type}` });
  }
  return {
    name: row.name,
    rarity: row.rarity,
    snapshot: { type: row.type, description: row.description, payload: JSON.parse(row.payload) },
  };
}

/** Point the item at its listing (or clear it) so it cannot be double-sold. */
async function lockItem(itemType: MarketItemType, itemId: string, listingId: string | null) {
  if (itemType === "booster") {
    await db
      .update(schema.boosterInstance)
      .set({ listedListingId: listingId, ...(listingId ? { equippedAvatarId: null } : {}) })
      .where(eq(schema.boosterInstance.id, itemId));
    return;
  }
  if (itemType === "avatar") return;
  await db
    .update(schema.item)
    .set({ listedListingId: listingId, ...(listingId ? { appliedAvatarId: null } : {}) })
    .where(eq(schema.item.id, itemId));
}

async function transferItem(itemType: MarketItemType, itemId: string, buyerId: string) {
  if (itemType === "booster") {
    await db
      .update(schema.boosterInstance)
      .set({ ownerId: buyerId, equippedAvatarId: null, acquiredVia: "marketplace" })
      .where(eq(schema.boosterInstance.id, itemId));
    return;
  }
  if (itemType === "avatar") {
    await db
      .update(schema.boosterInstance)
      .set({ equippedAvatarId: null })
      .where(eq(schema.boosterInstance.equippedAvatarId, itemId));
    await db
      .update(schema.avatar)
      .set({ ownerId: buyerId, updatedAt: new Date() })
      .where(eq(schema.avatar.id, itemId));
    return;
  }
  await db
    .update(schema.item)
    .set({ ownerId: buyerId, appliedAvatarId: null })
    .where(eq(schema.item.id, itemId));
}

async function assertAvatarSlot(buyerId: string) {
  const [row] = await db
    .select({ count: sql<number>`count(*)` })
    .from(schema.avatar)
    .where(eq(schema.avatar.ownerId, buyerId));
  if (Number(row?.count ?? 0) >= 3) {
    throw new ORPCError("BAD_REQUEST", { message: "Avatar slots full — release one first" });
  }
}

function shapeListing(
  listing: typeof schema.marketplaceListing.$inferSelect,
  sellerName?: string,
) {
  const { fee, net } = feeFor(listing.price);
  return {
    ...listing,
    itemSnapshot: safeParse(listing.itemSnapshot),
    sellerName: sellerName ?? null,
    fee,
    sellerReceives: net,
  };
}

function safeParse(value: string): Record<string, unknown> {
  try {
    return JSON.parse(value) as Record<string, unknown>;
  } catch {
    return {};
  }
}
