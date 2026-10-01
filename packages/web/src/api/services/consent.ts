import { and, desc, eq } from "drizzle-orm";
import { ORPCError } from "@orpc/server";
import { db } from "../database";
import * as schema from "../database/schema";
import { ids, newShareCode } from "../lib/ids";
import { sendEmail, siteUrl } from "./email";

/**
 * Age, consent, and what a given account is allowed to reach.
 *
 * Three separate ideas live here and are easy to confuse, so they are named
 * apart:
 *
 *   - **Age band** — self-declared at sign-up. Screening, not proof. It sets
 *     the ceiling on what the account can do, and the UI says plainly that it
 *     is not verified.
 *   - **Tier** — minor (under 18) or adult. The hard partition: no match, no
 *     team, no meet-up and no message ever crosses it. This is why `16to17`
 *     is its own band; a 17-year-old consents for themselves but is still a
 *     minor for every social purpose.
 *   - **Consent** — for under-13s, a parent clicking a link in their own
 *     inbox. Until that happens the child can play the game but reaches
 *     nothing social and nothing that exposes their area to another person.
 *
 * Location is required to create an account at all (that is the product: the
 * game is the park you are standing in), but only a ~1.1 km coarse home area
 * is stored. The precise fix stays in the browser session, as it always has.
 */

export const CONSENT_TTL_MS = 30 * 24 * 60 * 60 * 1000;
/** A brand-new account is throttled for its first day. */
export const NEW_ACCOUNT_MS = 24 * 60 * 60 * 1000;
export const NEW_ACCOUNT_INVITE_LIMIT = 3;

export type Player = typeof schema.player.$inferSelect;

export function ageTierFor(band: schema.AgeBand): schema.AgeTier {
  return band === "18plus" ? "adult" : "minor";
}

/** Coarse to 2 dp — about 1.1 km. Enough to find a park, useless for a doorstep. */
export function coarseCoord(value: number) {
  return Math.round(value * 100) / 100;
}

/* ------------------------------------------------------------ sign-up state */

/**
 * Records the age band and coarse home area, and mints the player's invite
 * code. Called once, right after the account is created — the client refuses
 * to submit sign-up without a live position, and this refuses to complete a
 * profile without one either.
 */
export async function completeSignupProfile(input: {
  playerId: string;
  ageBand: schema.AgeBand;
  lat: number;
  lng: number;
  parentEmail?: string;
  guardianConfirmed: boolean;
}) {
  const band = input.ageBand;
  const tier = ageTierFor(band);

  // 13–15 keeps the guardian-present checkbox; under-13 needs the email loop.
  if ((band === "under13" || band === "13to15") && !input.guardianConfirmed) {
    throw new ORPCError("BAD_REQUEST", {
      message: "A parent or guardian has to confirm they are with the player.",
    });
  }
  if (band === "under13" && !isEmail(input.parentEmail ?? "")) {
    throw new ORPCError("BAD_REQUEST", {
      message: "A parent's email address is needed for players under 13.",
    });
  }

  const [current] = await db.select().from(schema.player).where(eq(schema.player.id, input.playerId));
  if (!current) throw new ORPCError("NOT_FOUND", { message: "Player not found" });
  // The band is set once. Letting it change would let an adult account walk
  // into the under-18 side (or the reverse) after the fact.
  if (current.ageBand && current.ageBand !== band) {
    throw new ORPCError("FORBIDDEN", {
      message: "This account's age group is already set. Contact support to change it.",
    });
  }
  const sameParent =
    band === "under13" &&
    Boolean(current.parentConsentAt) &&
    current.parentEmail === input.parentEmail?.trim().toLowerCase();

  const [player] = await db
    .update(schema.player)
    .set({
      ageBand: band,
      ageTier: tier,
      parentEmail: band === "under13" ? input.parentEmail!.trim().toLowerCase() : null,
      // A different parent email voids the old confirmation.
      ...(band === "under13" && !sameParent ? { parentConsentAt: null } : {}),
      homeLat: coarseCoord(input.lat),
      homeLng: coarseCoord(input.lng),
      homeSetAt: new Date(),
      inviteCode: current.inviteCode ?? (await freshInviteCode()),
      updatedAt: new Date(),
    })
    .where(eq(schema.player.id, input.playerId))
    .returning();

  if (!player) throw new ORPCError("NOT_FOUND", { message: "Player not found" });

  let consent: Awaited<ReturnType<typeof requestParentConsent>> | null = null;
  if (band === "under13" && !sameParent) {
    consent = await requestParentConsent(player.id, player.parentEmail!, player.username);
  }
  return { player, access: communityAccess(player), consent };
}

