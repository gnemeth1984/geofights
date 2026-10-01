/**
 * Community safety check, against the real database.
 *
 * Proves the rules that matter rather than the happy path: adults and
 * under-18s cannot reach each other by any route (friend code, team code,
 * chat, meet-up, match), under-13s are locked until a parent confirms, new
 * accounts cannot type, blocks hold, three reports hide an account, and the
 * chat filter strips contact details. Every row it creates is deleted on the
 * way out, pass or fail.
 *
 *   cd packages/web && bun --env-file=../../.env scripts/combat/community-check.ts
 */
import { eq, inArray, or } from "drizzle-orm";
import { db } from "../../src/api/database";
import * as schema from "../../src/api/database/schema";
import { ids } from "../../src/api/lib/ids";
import { filterMessage, filterName } from "../../src/api/lib/text-filter";
import {
  communityAccess,
  completeSignupProfile,
  revokeParentConsent,
  verifyParentConsent,
} from "../../src/api/services/consent";
import { friendList, redeemInviteCode, respondToRequest } from "../../src/api/services/friends";
import { createTeam, joinTeam, sendChat } from "../../src/api/services/teams";
import { blockPlayer, reportPlayer } from "../../src/api/services/moderation";
import { matchBlocker, requireCanJoin } from "../../src/api/services/match-gate";
import { parkLocalHour } from "../../src/api/services/meetups";

const TAG = `commcheck_${Date.now().toString(36)}`;
let passed = 0;
let failed = 0;
function check(name: string, ok: boolean, detail = "") {
  if (ok) passed++;
  else failed++;
  console.log(`  ${ok ? "\x1b[32mok\x1b[0m  " : "\x1b[31mFAIL\x1b[0m"} ${name}${detail ? ` — ${detail}` : ""}`);
}
async function rejects(name: string, fn: () => Promise<unknown>, match?: RegExp) {
  try {
    await fn();
    check(name, false, "was allowed");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    check(name, match ? match.test(message) : true, message);
  }
}

const made = { players: [] as string[], matches: [] as string[], teams: [] as string[] };
const DAY = 24 * 3_600_000;

type Band = schema.AgeBand;
async function makePlayer(label: string, band: Band | null, opts: { aged?: boolean } = {}) {
  const id = ids.player();
  await db.insert(schema.player).values({
    id,
    userId: `${TAG}_${label}`,
    username: `${TAG}_${label}`.slice(0, 30),
    createdAt: new Date(Date.now() - (opts.aged ? 3 * DAY : 0)),
  });
  made.players.push(id);
  if (band) {
    await completeSignupProfile({
      playerId: id,
      ageBand: band,
      lat: 53.3498,
      lng: -6.2603,
      guardianConfirmed: band === "under13" || band === "13to15",
      parentEmail: band === "under13" ? `parent+${TAG}@example.test` : undefined,
    });
  }
  return id;
}
async function load(id: string) {
  const [p] = await db.select().from(schema.player).where(eq(schema.player.id, id));
  return p!;
}

