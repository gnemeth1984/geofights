import { and, count, desc, eq, gte, inArray, or, sql } from "drizzle-orm";
import { ORPCError } from "@orpc/server";
import { db } from "../database";
import * as schema from "../database/schema";
import { ids } from "../lib/ids";

/**
 * Reports, blocks, and what happens to an account people keep reporting.
 *
 * The rule that does the work: **three distinct reporters inside seven days
 * hides an account automatically.** Hidden means out of matchmaking, chat
 * suppressed, invites dead — the account still opens and still plays alone. It
 * is not a ban, it is reversible with one click in /admin, and it exists so a
 * bad actor stops reaching children within minutes instead of whenever a human
 * next looks at a queue.
 *
 * Distinct *reporters*, not reports, because otherwise one angry player who
 * lost a fight could hide anyone. Seven days, because a pattern spread thinner
 * than that is what the queue is for.
 *
 * Every state change lands in `moderationAction`, append-only, with who did it
 * and why. `safetyEvent` does the same job for physical safety; this is its
 * social twin.
 */

export const AUTO_HIDE_REPORTERS = 3;
export const AUTO_HIDE_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

export type Player = typeof schema.player.$inferSelect;

/* ------------------------------------------------------------------- blocks */

/** One-directional, and enforced in both directions on read. */
export async function blockPlayer(playerId: string, blockedId: string) {
  if (playerId === blockedId) {
    throw new ORPCError("BAD_REQUEST", { message: "You cannot block yourself." });
  }
  await db
    .insert(schema.playerBlock)
    .values({ id: ids.block(), playerId, blockedId })
    .onConflictDoNothing();

  // A block ends the relationship as well as the visibility.
  const [a, b] = [playerId, blockedId].sort();
  await db
    .update(schema.friendLink)
    .set({ status: "declined", respondedAt: new Date() })
    .where(and(eq(schema.friendLink.aPlayerId, a!), eq(schema.friendLink.bPlayerId, b!)));

  return { ok: true as const };
}

export async function unblockPlayer(playerId: string, blockedId: string) {
  await db
    .delete(schema.playerBlock)
    .where(
      and(eq(schema.playerBlock.playerId, playerId), eq(schema.playerBlock.blockedId, blockedId)),
    );
  return { ok: true as const };
}

/** Ids this player has blocked, plus ids that have blocked them. Symmetric on read. */
export async function blockedIds(playerId: string): Promise<Set<string>> {
  const rows = await db
    .select({ a: schema.playerBlock.playerId, b: schema.playerBlock.blockedId })
    .from(schema.playerBlock)
    .where(
      or(eq(schema.playerBlock.playerId, playerId), eq(schema.playerBlock.blockedId, playerId)),
    );
  const out = new Set<string>();
  for (const row of rows) out.add(row.a === playerId ? row.b : row.a);
  return out;
}

export async function isBlockedBetween(a: string, b: string) {
  const [row] = await db
    .select({ id: schema.playerBlock.id })
    .from(schema.playerBlock)
    .where(
      or(
        and(eq(schema.playerBlock.playerId, a), eq(schema.playerBlock.blockedId, b)),
        and(eq(schema.playerBlock.playerId, b), eq(schema.playerBlock.blockedId, a)),
      ),
    )
    .limit(1);
  return Boolean(row);
}

/** Throws when either side has blocked the other. Used by every social write. */
export async function requireNotBlocked(a: string, b: string) {
  if (await isBlockedBetween(a, b)) {
    throw new ORPCError("FORBIDDEN", { message: "That player is not available to you." });
  }
}

export async function blockList(playerId: string) {
  return db
    .select({
      id: schema.playerBlock.id,
      playerId: schema.player.id,
      username: schema.player.username,
      createdAt: schema.playerBlock.createdAt,
    })
    .from(schema.playerBlock)
    .innerJoin(schema.player, eq(schema.player.id, schema.playerBlock.blockedId))
    .where(eq(schema.playerBlock.playerId, playerId))
    .orderBy(desc(schema.playerBlock.createdAt));
}

/* ------------------------------------------------------------------ reports */