async function freshInviteCode() {
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const code = newShareCode(8);
    const [clash] = await db
      .select({ id: schema.player.id })
      .from(schema.player)
      .where(eq(schema.player.inviteCode, code));
    if (!clash) return code;
  }
  // 31^8 space; falling through means something is very wrong, so be loud.
  throw new ORPCError("INTERNAL_SERVER_ERROR", { message: "Could not mint an invite code" });
}

/** Mints one for an account created before invite codes existed. */
export async function ensureInviteCode(player: Player) {
  if (player.inviteCode) return player.inviteCode;
  const code = await freshInviteCode();
  await db
    .update(schema.player)
    .set({ inviteCode: code, updatedAt: new Date() })
    .where(eq(schema.player.id, player.id));
  return code;
}

function isEmail(value: string) {
  return /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(value.trim());
}

/* ---------------------------------------------------------- parent consent */

export async function requestParentConsent(
  playerId: string,
  parentEmail: string,
  username: string,
) {
  const token = `${newShareCode(6)}${newShareCode(6)}${newShareCode(6)}`.toLowerCase();
  const expiresAt = new Date(Date.now() + CONSENT_TTL_MS);

  // Supersede any earlier pending request, so an old link cannot be reused.
  await db
    .update(schema.parentConsent)
    .set({ status: "expired" })
    .where(
      and(eq(schema.parentConsent.playerId, playerId), eq(schema.parentConsent.status, "pending")),
    );

  const link = `${siteUrl()}/parent-consent?token=${token}`;
  const delivery = await sendEmail({
    to: parentEmail,
    subject: `Permission needed: ${username} wants to play GeoFights`,
    text: parentConsentText(username, link),
    html: parentConsentHtml(username, link),
  });

  const [row] = await db
    .insert(schema.parentConsent)
    .values({
      id: ids.parentConsent(),
      playerId,
      parentEmail,
      token,
      status: "pending",
      deliveredVia: delivery.via,
      deliveryError: delivery.ok ? null : delivery.error,
      expiresAt,
    })
    .returning();

  return {
    status: row!.status,
    parentEmail,
    deliveredVia: delivery.via,
    /**
     * Returned only when no provider accepted it, so an operator can pass the
     * link on. Never returned once mail actually goes out.
     */
    manualLink: delivery.ok ? null : link,
  };
}

export async function consentState(player: Player) {
  if (player.ageBand !== "under13") {
    return { required: false as const, status: "not_required" as const, parentEmail: null };
  }
  const [row] = await db
    .select()
    .from(schema.parentConsent)
    .where(eq(schema.parentConsent.playerId, player.id))
    .orderBy(desc(schema.parentConsent.requestedAt))
    .limit(1);
  return {
    required: true as const,
    status: player.parentConsentAt ? ("verified" as const) : (row?.status ?? "missing"),
    parentEmail: player.parentEmail,
    deliveredVia: row?.deliveredVia ?? null,
    requestedAt: row?.requestedAt ?? null,
  };
}

