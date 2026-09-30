/**
 * Stakes + personal drops check, against the real database.
 *
 * Builds throwaway players, avatars, zones and hazards far out in the Southern
 * Ocean (nothing real lives there), drives the actual services and engine, and
 * deletes every row it made on the way out, pass or fail.
 *
 *   cd packages/web && bun --env-file=../../.env scripts/combat/stakes-check.ts
 */
import { and, eq, inArray, like, or } from "drizzle-orm";
import { db } from "../../src/api/database";
import * as schema from "../../src/api/database/schema";
import { finishMatch } from "../../src/api/battle/engine";
import { ids } from "../../src/api/lib/ids";
import { collectSpawn, nearbySpawns } from "../../src/api/services/nature";
import { STAKED_REASONS, settleForfeit } from "../../src/api/services/stakes";
import {
  PERSONAL_DROP_COOLDOWN_MS,
  PERSONAL_DROPS_PER_DAY,
  dropAllowance,
  maybeDropForPlayer,
} from "../../src/api/services/drops";

const TAG = `stakecheck_${Date.now().toString(36)}`;
let passed = 0;
let failed = 0;
function check(name: string, ok: boolean, detail = "") {
  if (ok) passed++;
  else failed++;
  console.log(`  ${ok ? "\x1b[32mok\x1b[0m  " : "\x1b[31mFAIL\x1b[0m"} ${name}${detail ? ` — ${detail}` : ""}`);
}

const made = { players: [] as string[], zones: [] as string[], hazards: [] as string[], matches: [] as string[] };

async function makePlayer(label: string) {
  const id = ids.player();
  await db.insert(schema.player).values({ id, userId: `${TAG}_${label}`, username: `${TAG}_${label}` });
  made.players.push(id);
  return id;
}

async function makeAvatar(ownerId: string, health = 100) {
  const id = ids.avatar();
  await db.insert(schema.avatar).values({
    id,
    ownerId,
    name: `${TAG} bot`,
    modelId: "brute",
    attack: 10,
    defense: 10,
    speed: 10,
    health,
    rarity: "common",
    specialAbility: "Test Slam",
  });
  return id;
}

let boosterId = "";
async function giveBooster(ownerId: string, opts: { avatarId?: string; level?: number; listed?: boolean } = {}) {
  const id = ids.boosterInstance();
  await db.insert(schema.boosterInstance).values({
    id,
    boosterId,
    ownerId,
    equippedAvatarId: opts.avatarId ?? null,
    acquiredVia: "purchase",
    level: opts.level ?? 1,
    listedListingId: opts.listed ? `lst_${TAG}` : null,
  });
  return id;
}

async function instanceExists(id: string) {
  const [row] = await db.select().from(schema.boosterInstance).where(eq(schema.boosterInstance.id, id));
  return Boolean(row);
}

async function makeZone(name: string, lat: number, lng: number, review: "approved" | "pending") {
  const id = ids.zone();
  await db.insert(schema.zone).values({
    id,
    name: `${TAG} ${name}`,
    centerLat: lat,
    centerLng: lng,
    radiusM: 200,
    review,
    isActive: true,
  });
  made.zones.push(id);
  const [zone] = await db.select().from(schema.zone).where(eq(schema.zone.id, id));
  return zone!;
}

/** A finished-able match with W alive and L knocked out. */
async function makeMatch(zoneId: string, w: { p: string; a: string }, l: { p: string; a: string }) {
  const matchId = ids.match();
  made.matches.push(matchId);
  await db.insert(schema.match).values({
    id: matchId,
    zoneId,
    hostPlayerId: w.p,
    status: "active",
    startTime: new Date(),
  });
  for (const [who, alive] of [
    [w, true],
    [l, false],
  ] as const) {
    await db.insert(schema.matchPlayer).values({ id: ids.matchPlayer(), matchId, playerId: who.p, avatarId: who.a });
    await db.insert(schema.battleState).values({
      id: ids.battleState(),
      matchId,
      playerId: who.p,
      avatarId: who.a,
      maxHealth: 100,
      currentHealth: alive ? 60 : 0,
      attack: 10,
      defense: 10,
      speed: 10,
      alive,
      kills: alive ? 1 : 0,
      damageDealt: alive ? 100 : 40,
    });
  }
  return matchId;
}