export async function reportPlayer(input: {
  reporterId: string;
  subjectId: string;
  reason: schema.ReportReason;
  context?: "chat" | "match" | "profile" | "team" | "meetup";
  refId?: string;
  note?: string;
}) {
  if (input.reporterId === input.subjectId) {
    throw new ORPCError("BAD_REQUEST", { message: "You cannot report yourself." });
  }
  const [subject] = await db
    .select({ id: schema.player.id })
    .from(schema.player)
    .where(eq(schema.player.id, input.subjectId));
  if (!subject) throw new ORPCError("NOT_FOUND", { message: "Player not found" });

  await db.insert(schema.playerReport).values({
    id: ids.report(),
    reporterId: input.reporterId,
    subjectId: input.subjectId,
    reason: input.reason,
    context: input.context ?? "profile",
    refId: input.refId ?? null,
    note: input.note?.slice(0, 500) ?? null,
  });

  // Reporting somebody also stops them reaching you, without a second tap.
  await blockPlayer(input.reporterId, input.subjectId).catch(() => {});

  // A reported message goes out of sight straight away — it costs nothing to
  // hide one line, and leaving it up while the queue is read is the wrong
  // default when the reader might be nine.
  if (input.context === "chat" && input.refId) {
    await hideMessage(input.refId, "system");
  }

  const hidden = await applyAutoHide(input.subjectId);
  return { ok: true as const, autoHidden: hidden };
}

/** Distinct reporters inside the window; hides the account once it hits three. */
export async function applyAutoHide(subjectId: string) {
  const since = new Date(Date.now() - AUTO_HIDE_WINDOW_MS);
  const [row] = await db
    .select({ reporters: sql<number>`count(distinct ${schema.playerReport.reporterId})` })
    .from(schema.playerReport)
    .where(
      and(eq(schema.playerReport.subjectId, subjectId), gte(schema.playerReport.createdAt, since)),
    );
  const reporters = Number(row?.reporters ?? 0);
  if (reporters < AUTO_HIDE_REPORTERS) return false;

  const [player] = await db
    .select({ state: schema.player.moderationState })
    .from(schema.player)
    .where(eq(schema.player.id, subjectId));
  if (!player || player.state !== "active") return false;

  await setModerationState({
    subjectId,
    state: "hidden",
    actorId: "system",
    action: "auto_hide",
    note: `${reporters} separate players reported this account within 7 days`,
  });
  return true;
}

export async function hideMessage(messageId: string, actorId: string) {
  const [message] = await db
    .select({ id: schema.chatMessage.id, authorId: schema.chatMessage.authorId })
    .from(schema.chatMessage)
    .where(eq(schema.chatMessage.id, messageId));
  if (!message) return;
  await db
    .update(schema.chatMessage)
    .set({ hiddenAt: new Date() })
    .where(eq(schema.chatMessage.id, messageId));
  await db.insert(schema.moderationAction).values({
    id: ids.moderationAction(),
    actorId,
    subjectId: message.authorId,
    action: "message_hidden",
    note: `message ${messageId}`,
  });
}

/* --------------------------------------------------------------- admin queue */

export async function setModerationState(input: {
  subjectId: string;
  state: schema.ModerationState;
  actorId: string;
  action: schema.ModerationActionKind;
  reportId?: string;
  note?: string;
}) {
  await db
    .update(schema.player)
    .set({ moderationState: input.state, updatedAt: new Date() })
    .where(eq(schema.player.id, input.subjectId));
  await db.insert(schema.moderationAction).values({
    id: ids.moderationAction(),
    actorId: input.actorId,
    subjectId: input.subjectId,
    action: input.action,
    reportId: input.reportId ?? null,
    note: input.note ?? null,
  });
  return { ok: true as const, state: input.state };
}