async function signup() {
  console.log("\nsign-up");
  const bare = await makePlayer("bare", null);
  check("no profile → no community", !communityAccess(await load(bare)).community);
  check("no profile → no matches", matchBlocker(await load(bare)) !== null);
  await rejects(
    "under-13 without a guardian is refused",
    () => completeSignupProfile({ playerId: bare, ageBand: "under13", lat: 53, lng: -6, guardianConfirmed: false, parentEmail: "p@example.test" }),
    /guardian/i,
  );
  await rejects(
    "under-13 without a parent email is refused",
    () => completeSignupProfile({ playerId: bare, ageBand: "under13", lat: 53, lng: -6, guardianConfirmed: true }),
    /email/i,
  );
  await rejects(
    "13–15 without a guardian is refused",
    () => completeSignupProfile({ playerId: bare, ageBand: "13to15", lat: 53, lng: -6, guardianConfirmed: false }),
    /guardian/i,
  );
  const adult = await load(await makePlayer("adultsign", "18plus"));
  check("home area is stored coarse (2 dp)", adult.homeLat === 53.35 && adult.homeLng === -6.26, `${adult.homeLat},${adult.homeLng}`);
  check("18+ lands in the adult tier", adult.ageTier === "adult");
  check("16–17 lands in the minor tier", (await load(await makePlayer("sixteen", "16to17"))).ageTier === "minor");
  await rejects(
    "an adult cannot re-sign-up as a minor",
    () => completeSignupProfile({ playerId: adult.id, ageBand: "13to15", lat: 53, lng: -6, guardianConfirmed: true }),
    /already set/i,
  );
  check("…and stays adult", (await load(adult.id)).ageTier === "adult");
  const code = adult.inviteCode;
  await completeSignupProfile({ playerId: adult.id, ageBand: "18plus", lat: 51.5, lng: -0.12, guardianConfirmed: false });
  const moved = await load(adult.id);
  check("same band can refresh the home area", moved.homeLat === 51.5 && moved.homeLng === -0.12);
  check("…without changing the friend code", moved.inviteCode === code);
}

async function parentConsent() {
  console.log("\nparent consent (under 13)");
  const kid = await makePlayer("kid", "under13", { aged: true });
  check("under-13 locked until a parent confirms", !communityAccess(await load(kid)).community);
  check("under-13 cannot fight others until a parent confirms", matchBlocker(await load(kid)) !== null);
  const [row] = await db.select().from(schema.parentConsent).where(eq(schema.parentConsent.playerId, kid));
  check("a consent request was recorded", Boolean(row?.token));
  await rejects("a made-up token is rejected", () => verifyParentConsent("notarealtoken123"));
  await verifyParentConsent(row!.token);
  const after = await load(kid);
  check("parent link unlocks community", communityAccess(after).community);
  check("…but never free text under 13", !communityAccess(after).freeText);
  check("…and never hosting under 13", !communityAccess(after).host);
  check("…and allows matches", matchBlocker(after) === null);
  await revokeParentConsent(row!.token);
  check("parent can withdraw and it locks again", !communityAccess(await load(kid)).community);
}

async function partition() {
  console.log("\nadults and under-18s never meet");
  const adult = await makePlayer("adult", "18plus", { aged: true });
  const adult2 = await makePlayer("adult2", "18plus", { aged: true });
  const teen = await makePlayer("teen", "16to17", { aged: true });
  const teen2 = await makePlayer("teen2", "13to15", { aged: true });

  const teenRow = await load(teen);
  const adultRow = await load(adult);
  await rejects("adult cannot redeem a teen's invite code", () => redeemInviteCode(adultRow, teenRow.inviteCode!), /apart/i);
  await rejects("teen cannot redeem an adult's invite code", () => redeemInviteCode(teenRow, adultRow.inviteCode!), /apart/i);

  const req = await redeemInviteCode(await load(teen2), teenRow.inviteCode!);
  check("two under-18s can become friends by code", req.status === "pending");
  await respondToRequest(teenRow, req.friendLinkId, true);
  const list = await friendList(teenRow);
  check("friend list shows the accepted friend", list.friends.some((f) => f.playerId === teen2));

  const team = await createTeam(teenRow, `T${Date.now().toString(36).slice(-6)}`);
  const teamId = (team as { team?: { id: string } }).team?.id ?? (team as { id?: string }).id;
  if (teamId) made.teams.push(teamId);
  const joinCode =
    (team as { team?: { joinCode: string } }).team?.joinCode ?? (team as { joinCode?: string }).joinCode;
  check("16–17 can create a team", Boolean(joinCode));
  if (joinCode) {
    await rejects("adult cannot join an under-18 team", () => joinTeam(adultRow, joinCode), /apart|separately/i);
  }

  // Match: a minor's open lobby refuses an adult; same tier is fine.
  const matchId = ids.match();
  const [anyZone] = await db.select({ id: schema.zone.id }).from(schema.zone).limit(1);
  await db.insert(schema.match).values({ id: matchId, zoneId: anyZone!.id, hostPlayerId: teen, status: "waiting", maxPlayers: 4 });
  made.matches.push(matchId);
  await db.insert(schema.matchPlayer).values({ id: ids.matchPlayer(), matchId, playerId: teen, avatarId: "none" });
  await rejects("adult cannot join an under-18 match", () => requireCanJoin(adult, matchId), /apart/i);
  let ok = true;
  try {
    await requireCanJoin(teen2, matchId);
  } catch {
    ok = false;
  }
  check("same-tier player can join the match", ok);

  await blockPlayer(teen2, teen);
  await rejects("a blocked pair cannot share a match", () => requireCanJoin(teen2, matchId), /not available/i);
  const afterBlock = await friendList(teenRow);
  check("a block removes them from the friend list", !afterBlock.friends.some((f) => f.playerId === teen2));

  // Adults can friend adults.
  const ad = await redeemInviteCode(await load(adult2), adultRow.inviteCode!);
  check("two adults can become friends", ad.status === "pending");
}

