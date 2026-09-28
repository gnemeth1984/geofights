import { z } from "zod";
import { base, } from "../__core/app";
import { playerProc, withUser } from "../middleware/auth";
import {
  getPlayer,
  leaderboard,
  ledger,
  progression,
  touchLocation,
  uniqueUsername,
} from "../services/players";
import { db } from "../database";
import * as schema from "../database/schema";
import { eq } from "drizzle-orm";
import { ORPCError } from "@orpc/server";
import { weeklyLeaderboards } from "../services/cron";
import { collectionLog } from "../services/nature";

/**
 * Player accounts. Registration and sign-in are handled by Better Auth at
 * `/api/auth/*`; the game profile is created lazily on the first authenticated
 * call (see `playerProc`), so a client never has to bootstrap it explicitly.
 */
export const players = {
  /** Whoever is calling, or null when signed out — safe for a cold client. */
  session: withUser.handler(({ context }) => ({
    signedIn: Boolean(context.user),
    user: context.user,
  })),

  /** The caller's full profile, creating it on first touch. */
  me: playerProc.handler(async ({ context }) => {
    const player = await getPlayer(context.player.id);
    const avatars = await db
      .select({ id: schema.avatar.id, name: schema.avatar.name, rarity: schema.avatar.rarity })
      .from(schema.avatar)
      .where(eq(schema.avatar.ownerId, player.id));
    return { ...player, progression: progression(player.xp), avatars };
  }),

  updateProfile: playerProc
    .input(z.object({ username: z.string().min(3).max(16).regex(/^[a-zA-Z0-9_]+$/) }))
    .handler(async ({ input, context }) => {
      const [taken] = await db
        .select({ id: schema.player.id })
        .from(schema.player)
        .where(eq(schema.player.username, input.username));
      if (taken && taken.id !== context.player.id) {
        throw new ORPCError("BAD_REQUEST", { message: "Username taken" });
      }
      const [updated] = await db
        .update(schema.player)
        .set({ username: input.username, updatedAt: new Date() })
        .where(eq(schema.player.id, context.player.id))
        .returning();
      return updated!;
    }),

  /** Heartbeat + GPS position, used by the nature and matchmaking systems. */
  ping: playerProc
    .input(z.object({ lat: z.number().optional(), lng: z.number().optional() }))
    .handler(async ({ input, context }) => {
      await touchLocation(context.player.id, input.lat, input.lng);
      return { ok: true, at: new Date().toISOString() };
    }),

  stats: playerProc.handler(async ({ context }) => {
    const player = await getPlayer(context.player.id);
    const winRate = player.matchesPlayed === 0 ? 0 : player.wins / player.matchesPlayed;
    return {
      currency: player.currency,
      wins: player.wins,
      losses: player.losses,
      matchesPlayed: player.matchesPlayed,
      winRate: Math.round(winRate * 100) / 100,
      progression: progression(player.xp),
    };
  }),

  /** Public profile card for another player. */
  profile: base
    .input(z.object({ playerId: z.string() }))
    .handler(async ({ input }) => {
      const player = await getPlayer(input.playerId);
      return {
        id: player.id,
        username: player.username,
        level: player.level,
        xp: player.xp,
        wins: player.wins,
        losses: player.losses,
        matchesPlayed: player.matchesPlayed,
      };
    }),

  leaderboard: base
    .input(z.object({ limit: z.number().int().min(1).max(100).default(25) }).optional())
    .handler(({ input }) => leaderboard(input?.limit ?? 25)),

  /** Latest weekly snapshot written by the leaderboard cron. */
  weeklyLeaderboard: base.handler(() => weeklyLeaderboards()),

  /** Currency ledger for the caller. */
  transactions: playerProc
    .input(z.object({ limit: z.number().int().min(1).max(200).default(50) }).optional())
    .handler(({ input, context }) => ledger(context.player.id, input?.limit ?? 50)),

  /** Nature pickups the caller has made. */
  collectionLog: playerProc
    .input(z.object({ limit: z.number().int().min(1).max(200).default(50) }).optional())
    .handler(({ input, context }) => collectionLog(context.player.id, input?.limit ?? 50)),

  /** Suggest a free username — useful on a sign-up screen. */
  suggestUsername: base
    .input(z.object({ base: z.string().min(1).max(24) }))
    .handler(({ input }) => uniqueUsername(input.base).then((username) => ({ username }))),
};