async function cleanup() {
  const players = made.players;
  if (players.length) {
    const instances = await db
      .select({ id: schema.boosterInstance.id })
      .from(schema.boosterInstance)
      .where(inArray(schema.boosterInstance.ownerId, players));
    if (instances.length) {
      await db.delete(schema.boosterInstance).where(inArray(schema.boosterInstance.id, instances.map((i) => i.id)));
    }
    await db.delete(schema.avatar).where(inArray(schema.avatar.ownerId, players));
    await db
      .delete(schema.boosterForfeit)
      .where(or(inArray(schema.boosterForfeit.winnerPlayerId, players), inArray(schema.boosterForfeit.loserPlayerId, players)));
    await db
      .delete(schema.transaction)
      .where(or(inArray(schema.transaction.toPlayerId, players), inArray(schema.transaction.fromPlayerId, players)));
    await db.delete(schema.spawnPoint).where(inArray(schema.spawnPoint.reservedForPlayerId, players));
    await db.delete(schema.safetyEvent).where(inArray(schema.safetyEvent.playerId, players));
    await db.delete(schema.player).where(inArray(schema.player.id, players));
  }
  if (made.matches.length) {
    await db.delete(schema.battleEvent).where(inArray(schema.battleEvent.matchId, made.matches));
    await db.delete(schema.battleState).where(inArray(schema.battleState.matchId, made.matches));
    await db.delete(schema.matchPlayer).where(inArray(schema.matchPlayer.matchId, made.matches));
    await db.delete(schema.boosterForfeit).where(inArray(schema.boosterForfeit.matchId, made.matches));
    await db.delete(schema.match).where(inArray(schema.match.id, made.matches));
  }
  if (made.zones.length) {
    await db.delete(schema.spawnPoint).where(inArray(schema.spawnPoint.zoneId, made.zones));
    await db.delete(schema.zone).where(inArray(schema.zone.id, made.zones));
  }
  if (made.hazards.length) await db.delete(schema.dangerZone).where(inArray(schema.dangerZone.id, made.hazards));
  // Belt and braces: anything tagged that slipped through.
  await db.delete(schema.player).where(like(schema.player.userId, `${TAG}%`));
}

