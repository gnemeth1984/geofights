import { ORPCError } from "@orpc/server";
import { eq } from "drizzle-orm";
import { base } from "../__core/app";
import { auth } from "../auth";
import { db } from "../database";
import * as schema from "../database/schema";
import { ensurePlayer } from "../services/players";

/** Optional auth — `context.user` is the session user or null. */
export const withUser = base.use(async ({ context, next }) => {
  const session = await auth.api.getSession({ headers: context.headers });
  return next({
    context: { user: session?.user ?? null, session: session?.session ?? null },
  });
});

/** Any signed-in account. */
export const authed = base.use(async ({ context, next }) => {
  const session = await auth.api.getSession({ headers: context.headers });
  if (!session) throw new ORPCError("UNAUTHORIZED", { message: "Sign in required" });
  return next({ context: { user: session.user, session: session.session } });
});

/**
 * Signed-in account with its game profile resolved (created on first touch).
 * Every gameplay procedure builds on this and scopes queries by `player.id`.
 */
export const playerProc = authed.use(async ({ context, next }) => {
  const player = await ensurePlayer(context.user);
  return next({ context: { player } });
});

/** Admin-only procedures (admin panel, content generation, cron triggers). */
export const adminProc = playerProc.use(async ({ context, next }) => {
  if (context.player.role !== "admin") {
    throw new ORPCError("FORBIDDEN", { message: "Admin only" });
  }
  return next({ context: { player: context.player } });
});

/** Shared helper for plain HTTP routes (SSE, cron) that need the player. */
export async function playerFromHeaders(headers: Headers) {
  const session = await auth.api.getSession({ headers });
  if (!session) return null;
  const [existing] = await db
    .select()
    .from(schema.player)
    .where(eq(schema.player.userId, session.user.id));
  return existing ?? (await ensurePlayer(session.user));
}