/** The link's landing route calls this. Public by design — the token is the auth. */
export async function verifyParentConsent(token: string) {
  const [row] = await db
    .select()
    .from(schema.parentConsent)
    .where(eq(schema.parentConsent.token, token.trim().toLowerCase()));

  if (!row) throw new ORPCError("NOT_FOUND", { message: "That link is not valid." });
  if (row.status === "verified") return { alreadyDone: true, playerId: row.playerId };
  if (row.status !== "pending") {
    throw new ORPCError("BAD_REQUEST", { message: "That link is no longer active." });
  }
  if (row.expiresAt.getTime() < Date.now()) {
    await db
      .update(schema.parentConsent)
      .set({ status: "expired" })
      .where(eq(schema.parentConsent.id, row.id));
    throw new ORPCError("BAD_REQUEST", { message: "That link has expired." });
  }

  const at = new Date();
  await db
    .update(schema.parentConsent)
    .set({ status: "verified", verifiedAt: at })
    .where(eq(schema.parentConsent.id, row.id));
  await db
    .update(schema.player)
    .set({ parentConsentAt: at, updatedAt: at })
    .where(eq(schema.player.id, row.playerId));

  const [player] = await db
    .select({ username: schema.player.username })
    .from(schema.player)
    .where(eq(schema.player.id, row.playerId));

  return { alreadyDone: false, playerId: row.playerId, username: player?.username ?? "your child" };
}

/** A parent withdrawing consent. Community locks again immediately. */
export async function revokeParentConsent(token: string) {
  const [row] = await db
    .select()
    .from(schema.parentConsent)
    .where(eq(schema.parentConsent.token, token.trim().toLowerCase()));
  if (!row) throw new ORPCError("NOT_FOUND", { message: "That link is not valid." });

  const at = new Date();
  await db
    .update(schema.parentConsent)
    .set({ status: "revoked", revokedAt: at })
    .where(eq(schema.parentConsent.id, row.id));
  await db
    .update(schema.player)
    .set({ parentConsentAt: null, updatedAt: at })
    .where(eq(schema.player.id, row.playerId));
  return { ok: true as const };
}

/* ------------------------------------------------------------------- access */

export type CommunityAccess = {
  tier: schema.AgeTier | null;
  ageBand: schema.AgeBand | null;
  /** Sign-up profile finished: age band + home area on file. */
  profileComplete: boolean;
  /** Any community surface at all. */
  community: boolean;
  /** Free-typed chat. Presets are available to everyone with `community`. */
  freeText: boolean;
  /** Create a team, host a meet-up. */
  host: boolean;
  /** Invites this account may still send today. */
  inviteLimit: number | null;
  newAccount: boolean;
  moderationState: schema.ModerationState;
  /** Why something is off, in words the player can read. */
  blockedBy: string | null;
};

export function communityAccess(player: Player): CommunityAccess {
  const profileComplete = Boolean(player.ageBand && player.homeSetAt);
  const newAccount = Date.now() - player.createdAt.getTime() < NEW_ACCOUNT_MS;
  const consentOk = player.ageBand !== "under13" || Boolean(player.parentConsentAt);
  const clean = player.moderationState === "active";

  const community = profileComplete && consentOk && clean;
  const thirteenPlus = player.ageBand !== null && player.ageBand !== "under13";

  return {
    tier: player.ageTier,
    ageBand: player.ageBand,
    profileComplete,
    community,
    freeText: community && thirteenPlus && !newAccount,
    host: community && !newAccount && (player.ageBand === "16to17" || player.ageBand === "18plus"),
    inviteLimit: newAccount ? NEW_ACCOUNT_INVITE_LIMIT : null,
    newAccount,
    moderationState: player.moderationState,
    blockedBy: !profileComplete
      ? "Finish sign-up — GeoFights needs your age band and your area."
      : !clean
        ? player.moderationState === "suspended"
          ? "This account is suspended."
          : "This account is hidden while a report is reviewed."
        : !consentOk
          ? "Waiting for a parent to confirm by email."
          : null,
  };
}

/** Throws unless the account may use community features at all. */
export function requireCommunity(player: Player): CommunityAccess {
  const access = communityAccess(player);
  if (!access.community) {
    throw new ORPCError("FORBIDDEN", { message: access.blockedBy ?? "Community is not available." });
  }
  return access;
}

/**
 * The partition. Two players may only ever share a social container — friend
 * link, team, chat channel, meet-up, match — if they are the same tier.
 */
export function requireSameTier(a: Player, b: Player) {
  if (!a.ageTier || !b.ageTier) {
    throw new ORPCError("FORBIDDEN", { message: "Both players have to finish sign-up first." });
  }
  if (a.ageTier !== b.ageTier) {
    throw new ORPCError("FORBIDDEN", {
      message: "Adults and under-18s are kept apart in GeoFights. This is not allowed.",
    });
  }
}