/** The queue: open reports, newest first, grouped by who they are about. */
export async function reportQueue(status: schema.ReportStatus = "open", limit = 100) {
  const rows = await db
    .select({
      id: schema.playerReport.id,
      reason: schema.playerReport.reason,
      context: schema.playerReport.context,
      refId: schema.playerReport.refId,
      note: schema.playerReport.note,
      status: schema.playerReport.status,
      createdAt: schema.playerReport.createdAt,
      subjectId: schema.playerReport.subjectId,
      reporterId: schema.playerReport.reporterId,
    })
    .from(schema.playerReport)
    .where(eq(schema.playerReport.status, status))
    .orderBy(desc(schema.playerReport.createdAt))
    .limit(limit);

  const playerIds = [...new Set(rows.flatMap((r) => [r.subjectId, r.reporterId]))];
  const players = playerIds.length
    ? await db
        .select({
          id: schema.player.id,
          username: schema.player.username,
          ageBand: schema.player.ageBand,
          ageTier: schema.player.ageTier,
          moderationState: schema.player.moderationState,
          createdAt: schema.player.createdAt,
        })
        .from(schema.player)
        .where(inArray(schema.player.id, playerIds))
    : [];
  const byId = new Map(players.map((p) => [p.id, p]));

  // Chat reports are useless without the line that was reported.
  const chatRefs = rows.filter((r) => r.context === "chat" && r.refId).map((r) => r.refId!);
  const messages = chatRefs.length
    ? await db
        .select({
          id: schema.chatMessage.id,
          body: schema.chatMessage.body,
          kind: schema.chatMessage.kind,
          redacted: schema.chatMessage.redacted,
          createdAt: schema.chatMessage.createdAt,
        })
        .from(schema.chatMessage)
        .where(inArray(schema.chatMessage.id, chatRefs))
    : [];
  const byMessage = new Map(messages.map((m) => [m.id, m]));

  return rows.map((row) => ({
    ...row,
    subject: byId.get(row.subjectId) ?? null,
    reporter: byId.get(row.reporterId) ?? null,
    message: row.refId ? (byMessage.get(row.refId) ?? null) : null,
  }));
}

export async function resolveReport(input: {
  reportId: string;
  actorId: string;
  decision: "dismiss" | "hide" | "suspend" | "clear";
  note?: string;
}) {
  const [report] = await db
    .select()
    .from(schema.playerReport)
    .where(eq(schema.playerReport.id, input.reportId));
  if (!report) throw new ORPCError("NOT_FOUND", { message: "Report not found" });

  const at = new Date();
  await db
    .update(schema.playerReport)
    .set({
      status: input.decision === "dismiss" ? "dismissed" : "actioned",
      resolution: input.decision,
      resolvedBy: input.actorId,
      resolvedAt: at,
      note: input.note ? `${report.note ?? ""}\n— ${input.note}`.trim() : report.note,
    })
    .where(eq(schema.playerReport.id, input.reportId));

  if (input.decision === "dismiss") {
    await db.insert(schema.moderationAction).values({
      id: ids.moderationAction(),
      actorId: input.actorId,
      subjectId: report.subjectId,
      action: "dismiss",
      reportId: report.id,
      note: input.note ?? null,
    });
    return { ok: true as const, state: null };
  }

  const state: schema.ModerationState =
    input.decision === "hide" ? "hidden" : input.decision === "suspend" ? "suspended" : "active";
  const action: schema.ModerationActionKind =
    input.decision === "clear" ? "unhide" : input.decision === "hide" ? "hide" : "suspend";

  return setModerationState({
    subjectId: report.subjectId,
    state,
    actorId: input.actorId,
    action,
    reportId: report.id,
    note: input.note,
  });
}

/** Everything a moderator needs about one account, in one read. */
export async function moderationHistory(subjectId: string) {
  const [actions, reports, openCount] = await Promise.all([
    db
      .select()
      .from(schema.moderationAction)
      .where(eq(schema.moderationAction.subjectId, subjectId))
      .orderBy(desc(schema.moderationAction.createdAt))
      .limit(50),
    db
      .select()
      .from(schema.playerReport)
      .where(eq(schema.playerReport.subjectId, subjectId))
      .orderBy(desc(schema.playerReport.createdAt))
      .limit(50),
    db
      .select({ value: count() })
      .from(schema.playerReport)
      .where(
        and(eq(schema.playerReport.subjectId, subjectId), eq(schema.playerReport.status, "open")),
      ),
  ]);
  return { actions, reports, openReports: Number(openCount[0]?.value ?? 0) };
}

export async function moderationStats() {
  const [open, hidden, suspended] = await Promise.all([
    db.select({ value: count() }).from(schema.playerReport).where(eq(schema.playerReport.status, "open")),
    db.select({ value: count() }).from(schema.player).where(eq(schema.player.moderationState, "hidden")),
    db
      .select({ value: count() })
      .from(schema.player)
      .where(eq(schema.player.moderationState, "suspended")),
  ]);
  return {
    openReports: Number(open[0]?.value ?? 0),
    hidden: Number(hidden[0]?.value ?? 0),
    suspended: Number(suspended[0]?.value ?? 0),
    autoHideReporters: AUTO_HIDE_REPORTERS,
    autoHideWindowDays: AUTO_HIDE_WINDOW_MS / (24 * 60 * 60 * 1000),
  };
}
