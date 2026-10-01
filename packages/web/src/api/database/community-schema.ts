import { sqliteTable, text, integer, index, uniqueIndex } from "drizzle-orm/sqlite-core";

/**
 * Community + safety tables.
 *
 * Re-exported from `schema.ts`, so drizzle-kit picks them up from the one
 * schema entry point. Split into their own file because the rules they encode
 * are a subsystem of their own, not more gameplay:
 *
 *   - Nobody is discoverable. There is no player search anywhere in the API.
 *     A friendship starts from an 8-char invite code its owner hands over in
 *     person or by QR (`player.inviteCode`), and a team starts from a join
 *     code. Both sides are recorded here, so "who can talk to whom" is always
 *     a row that exists rather than a permission that is inferred.
 *   - Minors and adults never share a row. Every social container carries the
 *     `tier` it belongs to and only accepts members of that tier — see
 *     `services/community.ts`, which is the only writer.
 *   - Under-13s reach none of this until `parentConsent` is verified.
 *   - Every message, name and title is filtered on write (`lib/text-filter.ts`)
 *     and every player everywhere can be reported and blocked. Three distinct
 *     reporters inside 7 days hides an account automatically, pending a human
 *     look at the queue in /admin — reversible, and not a ban.
 */

const now = () => new Date();
const timestamp = (col: string) => integer(col, { mode: "timestamp_ms" });

/* ---------------------------------------------------------- parent consent */

export const CONSENT_STATUSES = ["pending", "verified", "revoked", "expired"] as const;
export type ConsentStatus = (typeof CONSENT_STATUSES)[number];

/**
 * COPPA-style verifiable parental consent for an under-13 account. The child
 * can play — walk, collect, fight — but reaches nothing social and nothing
 * that shares their area with another person until the parent clicks the link.
 */
export const parentConsent = sqliteTable(
  "parent_consent",
  {
    id: text("id").primaryKey(),
    playerId: text("player_id").notNull(),
    parentEmail: text("parent_email").notNull(),
    /** Single-use secret in the emailed link. */
    token: text("token").notNull(),
    status: text("status", { enum: CONSENT_STATUSES }).notNull().default("pending"),
    /** "email" once an provider actually accepted it, "manual" otherwise. */
    deliveredVia: text("delivered_via"),
    deliveryError: text("delivery_error"),
    requestedAt: timestamp("requested_at").notNull().$defaultFn(now),
    verifiedAt: timestamp("verified_at"),
    revokedAt: timestamp("revoked_at"),
    expiresAt: timestamp("expires_at").notNull(),
  },
  (t) => [
    uniqueIndex("parent_consent_token_idx").on(t.token),
    index("parent_consent_player_idx").on(t.playerId, t.status),
  ],
);

/* ----------------------------------------------------------------- friends */

export const FRIEND_STATUSES = ["pending", "accepted", "declined"] as const;
export type FriendStatus = (typeof FRIEND_STATUSES)[number];

/**
 * One row per pair, with the ids sorted so `(a,b)` and `(b,a)` cannot both
 * exist. `requestedBy` remembers which end redeemed the invite code.
 */
export const friendLink = sqliteTable(
  "friend_link",
  {
    id: text("id").primaryKey(),
    /** Lexicographically smaller player id. */
    aPlayerId: text("a_player_id").notNull(),
    bPlayerId: text("b_player_id").notNull(),
    requestedBy: text("requested_by").notNull(),
    status: text("status", { enum: FRIEND_STATUSES }).notNull().default("pending"),
    createdAt: timestamp("created_at").notNull().$defaultFn(now),
    respondedAt: timestamp("responded_at"),
  },
  (t) => [
    uniqueIndex("friend_link_pair_idx").on(t.aPlayerId, t.bPlayerId),
    index("friend_link_a_idx").on(t.aPlayerId, t.status),
    index("friend_link_b_idx").on(t.bPlayerId, t.status),
  ],
);

/* ------------------------------------------------------------------- teams */

export const team = sqliteTable(
  "team",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    /** 6-char code. Handed over in person, same as an invite code. */
    joinCode: text("join_code").notNull(),
    ownerId: text("owner_id").notNull(),
    /** The tier of every member. Set from the owner and never changes. */
    tier: text("tier", { enum: ["minor", "adult"] }).notNull(),
    memberCount: integer("member_count").notNull().default(1),
    createdAt: timestamp("created_at").notNull().$defaultFn(now),
    disbandedAt: timestamp("disbanded_at"),
  },
  (t) => [
    uniqueIndex("team_join_code_idx").on(t.joinCode),
    uniqueIndex("team_name_idx").on(t.name),
  ],
);

export const teamMember = sqliteTable(
  "team_member",
  {
    id: text("id").primaryKey(),
    teamId: text("team_id").notNull(),
    playerId: text("player_id").notNull(),
    role: text("role", { enum: ["owner", "member"] }).notNull().default("member"),
    joinedAt: timestamp("joined_at").notNull().$defaultFn(now),
  },
  (t) => [
    uniqueIndex("team_member_unique_idx").on(t.teamId, t.playerId),
    uniqueIndex("team_member_player_idx").on(t.playerId),
  ],
);

/* -------------------------------------------------------------------- chat */

/**
 * `preset` is a fixed phrase id from `lib/chat-presets.ts` — the only kind of
 * message an under-13 can send or receive. `text` is free-typed, 13+ only, and
 * always passes through the filter before it lands here.
 */