/* -------------------------------------------------------------------- email */

function parentConsentText(username: string, link: string) {
  return [
    `${username} has created a GeoFights account and told us they are under 13.`,
    "",
    "GeoFights is an outdoor augmented-reality fighting game. Children walk to approved",
    "local parks and playgrounds, collect boosters and battle the characters they build.",
    "",
    "Until you confirm, your child can play the game on their own, but has no access to",
    "anything social: no friends, no chat, no teams, no meet-ups.",
    "",
    "If you are happy for them to use those features, open this link:",
    link,
    "",
    "What you are agreeing to:",
    "- Their coarse area (about a kilometre across, never an exact address) is used to",
    "  find approved parks near them.",
    "- They can add friends only by exchanging an 8-character code in person — there is",
    "  no way to search for or be found by a stranger.",
    "- Under 13 they can only send fixed phrases from a list. They cannot type free text",
    "  and cannot receive it.",
    "- Adults and under-18s are never matched, teamed or able to message each other.",
    "- Every message is filtered for contact details, and every player can be reported",
    "  and blocked.",
    "",
    "You can withdraw this at any time from the same link. If you were not expecting",
    "this email, ignore it — nothing is unlocked without the link being opened.",
  ].join("\n");
}

function parentConsentHtml(username: string, link: string) {
  return `<div style="font-family:system-ui,sans-serif;line-height:1.55;max-width:34rem">
  <h2 style="margin:0 0 .5rem">Permission needed for ${escapeHtml(username)}</h2>
  <p><strong>${escapeHtml(username)}</strong> has created a GeoFights account and told us they are under 13.
  GeoFights is an outdoor augmented-reality fighting game played in approved local parks.</p>
  <p>Until you confirm, they can play on their own but reach nothing social — no friends, no chat,
  no teams, no meet-ups.</p>
  <p><a href="${link}" style="display:inline-block;padding:.6rem 1rem;background:#111;color:#fff;border-radius:.4rem;text-decoration:none">Give permission</a></p>
  <ul>
    <li>Only a coarse area (about a kilometre across) is stored — never an exact address.</li>
    <li>Friends are added by exchanging a code in person. Nobody can search for your child.</li>
    <li>Under 13, only fixed phrases can be sent or received — no free typing.</li>
    <li>Adults and under-18s are never matched, teamed or able to message each other.</li>
    <li>Every player can be reported and blocked, and messages are filtered for contact details.</li>
  </ul>
  <p style="color:#666;font-size:.9em">You can withdraw permission at any time from the same link.
  If you were not expecting this email, ignore it — nothing unlocks unless the link is opened.</p>
</div>`;
}

function escapeHtml(value: string) {
  return value.replace(
    /[&<>"']/g,
    (ch) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch] ?? ch,
  );
}

/**
 * Pending parent-consent requests for the admin panel. While no mail provider
 * is configured this is how the link reaches a parent: an operator passes it
 * on by hand. The token is the parent's credential, so this is admin-only.
 */
export async function pendingConsents(limit = 100) {
  const rows = await db
    .select({
      id: schema.parentConsent.id,
      playerId: schema.parentConsent.playerId,
      parentEmail: schema.parentConsent.parentEmail,
      token: schema.parentConsent.token,
      deliveredVia: schema.parentConsent.deliveredVia,
      deliveryError: schema.parentConsent.deliveryError,
      requestedAt: schema.parentConsent.requestedAt,
      expiresAt: schema.parentConsent.expiresAt,
      username: schema.player.username,
    })
    .from(schema.parentConsent)
    .innerJoin(schema.player, eq(schema.player.id, schema.parentConsent.playerId))
    .where(eq(schema.parentConsent.status, "pending"))
    .orderBy(desc(schema.parentConsent.requestedAt))
    .limit(limit);
  return rows.map(({ token, ...row }) => ({
    ...row,
    link: `${siteUrl()}/parent-consent?token=${token}`,
  }));
}
