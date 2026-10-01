import { and, desc, eq, gte, inArray, sql } from "drizzle-orm";
import { ORPCError } from "@orpc/server";
import { db } from "../database";
import * as schema from "../database/schema";
import { ids } from "../lib/ids";
import { filterExplanation, filterName } from "../lib/text-filter";
import { requireCommunity, type Player } from "./consent";
import { blockedIds } from "./moderation";

/**
 * Meet-ups at parks, and the per-park leaderboard.
 *
 * A meet-up is the one feature here that puts two players in the same physical
 * place on purpose, so it is the most tightly fenced thing in the app:
 *
 *   - **Approved zones only.** The same review gate the spawn system uses — a
 *     meet-up cannot be created at an arbitrary coordinate someone typed in.
 *   - **Hosted by 16+.** Not because younger players are the risk, but because
 *     a host is answerable for a gathering.
 *   - **One tier.** A minors' meet-up is invisible to adults and vice versa.
 *   - **Public inside its tier.** No private meet-ups, no hidden invite lists:
 *     anything arranged one-to-one belongs in the open, or not at all.
 *   - **Daylight hours, near future.** A 2 a.m. meet-up in a park is not a
 *     thing this app will help arrange.
 *
 * The leaderboard is per park and rolling 30 days, computed from finished
 * matches rather than stored. Local and recent is the point: a child should be
 * able to be the best at their own playground this month without competing
 * with the whole country forever.
 */

export const MEETUP_MIN_LEAD_MS = 30 * 60 * 1000;
export const MEETUP_MAX_AHEAD_MS = 14 * 24 * 60 * 60 * 1000;
export const MEETUP_CAPACITY = 12;
/** Local clock hours a meet-up may start in. */
export const MEETUP_EARLIEST_HOUR = 8;
export const MEETUP_LATEST_HOUR = 20;
export const PARK_BOARD_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * The hour at the park, not on the server. The server runs in UTC, so
 * `getHours()` would put the 08:00–20:00 window an hour or more off in
 * Ireland in summer. The host's device offset is used when it is plausible for
 * the park's longitude (within 3h of solar time); otherwise the solar estimate
 * is used, so a spoofed offset cannot slide a meet-up into the night.
 */
export function parkLocalHour(at: Date, parkLng: number, tzOffsetMinutes?: number) {
  const solar = -Math.round(parkLng / 15) * 60;
  const offset =
    tzOffsetMinutes !== undefined && Math.abs(tzOffsetMinutes - solar) <= 180 ? tzOffsetMinutes : solar;
  const local = new Date(at.getTime() - offset * 60_000);
  return local.getUTCHours();
}

export async function createMeetup(
  player: Player,
  input: { zoneId: string; title: string; startsAt: Date; capacity?: number; tzOffsetMinutes?: number },
) {
  const access = requireCommunity(player);
  if (!access.host) {
    throw new ORPCError("FORBIDDEN", {
      message: access.newAccount
        ? "New accounts can host a meet-up after their first day."
        : "Meet-ups are hosted by players aged 16 or over.",
    });
  }

  const title = filterName(input.title, 48);
  if (title.blocked) {
    throw new ORPCError("BAD_REQUEST", { message: filterExplanation(title.reasons) });
  }

  const [zone] = await db.select().from(schema.zone).where(eq(schema.zone.id, input.zoneId));
  if (!zone) throw new ORPCError("NOT_FOUND", { message: "Park not found" });
  if (zone.review !== "approved" || !zone.isActive) {
    throw new ORPCError("FORBIDDEN", {
      message: "Meet-ups can only be held at parks GeoFights has approved.",
    });
  }

  const when = input.startsAt.getTime();
  if (when - Date.now() < MEETUP_MIN_LEAD_MS) {
    throw new ORPCError("BAD_REQUEST", { message: "Give people at least half an hour's notice." });
  }
  if (when - Date.now() > MEETUP_MAX_AHEAD_MS) {
    throw new ORPCError("BAD_REQUEST", { message: "Meet-ups can be set up two weeks ahead." });
  }
  const hour = parkLocalHour(input.startsAt, zone.centerLng, input.tzOffsetMinutes);
  if (hour < MEETUP_EARLIEST_HOUR || hour >= MEETUP_LATEST_HOUR) {
    throw new ORPCError("BAD_REQUEST", {
      message: `Meet-ups run between ${MEETUP_EARLIEST_HOUR}:00 and ${MEETUP_LATEST_HOUR}:00.`,
    });
  }

  const meetupId = ids.meetup();
  await db.insert(schema.parkMeetup).values({
    id: meetupId,
    zoneId: zone.id,
    hostId: player.id,
    title: title.text,
    tier: player.ageTier!,
    startsAt: input.startsAt,
    capacity: Math.min(Math.max(input.capacity ?? MEETUP_CAPACITY, 2), 40),
    attendeeCount: 1,
  });
  await db.insert(schema.meetupAttendee).values({
    id: ids.meetupAttendee(),
    meetupId,
    playerId: player.id,
  });
  return { id: meetupId };
}