export const chatMessage = sqliteTable(
  "chat_message",
  {
    id: text("id").primaryKey(),
    scope: text("scope", { enum: ["friend", "team"] }).notNull(),
    /** friendLink.id or team.id. */
    channelId: text("channel_id").notNull(),
    authorId: text("author_id").notNull(),
    kind: text("kind", { enum: ["preset", "text"] }).notNull(),
    body: text("body").notNull(),
    /** Set when the filter rewrote the message, for the moderation queue. */
    redacted: integer("redacted", { mode: "boolean" }).notNull().default(false),
    hiddenAt: timestamp("hidden_at"),
    createdAt: timestamp("created_at").notNull().$defaultFn(now),
  },
  (t) => [index("chat_channel_idx").on(t.channelId, t.createdAt)],
);

/* ----------------------------------------------------------------- meetups */

export const MEETUP_STATUSES = ["open", "cancelled", "done"] as const;
export type MeetupStatus = (typeof MEETUP_STATUSES)[number];

/**
 * A meet-up at a park. Approved zones only, hosted by 16+, and attendees are
 * the host's own tier — an adult cannot host or join a minors' meet-up and the
 * reverse is refused too.
 */
export const parkMeetup = sqliteTable(
  "park_meetup",
  {
    id: text("id").primaryKey(),
    zoneId: text("zone_id").notNull(),
    hostId: text("host_id").notNull(),
    title: text("title").notNull(),
    tier: text("tier", { enum: ["minor", "adult"] }).notNull(),
    startsAt: timestamp("starts_at").notNull(),
    capacity: integer("capacity").notNull().default(12),
    attendeeCount: integer("attendee_count").notNull().default(1),
    status: text("status", { enum: MEETUP_STATUSES }).notNull().default("open"),
    createdAt: timestamp("created_at").notNull().$defaultFn(now),
  },
  (t) => [index("park_meetup_zone_idx").on(t.zoneId, t.startsAt)],
);

export const meetupAttendee = sqliteTable(
  "meetup_attendee",
  {
    id: text("id").primaryKey(),
    meetupId: text("meetup_id").notNull(),
    playerId: text("player_id").notNull(),
    joinedAt: timestamp("joined_at").notNull().$defaultFn(now),
  },
  (t) => [uniqueIndex("meetup_attendee_unique_idx").on(t.meetupId, t.playerId)],
);

/* -------------------------------------------------------- reports + blocks */

export const REPORT_REASONS = [
  "bullying",
  "sexual",
  "personal_info",
  "meeting_request",
  "adult_contact",
  "cheating",
  "other",
] as const;
export type ReportReason = (typeof REPORT_REASONS)[number];

export const REPORT_STATUSES = ["open", "actioned", "dismissed"] as const;
export type ReportStatus = (typeof REPORT_STATUSES)[number];

export const playerReport = sqliteTable(
  "player_report",
  {
    id: text("id").primaryKey(),
    reporterId: text("reporter_id").notNull(),
    subjectId: text("subject_id").notNull(),
    reason: text("reason", { enum: REPORT_REASONS }).notNull(),
    /** Where it happened: chat | match | profile | team | meetup. */
    context: text("context", { enum: ["chat", "match", "profile", "team", "meetup"] })
      .notNull()
      .default("profile"),
    /** Id of the message/match/team/meetup, when there is one. */
    refId: text("ref_id"),
    note: text("note"),
    status: text("status", { enum: REPORT_STATUSES }).notNull().default("open"),
    resolution: text("resolution"),
    resolvedBy: text("resolved_by"),
    resolvedAt: timestamp("resolved_at"),
    createdAt: timestamp("created_at").notNull().$defaultFn(now),
  },
  (t) => [
    index("player_report_subject_idx").on(t.subjectId, t.createdAt),
    index("player_report_status_idx").on(t.status, t.createdAt),
  ],
);

/** A block is one-directional and absolute: no match, no chat, no invite. */
export const playerBlock = sqliteTable(
  "player_block",
  {
    id: text("id").primaryKey(),
    playerId: text("player_id").notNull(),
    blockedId: text("blocked_id").notNull(),
    createdAt: timestamp("created_at").notNull().$defaultFn(now),
  },
  (t) => [
    uniqueIndex("player_block_unique_idx").on(t.playerId, t.blockedId),
    index("player_block_blocked_idx").on(t.blockedId),
  ],
);

export const MODERATION_ACTIONS = [
  "auto_hide",
  "hide",
  "unhide",
  "suspend",
  "clear",
  "dismiss",
  "message_hidden",
] as const;
export type ModerationActionKind = (typeof MODERATION_ACTIONS)[number];

/** Append-only audit trail. Mirrors `safetyEvent` for the social side. */
export const moderationAction = sqliteTable(
  "moderation_action",
  {
    id: text("id").primaryKey(),
    /** Admin player id, or "system" for the automatic hide. */
    actorId: text("actor_id").notNull(),
    subjectId: text("subject_id").notNull(),
    action: text("action", { enum: MODERATION_ACTIONS }).notNull(),
    reportId: text("report_id"),
    note: text("note"),
    createdAt: timestamp("created_at").notNull().$defaultFn(now),
  },
  (t) => [index("moderation_action_subject_idx").on(t.subjectId, t.createdAt)],
);
