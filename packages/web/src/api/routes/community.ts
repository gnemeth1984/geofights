import { z } from "zod";
import { base } from "../__core/app";
import { playerProc } from "../middleware/auth";
import { AGE_BANDS } from "../database/schema";
import { CHAT_PRESETS } from "../lib/chat-presets";
import {
  communityAccess,
  completeSignupProfile,
  consentState,
  requestParentConsent,
  revokeParentConsent,
  verifyParentConsent,
} from "../services/consent";
import {
  friendList,
  myInvite,
  redeemInviteCode,
  removeFriend,
  respondToRequest,
} from "../services/friends";
import {
  TEAM_SIZE_LIMIT,
  chatHistory,
  chatOverview,
  createTeam,
  joinTeam,
  leaveTeam,
  myTeam,
  sendChat,
} from "../services/teams";
import {
  cancelMeetup,
  createMeetup,
  joinMeetup,
  leaveMeetup,
  parkLeaderboard,
  upcomingMeetups,
} from "../services/meetups";

/**
 * Community. Friends by invite code, teams by join code, chat, park meet-ups,
 * park leaderboards — plus the age/consent procedures that gate all of it.
 *
 * Two things to notice about this router:
 *
 *   1. **There is no search procedure.** Not by username, not by proximity,
 *      not by level. The only way to reach another account is a code its owner
 *      gave you. That absence is the feature.
 *   2. **`parentConsent.verify` is public.** The emailed token *is* the
 *      authentication — a parent must not need a GeoFights account to say no.
 *
 * Every write here re-checks access server-side via `requireCommunity`; the
 * client-side gating is a courtesy, not the enforcement.
 */

const channelInput = z.object({
  scope: z.enum(["friend", "team"]),
  channelId: z.string(),
});

export const community = {
  /** Age band, tier, what is unlocked, and why anything is not. */
  access: playerProc.handler(async ({ context }) => ({
    ...communityAccess(context.player),
    inviteCode: context.player.inviteCode,
    consent: await consentState(context.player),
    presets: CHAT_PRESETS,
    teamSizeLimit: TEAM_SIZE_LIMIT,
  })),

  /**
   * Finishes sign-up: age band + the coarse home area. The client cannot get
   * here without a live position, and the server stores 2 dp of it.
   */
  completeSignup: playerProc
    .input(
      z.object({
        ageBand: z.enum(AGE_BANDS),
        lat: z.number().min(-90).max(90),
        lng: z.number().min(-180).max(180),
        parentEmail: z.string().email().optional(),
        guardianConfirmed: z.boolean().default(false),
      }),
    )
    .handler(({ input, context }) =>
      completeSignupProfile({ playerId: context.player.id, ...input }),
    ),

  parentConsent: {
    state: playerProc.handler(({ context }) => consentState(context.player)),

    /** Re-send, or send to a corrected address. */
    resend: playerProc
      .input(z.object({ parentEmail: z.string().email() }))
      .handler(({ input, context }) =>
        requestParentConsent(context.player.id, input.parentEmail, context.player.username),
      ),

    /** Public: the link in the parent's inbox lands here. */
    verify: base
      .input(z.object({ token: z.string().min(8) }))
      .handler(({ input }) => verifyParentConsent(input.token)),

    /** Public, same token: withdrawing permission later. */
    revoke: base
      .input(z.object({ token: z.string().min(8) }))
      .handler(({ input }) => revokeParentConsent(input.token)),
  },

  friends: {
    list: playerProc.handler(({ context }) => friendList(context.player)),

    /** This player's own code and QR payload. */
    invite: playerProc.handler(({ context }) => myInvite(context.player)),

    /** The only way to reach another account. */
    redeem: playerProc
      .input(z.object({ code: z.string().min(6).max(16) }))
      .handler(({ input, context }) => redeemInviteCode(context.player, input.code)),

    respond: playerProc
      .input(z.object({ friendLinkId: z.string(), accept: z.boolean() }))
      .handler(({ input, context }) =>
        respondToRequest(context.player, input.friendLinkId, input.accept),
      ),

    remove: playerProc
      .input(z.object({ playerId: z.string() }))
      .handler(({ input, context }) => removeFriend(context.player, input.playerId)),
  },

  teams: {
    mine: playerProc.handler(({ context }) => myTeam(context.player)),

    create: playerProc
      .input(z.object({ name: z.string().min(3).max(24) }))
      .handler(({ input, context }) => createTeam(context.player, input.name)),

    join: playerProc
      .input(z.object({ code: z.string().min(4).max(12) }))
      .handler(({ input, context }) => joinTeam(context.player, input.code)),

    leave: playerProc.handler(({ context }) => leaveTeam(context.player)),
  },

  chat: {
    /** Friend conversations with their last line. */
    overview: playerProc.handler(({ context }) => chatOverview(context.player)),

    history: playerProc
      .input(channelInput.extend({ limit: z.number().int().min(1).max(50).optional() }))
      .handler(({ input, context }) => chatHistory(context.player, input)),

    /** Fixed phrases. Available to every player with community access. */
    preset: playerProc
      .input(channelInput.extend({ presetId: z.string() }))
      .handler(({ input, context }) =>
        sendChat(context.player, { ...input, kind: "preset", presetId: input.presetId }),
      ),

    /** Free text. 13+, not in the first 24 hours, filtered on the way in. */
    send: playerProc
      .input(channelInput.extend({ body: z.string().min(1).max(200) }))
      .handler(({ input, context }) =>
        sendChat(context.player, { ...input, kind: "text", body: input.body }),
      ),
  },

  meetups: {
    upcoming: playerProc
      .input(z.object({ zoneId: z.string().optional() }).optional())
      .handler(({ input, context }) => upcomingMeetups(context.player, input?.zoneId)),

    create: playerProc
      .input(
        z.object({
          zoneId: z.string(),
          title: z.string().min(3).max(48),
          /** ISO string from the client's own clock. */
          startsAt: z.string(),
          capacity: z.number().int().min(2).max(40).optional(),
        }),
      )
      .handler(({ input, context }) =>
        createMeetup(context.player, {
          zoneId: input.zoneId,
          title: input.title,
          startsAt: new Date(input.startsAt),
          capacity: input.capacity,
        }),
      ),

    join: playerProc
      .input(z.object({ meetupId: z.string() }))
      .handler(({ input, context }) => joinMeetup(context.player, input.meetupId)),

    leave: playerProc
      .input(z.object({ meetupId: z.string() }))
      .handler(({ input, context }) => leaveMeetup(context.player, input.meetupId)),

    cancel: playerProc
      .input(z.object({ meetupId: z.string() }))
      .handler(({ input, context }) => cancelMeetup(context.player, input.meetupId)),
  },

  /** Rolling 30-day wins at one park, ranked inside the player's own tier. */
  parkBoard: playerProc
    .input(z.object({ zoneId: z.string(), limit: z.number().int().min(1).max(50).optional() }))
    .handler(({ input, context }) =>
      parkLeaderboard({
        zoneId: input.zoneId,
        tier: context.player.ageTier ?? "minor",
        limit: input.limit,
      }),
    ),
};