export async function joinMeetup(player: Player, meetupId: string) {
  requireCommunity(player);
  const [meetup] = await db
    .select()
    .from(schema.parkMeetup)
    .where(eq(schema.parkMeetup.id, meetupId));
  if (!meetup || meetup.status !== "open") {
    throw new ORPCError("NOT_FOUND", { message: "That meet-up is not open." });
  }
  if (meetup.tier !== player.ageTier) {
    throw new ORPCError("FORBIDDEN", {
      message: "That meet-up is for a different age group.",
    });
  }
  if (meetup.startsAt.getTime() < Date.now()) {
    throw new ORPCError("BAD_REQUEST", { message: "That meet-up has already started." });
  }
  if (meetup.attendeeCount >= meetup.capacity) {
    throw new ORPCError("BAD_REQUEST", { message: "That meet-up is full." });
  }
  const blocked = await blockedIds(player.id);
  if (blocked.has(meetup.hostId)) {
    throw new ORPCError("FORBIDDEN", { message: "That meet-up is not available to you." });
  }

  const inserted = await db
    .insert(schema.meetupAttendee)
    .values({ id: ids.meetupAttendee(), meetupId, playerId: player.id })
    .onConflictDoNothing()
    .returning();
  if (inserted.length > 0) {
    await db
      .update(schema.parkMeetup)
      .set({ attendeeCount: sql`${schema.parkMeetup.attendeeCount} + 1` })
      .where(eq(schema.parkMeetup.id, meetupId));
  }
  return { ok: true as const };
}

export async function leaveMeetup(player: Player, meetupId: string) {
  const removed = await db
    .delete(schema.meetupAttendee)
    .where(
      and(
        eq(schema.meetupAttendee.meetupId, meetupId),
        eq(schema.meetupAttendee.playerId, player.id),
      ),
    )
    .returning();
  if (removed.length > 0) {
    await db
      .update(schema.parkMeetup)
      .set({ attendeeCount: sql`max(${schema.parkMeetup.attendeeCount} - 1, 0)` })
      .where(eq(schema.parkMeetup.id, meetupId));
  }
  // The host leaving cancels it rather than orphaning a gathering.
  const [meetup] = await db
    .select()
    .from(schema.parkMeetup)
    .where(eq(schema.parkMeetup.id, meetupId));
  if (meetup?.hostId === player.id && meetup.status === "open") {
    await db
      .update(schema.parkMeetup)
      .set({ status: "cancelled" })
      .where(eq(schema.parkMeetup.id, meetupId));
  }
  return { ok: true as const };
}

export async function cancelMeetup(player: Player, meetupId: string) {
  const [meetup] = await db
    .select()
    .from(schema.parkMeetup)
    .where(eq(schema.parkMeetup.id, meetupId));
  if (!meetup) throw new ORPCError("NOT_FOUND", { message: "Meet-up not found" });
  if (meetup.hostId !== player.id && player.role !== "admin") {
    throw new ORPCError("FORBIDDEN", { message: "Only the host can cancel it." });
  }
  await db
    .update(schema.parkMeetup)
    .set({ status: "cancelled" })
    .where(eq(schema.parkMeetup.id, meetupId));
  return { ok: true as const };
}