async function stakes() {
  console.log("\n== stakes: services/stakes.ts");
  const w = await makePlayer("w");

  // Spoils: the loser's equipped booster is destroyed, the winner gets a fresh copy.
  const l1 = await makePlayer("l1");
  const l1a = await makeAvatar(l1);
  const lost = await giveBooster(l1, { avatarId: l1a, level: 3 });
  const r1 = await settleForfeit({ matchId: `mch_${TAG}_1`, winnerPlayerId: w, loserPlayerId: l1, loserAvatarId: l1a });
  made.matches.push(`mch_${TAG}_1`);
  check("spoils kind", r1.kind === "spoils", r1.kind);
  check("loser's equipped instance destroyed", !(await instanceExists(lost)));
  if (r1.kind === "spoils") {
    const [granted] = await db
      .select()
      .from(schema.boosterInstance)
      .where(eq(schema.boosterInstance.id, r1.grantedInstanceId));
    check("winner owns the new copy", granted?.ownerId === w);
    check("new copy is the same booster", granted?.boosterId === boosterId);
    check("new copy is acquiredVia spoils", granted?.acquiredVia === "spoils");
    check("new copy starts at level 1 (levels do not transfer)", granted?.level === 1, `lv ${granted?.level}`);
    check("new copy is unequipped and tradable", granted?.equippedAvatarId == null && granted?.tradable === true);
    check("lost level recorded", r1.lostLevel === 3);
  }
  const trx = await db
    .select()
    .from(schema.transaction)
    .where(and(eq(schema.transaction.type, "battle_forfeit"), eq(schema.transaction.toPlayerId, w)));
  check("battle_forfeit transaction logged", trx.length === 1);

  // Pair cooldown: the same pair inside 24h does not pay again.
  const second = await giveBooster(l1, { avatarId: l1a });
  const r2 = await settleForfeit({ matchId: `mch_${TAG}_2`, winnerPlayerId: w, loserPlayerId: l1, loserAvatarId: l1a });
  check("same pair within 24h is skipped", r2.kind === "skipped", r2.kind);
  check("skipped pair keeps its booster", await instanceExists(second));
  const pairRows = await db
    .select()
    .from(schema.boosterForfeit)
    .where(and(eq(schema.boosterForfeit.winnerPlayerId, w), eq(schema.boosterForfeit.loserPlayerId, l1)));
  check("skip is not persisted", pairRows.length === 1, `${pairRows.length} rows`);

  // Bounty: nothing equipped, so nothing is taken and the winner is paid from the pool.
  const l2 = await makePlayer("l2");
  const l2a = await makeAvatar(l2);
  const loose = await giveBooster(l2); // in the bag, not equipped
  const r3 = await settleForfeit({ matchId: `mch_${TAG}_3`, winnerPlayerId: w, loserPlayerId: l2, loserAvatarId: l2a });
  check("nothing equipped → bounty", r3.kind === "bounty", r3.kind);
  check("unequipped booster in the bag is not taken", await instanceExists(loose));
  if (r3.kind === "bounty") {
    const [granted] = await db
      .select()
      .from(schema.boosterInstance)
      .where(eq(schema.boosterInstance.id, r3.grantedInstanceId));
    check("bounty minted for the winner", granted?.ownerId === w && granted?.acquiredVia === "spoils");
    check("bounty records no lost instance", r3.lostInstanceId === null);
  }

  // Listed boosters sit in marketplace escrow and cannot be taken.
  const l3 = await makePlayer("l3");
  const l3a = await makeAvatar(l3);
  const listed = await giveBooster(l3, { avatarId: l3a, listed: true });
  const r4 = await settleForfeit({ matchId: `mch_${TAG}_4`, winnerPlayerId: w, loserPlayerId: l3, loserAvatarId: l3a });
  check("listed booster is not taken", (await instanceExists(listed)) && r4.kind === "bounty", r4.kind);

  // Only the avatar that fought is at stake, not the player's other avatars.
  const l4 = await makePlayer("l4");
  const fought = await makeAvatar(l4);
  const benched = await makeAvatar(l4);
  const onBench = await giveBooster(l4, { avatarId: benched });
  const r5 = await settleForfeit({ matchId: `mch_${TAG}_5`, winnerPlayerId: w, loserPlayerId: l4, loserAvatarId: fought });
  check("booster on a benched avatar is not taken", (await instanceExists(onBench)) && r5.kind === "bounty", r5.kind);

  console.log("\n== stakes: engine finishMatch");
  check("called is not a staked reason", !STAKED_REASONS.has("called"));
  const zone = await makeZone("arena", -60.5, 170.1, "approved");

  const cw = await makePlayer("cw");
  const cwa = await makeAvatar(cw);
  const cl = await makePlayer("cl");
  const cla = await makeAvatar(cl);
  const calledKeep = await giveBooster(cl, { avatarId: cla });
  const calledMatch = await makeMatch(zone.id, { p: cw, a: cwa }, { p: cl, a: cla });
  const calledResult = await finishMatch({ matchId: calledMatch, reason: "called" });
  const calledForfeits = "forfeits" in calledResult ? calledResult.forfeits : [];
  check("called match settles no forfeits", calledForfeits.length === 0, `${calledForfeits.length}`);
  check("called match loser keeps the booster", await instanceExists(calledKeep));

  const sw = await makePlayer("sw");
  const swa = await makeAvatar(sw);
  const sl = await makePlayer("sl");
  const sla = await makeAvatar(sl);
  const staked = await giveBooster(sl, { avatarId: sla, level: 2 });
  const stakedMatch = await makeMatch(zone.id, { p: sw, a: swa }, { p: sl, a: sla });
  const result = await finishMatch({ matchId: stakedMatch, reason: "last_standing" });
  const forfeits = "forfeits" in result ? result.forfeits : [];
  check("last_standing match settles one forfeit", forfeits.length === 1, `${forfeits.length}`);
  check("forfeit is spoils to the winner", forfeits[0]?.kind === "spoils" && forfeits[0]?.winnerPlayerId === sw);
  check("last_standing loser's booster destroyed", !(await instanceExists(staked)));
  const [event] = await db
    .select()
    .from(schema.battleEvent)
    .where(and(eq(schema.battleEvent.matchId, stakedMatch), eq(schema.battleEvent.type, "match_finished")));
  check("match_finished event carries forfeits", Boolean(event && String(event.payload).includes('"forfeits"')));
  const replay = await finishMatch({ matchId: stakedMatch, reason: "last_standing" });
  check("re-finishing a finished match settles nothing new", (replay.forfeits ?? []).length === 1);
  const rows = await db.select().from(schema.boosterForfeit).where(eq(schema.boosterForfeit.matchId, stakedMatch));
  check("snapshot forfeits come from the DB, one row", rows.length === 1);
}

