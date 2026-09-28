import { z } from "zod";
import { base } from "../__core/app";
import { playerProc } from "../middleware/auth";
import { MARKET_ITEM_TYPES, RARITIES } from "../database/schema";
import {
  FEE_RATE,
  MAX_PRICE,
  MIN_PRICE,
  browse,
  buy,
  cancel,
  feeFor,
  getListing,
  list,
  myListings,
  salesHistory,
  sellableInventory,
} from "../services/marketplace";

/**
 * Marketplace. Fixed prices, in-game currency only, instant transfer, 10% fee
 * on every sale. Listings lock the underlying item, so nothing can be sold
 * twice or taken into a match while it is on sale.
 */
export const marketplace = {
  config: base.handler(() => ({
    feeRate: FEE_RATE,
    minPrice: MIN_PRICE,
    maxPrice: MAX_PRICE,
    itemTypes: MARKET_ITEM_TYPES,
  })),

  browse: base
    .input(
      z.object({
        itemType: z.enum(MARKET_ITEM_TYPES).optional(),
        rarity: z.enum(RARITIES).optional(),
        minPrice: z.number().int().min(0).optional(),
        maxPrice: z.number().int().min(0).optional(),
        sort: z.enum(["recent", "price_asc", "price_desc", "rarity"]).default("recent"),
        limit: z.number().int().min(1).max(100).default(50),
      }).optional(),
    )
    .handler(({ input }) => browse(input ?? {})),

  listing: base
    .input(z.object({ listingId: z.string() }))
    .handler(({ input }) => getListing(input.listingId)),

  /** What the caller could put up for sale right now, with suggested prices. */
  sellable: playerProc.handler(({ context }) => sellableInventory(context.player.id)),

  myListings: playerProc.handler(({ context }) => myListings(context.player.id)),

  /** Preview the fee split before committing to a price. */
  quote: base
    .input(z.object({ price: z.number().int().min(MIN_PRICE).max(MAX_PRICE) }))
    .handler(({ input }) => {
      const { fee, net } = feeFor(input.price);
      return { price: input.price, fee, sellerReceives: net, feeRate: FEE_RATE };
    }),

  sell: playerProc
    .input(
      z.object({
        itemType: z.enum(MARKET_ITEM_TYPES),
        itemId: z.string(),
        price: z.number().int().min(MIN_PRICE).max(MAX_PRICE),
      }),
    )
    .handler(({ input, context }) =>
      list({
        sellerId: context.player.id,
        itemType: input.itemType,
        itemId: input.itemId,
        price: input.price,
      }),
    ),

  cancel: playerProc
    .input(z.object({ listingId: z.string() }))
    .handler(({ input, context }) =>
      cancel({ listingId: input.listingId, sellerId: context.player.id }),
    ),

  buy: playerProc
    .input(z.object({ listingId: z.string() }))
    .handler(({ input, context }) =>
      buy({ listingId: input.listingId, buyerId: context.player.id }),
    ),

  /** Recent sales — the closest thing to a price history for clients. */
  history: base
    .input(z.object({ limit: z.number().int().min(1).max(100).default(50) }).optional())
    .handler(({ input }) => salesHistory(input?.limit ?? 50)),
};