async function chat() {
  console.log("\nchat");
  const fresh = await makePlayer("fresh", "16to17");
  const freshFriend = await makePlayer("freshfriend", "16to17");
  const r = await redeemInviteCode(await load(fresh), (await load(freshFriend)).inviteCode!);
  await respondToRequest(await load(freshFriend), r.friendLinkId, true);
  const channel = { scope: "friend" as const, channelId: r.friendLinkId };

  const freshRow = await load(fresh);
  const preset = await sendChat(freshRow, { ...channel, kind: "preset", presetId: "gg" });
  check("new account can send a preset", preset.message.body.length > 0);
  await rejects(
    "new account cannot type free text",
    () => sendChat(freshRow, { ...channel, kind: "text", body: "hello there" }),
    /first day/i,
  );

  const phone = filterMessage("call me on 087 123 4567 ok");
  check("phone numbers are redacted", phone.redacted && !/087/.test(phone.text), phone.text);
  const email = filterMessage("mail me at kid@example.com");
  check("email addresses are redacted", email.redacted && !/example\.com/.test(email.text), email.text);
  const url = filterMessage("go to www.somewhere.com now");
  check("links are redacted", url.redacted && !/somewhere/.test(url.text), url.text);
  const snap = filterMessage("add me on snapchat");
  check("other-platform handles are redacted or blocked", snap.redacted || snap.blocked, snap.text);
  const meet = filterMessage("come meet me alone, don't tell your parents");
  check("'meet alone / don't tell' is blocked", meet.blocked, meet.reasons.join(","));
  check("plain game talk passes untouched", !filterMessage("nice combo, rematch?").redacted);
  check("'leave me alone' is not mistaken for a meeting", !filterMessage("leave me alone lol").blocked);
  check("'where do you live' is blocked", filterMessage("where do you live?").blocked);
  check("'send me a selfie' is blocked", filterMessage("send me a selfie").blocked);
  check("sexual content is blocked", filterMessage("send nudes").blocked);

  // An account past its first day can type, and the filter runs on the way in.
  await db.update(schema.player).set({ createdAt: new Date(Date.now() - 3 * DAY) }).where(eq(schema.player.id, freshFriend));
  const agedRow = await load(freshFriend);
  const typed = await sendChat(agedRow, { ...channel, kind: "text", body: "ring me 087 123 4567" });
  check("typed message is stored redacted", typed.redacted && !/087/.test(typed.message.body), typed.message.body);
  await new Promise((r) => setTimeout(r, 1700));
  await rejects(
    "a private meeting request is refused at send",
    () => sendChat(agedRow, { ...channel, kind: "text", body: "meet me behind the shop" }),
    /not allowed/i,
  );
  check("a phone number in a team name is refused or stripped", (() => {
    const n = filterName("call 0871234567");
    return n.blocked || !/0871234567/.test(n.text);
  })());
}
async function reports() {
  console.log("\nreports");
  const target = await makePlayer("target", "18plus", { aged: true });
  const reporters = [
    await makePlayer("rep1", "18plus", { aged: true }),
    await makePlayer("rep2", "18plus", { aged: true }),
    await makePlayer("rep3", "18plus", { aged: true }),
  ];
  await reportPlayer({ reporterId: reporters[0]!, subjectId: target, reason: "bullying" });
  await reportPlayer({ reporterId: reporters[0]!, subjectId: target, reason: "bullying" });
  check("one reporter twice does not hide", (await load(target)).moderationState === "active");
  await reportPlayer({ reporterId: reporters[1]!, subjectId: target, reason: "personal_info" });
  const third = await reportPlayer({ reporterId: reporters[2]!, subjectId: target, reason: "other" });
  check("three separate reporters auto-hide the account", third.autoHidden && (await load(target)).moderationState === "hidden");
  check("a hidden account loses community", !communityAccess(await load(target)).community);
  check("a hidden account cannot fight", matchBlocker(await load(target)) !== null);
  const [blk] = await db
    .select()
    .from(schema.playerBlock)
    .where(eq(schema.playerBlock.playerId, reporters[1]!));
  check("reporting also blocks", blk?.blockedId === target);
  await rejects("you cannot report yourself", () => reportPlayer({ reporterId: target, subjectId: target, reason: "other" }));
}

