import { and, eq, inArray, isNull } from "drizzle-orm";
import { ORPCError } from "@orpc/server";
import { db } from "../database";
import * as schema from "../database/schema";
import { blockedIds } from "./moderation";

/**
 * Who may share a match with whom.
 *
 * A match is a social container like a team or a chat channel, so it obeys
 * the same partition: adults and under-18s never meet, blocked pairs never
 * meet, and an account that has not finished sign-up (age band + area) or is
 * under review does not fight anyone. Under-13s additionally wait for the
 * parent email to be confirmed before they can fight other people.
 */

type Gatekept = Pick<
  typeof schema.player.$inferSelect,
  "id" | "ageBand" | "ageTier" | "homeSetAt" | "parentConsentAt" | "moderationState"
>;

const cols = {
  id: schema.player.id,
  ageBand: schema.player.ageBand,
  ageTier: schema.player.ageTier,
  homeSetAt: schema.player.homeSetAt,
  parentConsentAt: schema.player.parentConsentAt,
  moderationState: schema.player.moderationState,
};

async function load(playerId: string): Promise<Gatekept> {
  const [row] = await db.select(cols).from(schema.player).where(eq(schema.player.id, playerId));
  if (!row) throw new ORPCError("NOT_FOUND", { message: "Player not found" });
  return row;
}

export function matchBlocker(player: Gatekept): string | null {
  if (!player.ageTier || !player.homeSetAt) {
    return "Finish sign-up first — GeoFights needs your age band and your area.";
  }
  if (player.moderationState !== "active") {
    return player.moderationState === "suspended"
      ? "This account is suspended."
      : "This account is paused while a report is reviewed.";
  }
  if (player.ageBand === "under13" && !player.parentConsentAt) {
    return "A parent has to confirm by email before you can fight other players.";
  }
  return null;
}

/** Throws unless this account may be in a match with anyone. */
export async function requireMatchEligible(playerId: string) {
  const player = await load(playerId);
  const reason = matchBlocker(player);
  if (reason) throw new ORPCError("FORBIDDEN", { message: reason });
  return player;
}

/** Throws unless `playerId` may join everyone already standing in the match. */
export async function requireCanJoin(playerId: string, matchId: string) {
  const player = await requireMatchEligible(playerId);
  const seated = await db
    .select({ playerId: schema.matchPlayer.playerId })
    .from(schema.matchPlayer)
    .where(and(eq(schema.matchPlayer.matchId, matchId), isNull(schema.matchPlayer.leftAt)));
  const otherIds = seated.map((s) => s.playerId).filter((id) => id !== playerId);
  if (otherIds.length === 0) return;

  const others = await db.select(cols).from(schema.player).where(inArray(schema.player.id, otherIds));
  const blocked = await blockedIds(playerId);
  for (const other of others) {
    if (other.ageTier !== player.ageTier) {
      throw new ORPCError("FORBIDDEN", {
        message: "Adults and under-18s are kept apart in GeoFights. Pick another match.",
      });
    }
    if (blocked.has(other.id)) {
      throw new ORPCError("FORBIDDEN", { message: "That match is not available to you." });
    }
  }
}

/** Filters a list of lobbies down to the ones this viewer may see and join. */
export async function visibleToViewer<T extends { hostPlayerId: string }>(viewerId: string, rows: T[]) {
  if (rows.length === 0) return rows;
  const viewer = await load(viewerId);
  if (matchBlocker(viewer)) return [];
  const hostIds = [...new Set(rows.map((r) => r.hostPlayerId))];
  const hosts = await db
    .select({ id: schema.player.id, ageTier: schema.player.ageTier })
    .from(schema.player)
    .where(inArray(schema.player.id, hostIds));
  const tierOf = new Map(hosts.map((h) => [h.id, h.ageTier]));
  const blocked = await blockedIds(viewerId);
  return rows.filter(
    (r) => r.hostPlayerId === viewerId || (tierOf.get(r.hostPlayerId) === viewer.ageTier && !blocked.has(r.hostPlayerId)),
  );
}