async function drops() {
  console.log("\n== personal drops: services/drops.ts");
  const park = await makeZone("park", -60.1, 170.1, "approved");
  await makeZone("pending park", -60.2, 170.1, "pending");
  const covered = await makeZone("covered park", -60.3, 170.1, "approved");
  const hazardId = ids.dangerZone();
  await db.insert(schema.dangerZone).values({
    id: hazardId,
    name: `${TAG} lake`,
    kind: "water",
    centerLat: covered.centerLat,
    centerLng: covered.centerLng,
    radiusM: 400,
    source: "manual",
  });
  made.hazards.push(hazardId);
  const nearPark = { lat: -60.1 + 0.005, lng: 170.1 }; // ~560m from centre, ~360m from the edge

  const a = await makePlayer("da");
  const drop = await maybeDropForPlayer(a, nearPark.lat, nearPark.lng);
  check("drop near an approved zone", drop?.spawn.zoneId === park.id, drop?.zoneName ?? "none");
  check("drop is reserved for that player", drop?.spawn.reservedForPlayerId === a);
  check("throttle: an immediate second look drops nothing", (await maybeDropForPlayer(a, nearPark.lat, nearPark.lng)) === null);

  const b = await makePlayer("db");
  const seenByA = await nearbySpawns({ lat: nearPark.lat, lng: nearPark.lng, playerId: a, radiusM: 3000 });
  const seenByB = await nearbySpawns({ lat: nearPark.lat, lng: nearPark.lng, playerId: b, radiusM: 3000 });
  const seenAnon = await nearbySpawns({ lat: nearPark.lat, lng: nearPark.lng, radiusM: 3000 });
  check("owner sees their drop, flagged personal", seenByA.some((s) => s.id === drop?.spawn.id && s.personal));
  check("another player cannot see it", !seenByB.some((s) => s.id === drop?.spawn.id));
  check("an anonymous read cannot see it", !seenAnon.some((s) => s.id === drop?.spawn.id));
  // B also got their own drop from that read; A must not see B's.
  const bDrops = seenByB.filter((s) => s.personal);
  check("B got their own drop and A cannot see it", bDrops.length === 1 && !seenByA.some((s) => s.id === bDrops[0]!.id));

  let stolen = "";
  try {
    await collectSpawn({ spawnPointId: drop!.spawn.id, playerId: b, lat: drop!.spawn.lat, lng: drop!.spawn.lng });
  } catch (error) {
    stolen = (error as { code?: string }).code ?? String(error);
  }
  check("another player cannot collect it", stolen === "NOT_FOUND", stolen || "collected!");

  // Cooldown: one drop 30 minutes ago blocks the next.
  const c = await makePlayer("dc");
  await db.insert(schema.spawnPoint).values({
    id: ids.spawnPoint(),
    zoneId: park.id,
    boosterId,
    lat: park.centerLat,
    lng: park.centerLng,
    rarity: "common",
    description: TAG,
    reservedForPlayerId: c,
    expiresAt: new Date(Date.now() + 3_600_000),
    createdAt: new Date(Date.now() - 30 * 60_000),
  });
  const cAllow = await dropAllowance(c);
  check("allowance shows the cooldown", cAllow.remainingToday === PERSONAL_DROPS_PER_DAY - 1 && cAllow.nextDropAt != null);
  check("no drop inside the 2h cooldown", (await maybeDropForPlayer(c, nearPark.lat, nearPark.lng)) === null);

  // Daily cap: three drops spaced past the cooldown still exhaust the day.
  const d = await makePlayer("dd");
  for (const hoursAgo of [3, 7, 11]) {
    await db.insert(schema.spawnPoint).values({
      id: ids.spawnPoint(),
      zoneId: park.id,
      boosterId,
      lat: park.centerLat,
      lng: park.centerLng,
      rarity: "common",
      description: TAG,
      reservedForPlayerId: d,
      expiresAt: new Date(Date.now() + 3_600_000),
      createdAt: new Date(Date.now() - hoursAgo * 3_600_000),
    });
  }
  const dAllow = await dropAllowance(d);
  check("cap: remaining 0", dAllow.remainingToday === 0);
  check(
    "cap: next slot opens when the oldest ages out",
    Math.abs((dAllow.nextDropAt?.getTime() ?? 0) - (Date.now() + 13 * 3_600_000)) < 60_000,
  );
  check(`no drop past ${PERSONAL_DROPS_PER_DAY}/day`, (await maybeDropForPlayer(d, nearPark.lat, nearPark.lng)) === null);

  // Old drops past the cooldown do not block.
  const e = await makePlayer("de");
  await db.insert(schema.spawnPoint).values({
    id: ids.spawnPoint(),
    zoneId: park.id,
    boosterId,
    lat: park.centerLat,
    lng: park.centerLng,
    rarity: "common",
    description: TAG,
    reservedForPlayerId: e,
    expiresAt: new Date(Date.now() + 3_600_000),
    createdAt: new Date(Date.now() - PERSONAL_DROP_COOLDOWN_MS - 60_000),
  });
  check("drop allowed once the cooldown has passed", (await maybeDropForPlayer(e, nearPark.lat, nearPark.lng)) != null);

  const far = await makePlayer("dfar");
  check("no drop far from every zone", (await maybeDropForPlayer(far, -60.1 + 0.05, 170.1)) === null);
  const pend = await makePlayer("dpend");
  check("no drop at a pending (unreviewed) zone", (await maybeDropForPlayer(pend, -60.2 + 0.005, 170.1)) === null);
  const wet = await makePlayer("dwet");
  check("no drop in a zone covered by a hazard", (await maybeDropForPlayer(wet, -60.3 + 0.005, 170.1)) === null);
}

try {
  const [def] = await db.select().from(schema.booster).where(eq(schema.booster.tier, 1)).limit(1);
  if (!def) throw new Error("No booster definitions in the DB to test with");
  boosterId = def.id;
  await stakes();
  await drops();
} catch (error) {
  failed++;
  console.error("\x1b[31mcrashed\x1b[0m", error);
} finally {
  await cleanup().catch((error) => console.error("cleanup failed", error));
}
console.log(`\n${failed ? "FAIL" : "PASS"} — ${passed} checks passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