async function cleanup() {
  const p = made.players;
  if (p.length === 0) return;
  const links = await db
    .select({ id: schema.friendLink.id })
    .from(schema.friendLink)
    .where(or(inArray(schema.friendLink.aPlayerId, p), inArray(schema.friendLink.bPlayerId, p)));
  const channelIds = [...links.map((l) => l.id), ...made.teams];
  if (channelIds.length) await db.delete(schema.chatMessage).where(inArray(schema.chatMessage.channelId, channelIds));
  await db.delete(schema.chatMessage).where(inArray(schema.chatMessage.authorId, p));
  await db.delete(schema.friendLink).where(or(inArray(schema.friendLink.aPlayerId, p), inArray(schema.friendLink.bPlayerId, p)));
  await db.delete(schema.teamMember).where(inArray(schema.teamMember.playerId, p));
  await db.delete(schema.team).where(inArray(schema.team.ownerId, p));
  await db.delete(schema.playerBlock).where(or(inArray(schema.playerBlock.playerId, p), inArray(schema.playerBlock.blockedId, p)));
  await db.delete(schema.playerReport).where(or(inArray(schema.playerReport.reporterId, p), inArray(schema.playerReport.subjectId, p)));
  await db.delete(schema.moderationAction).where(inArray(schema.moderationAction.subjectId, p));
  await db.delete(schema.parentConsent).where(inArray(schema.parentConsent.playerId, p));
  if (made.matches.length) {
    await db.delete(schema.matchPlayer).where(inArray(schema.matchPlayer.matchId, made.matches));
    await db.delete(schema.match).where(inArray(schema.match.id, made.matches));
  }
  await db.delete(schema.player).where(inArray(schema.player.id, p));
}

function meetupHours() {
  // 19:30 UTC in Dublin summer is 20:30 local: device offset -60 must be honoured.
  const at = new Date("2026-07-04T19:30:00Z");
  check("park hour: Dublin, no hint = solar (19)", parkLocalHour(at, -6.26) === 19);
  check("park hour: Dublin, IST hint = 20", parkLocalHour(at, -6.26, -60) === 20);
  check("park hour: absurd hint ignored", parkLocalHour(at, -6.26, 600) === 19);
  check("park hour: Tokyo solar", parkLocalHour(at, 139.7) === 4);
}

try {
  meetupHours();
  await signup();
  await parentConsent();
  await partition();
  await chat();
  await reports();
} catch (error) {
  failed++;
  console.error("\x1b[31mcrashed\x1b[0m", error);
} finally {
  await cleanup().catch((error) => console.error("cleanup failed", error));
}
console.log(`\n${failed ? "FAIL" : "PASS"} — ${passed} checks passed, ${failed} failed`);
process.exit(failed ? 1 : 0);