/** Upcoming meet-ups the player is allowed to see: their tier, their parks. */
export async function upcomingMeetups(player: Player, zoneId?: string) {
  requireCommunity(player);
  const rows = await db
    .select({
      id: schema.parkMeetup.id,
      zoneId: schema.parkMeetup.zoneId,
      zoneName: schema.zone.name,
      title: schema.parkMeetup.title,
      startsAt: schema.parkMeetup.startsAt,
      capacity: schema.parkMeetup.capacity,
      attendeeCount: schema.parkMeetup.attendeeCount,
      hostId: schema.parkMeetup.hostId,
      hostName: schema.player.username,
    })
    .from(schema.parkMeetup)
    .innerJoin(schema.zone, eq(schema.zone.id, schema.parkMeetup.zoneId))
    .innerJoin(schema.player, eq(schema.player.id, schema.parkMeetup.hostId))
    .where(
      and(
        eq(schema.parkMeetup.status, "open"),
        eq(schema.parkMeetup.tier, player.ageTier!),
        gte(schema.parkMeetup.startsAt, new Date()),
        ...(zoneId ? [eq(schema.parkMeetup.zoneId, zoneId)] : []),
      ),
    )
    .orderBy(schema.parkMeetup.startsAt)
    .limit(50);

  const blocked = await blockedIds(player.id);
  const mine = await db
    .select({ meetupId: schema.meetupAttendee.meetupId })
    .from(schema.meetupAttendee)
    .where(eq(schema.meetupAttendee.playerId, player.id));
  const joined = new Set(mine.map((row) => row.meetupId));

  return rows
    .filter((row) => !blocked.has(row.hostId))
    .map((row) => ({
      ...row,
      joined: joined.has(row.id),
      isHost: row.hostId === player.id,
    }));
}

/* -------------------------------------------------------- park leaderboards */

/**
 * Wins per player at one park over the last 30 days, computed from finished
 * matches. Minors and adults are ranked separately — a shared board would put
 * children's usernames in front of adults for no gain.
 */
export async function parkLeaderboard(input: { zoneId: string; tier: schema.AgeTier; limit?: number }) {
  const since = new Date(Date.now() - PARK_BOARD_WINDOW_MS);
  const rows = await db
    .select({
      playerId: schema.match.winnerPlayerId,
      wins: sql<number>`count(*)`,
    })
    .from(schema.match)
    .where(
      and(
        eq(schema.match.zoneId, input.zoneId),
        eq(schema.match.status, "finished"),
        gte(schema.match.createdAt, since),
        sql`${schema.match.winnerPlayerId} is not null`,
      ),
    )
    .groupBy(schema.match.winnerPlayerId)
    .orderBy(desc(sql`count(*)`))
    .limit(Math.min(input.limit ?? 25, 50) * 2);

  const winnerIds = rows.map((row) => row.playerId).filter((id): id is string => Boolean(id));
  if (winnerIds.length === 0) return [];

  const people = await db
    .select({
      id: schema.player.id,
      username: schema.player.username,
      level: schema.player.level,
      ageTier: schema.player.ageTier,
      moderationState: schema.player.moderationState,
    })
    .from(schema.player)
    .where(inArray(schema.player.id, winnerIds));
  const byId = new Map(people.map((p) => [p.id, p]));

  return rows
    .flatMap((row) => {
      const person = row.playerId ? byId.get(row.playerId) : undefined;
      if (!person || person.ageTier !== input.tier) return [];
      if (person.moderationState !== "active") return [];
      return [
        {
          playerId: person.id,
          username: person.username,
          level: person.level,
          wins: Number(row.wins),
        },
      ];
    })
    .slice(0, Math.min(input.limit ?? 25, 50))
    .map((entry, index) => ({ ...entry, rank: index + 1 }));
}

/** Closes meet-ups whose start time has passed. Cron. */
export async function closePastMeetups() {
  const cutoff = new Date(Date.now() - 4 * 60 * 60 * 1000);
  const closed = await db
    .update(schema.parkMeetup)
    .set({ status: "done" })
    .where(
      and(eq(schema.parkMeetup.status, "open"), sql`${schema.parkMeetup.startsAt} < ${cutoff.getTime()}`),
    )
    .returning({ id: schema.parkMeetup.id });
  return { closed: closed.length };
}
