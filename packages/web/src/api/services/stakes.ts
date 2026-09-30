import { and, eq, gt, isNull } from "drizzle-orm";
import { db } from "../database";
import * as schema from "../database/schema";
import { ids } from "../lib/ids";
import { rollRarity } from "../lib/rng";
import { mintBoosterInstance, pickBoosterDefinition } from "./boosters";
import { logTransaction } from "./players";

/**
 * Fight stakes — losing costs a booster.
 *
 * The loser gives up one booster that was equipped on the avatar it fought
 * with. That instance is destroyed, and the winner is minted a fresh level-1
 * copy of the same booster: the item changes hands, the loser's levels do not.
 * A loser with nothing equipped has nothing to take, so the winner is paid a
 * random booster instead. Either way the winner owns a normal, tradable
 * instance — equip it or list it on the marketplace.
 */

/** Only a fight that actually ended pays out. A called or reaped match does not. */
export const STAKED_REASONS = new Set(["last_standing", "opponent_left"]);

/** One forfeit per winner/loser pair per window, so two accounts cannot farm each other. */
export const PAIR_COOLDOWN_MS = 24 * 3_600_000;

export type ForfeitResult = {
  loserPlayerId: string;
  winnerPlayerId: string;
  kind: "spoils" | "bounty";
  booster: { id: string; name: string; rarity: string };
  lostInstanceId: string | null;
  lostLevel: number | null;
  grantedInstanceId: string;
} | {
  loserPlayerId: string;
  winnerPlayerId: string;
  kind: "skipped";
  why: "pair_cooldown";
};

async function recentPairForfeit(winnerPlayerId: string, loserPlayerId: string) {
  const since = new Date(Date.now() - PAIR_COOLDOWN_MS);
  const [row] = await db
    .select({ id: schema.boosterForfeit.id })
    .from(schema.boosterForfeit)
    .where(
      and(
        eq(schema.boosterForfeit.winnerPlayerId, winnerPlayerId),
        eq(schema.boosterForfeit.loserPlayerId, loserPlayerId),
        gt(schema.boosterForfeit.createdAt, since),
      ),
    )
    .limit(1);
  return Boolean(row);
}

/** Boosters that can be taken: equipped on the avatar that fought, live, not in escrow. */
async function takeableBoosters(loserPlayerId: string, avatarId: string) {
  return db
    .select({ instance: schema.boosterInstance, booster: schema.booster })
    .from(schema.boosterInstance)
    .innerJoin(schema.booster, eq(schema.booster.id, schema.boosterInstance.boosterId))
    .where(
      and(
        eq(schema.boosterInstance.ownerId, loserPlayerId),
        eq(schema.boosterInstance.equippedAvatarId, avatarId),
        isNull(schema.boosterInstance.supersededAt),
        // A listed instance is held by the marketplace until it sells or is pulled.
        isNull(schema.boosterInstance.listedListingId),
      ),
    );
}

/** Pick one takeable booster and destroy it. Null when there is nothing to take. */
async function takeOne(loserPlayerId: string, avatarId: string) {
  const candidates = await takeableBoosters(loserPlayerId, avatarId);
  // Retry on a lost race (the row was sold or unequipped between read and delete).
  for (const taken of [...candidates].sort(() => Math.random() - 0.5)) {
    const deleted = await db
      .delete(schema.boosterInstance)
      .where(
        and(
          eq(schema.boosterInstance.id, taken.instance.id),
          eq(schema.boosterInstance.ownerId, loserPlayerId),
          eq(schema.boosterInstance.equippedAvatarId, avatarId),
          isNull(schema.boosterInstance.listedListingId),
        ),
      )
      .returning({ id: schema.boosterInstance.id });
    if (deleted.length > 0) return taken;
  }
  return null;
}

/**
 * Settle one loser against the winner. Safe to call once per loser per match;
 * the match itself only settles once (finishMatch returns early when finished).
 */
export async function settleForfeit(input: {
  matchId: string;
  winnerPlayerId: string;
  loserPlayerId: string;
  loserAvatarId: string;
}): Promise<ForfeitResult> {
  const { matchId, winnerPlayerId, loserPlayerId } = input;
  if (await recentPairForfeit(winnerPlayerId, loserPlayerId)) {
    return { winnerPlayerId, loserPlayerId, kind: "skipped", why: "pair_cooldown" };
  }

  const taken = await takeOne(loserPlayerId, input.loserAvatarId);
  const kind = taken ? "spoils" : "bounty";
  // Nothing to take: the winner is paid from the pool instead, a touch luckier than a drop.
  const booster = taken?.booster ?? (await pickBoosterDefinition(rollRarity(1.2), "battle"));

  const granted = await mintBoosterInstance({
    boosterId: booster.id,
    ownerId: winnerPlayerId,
    acquiredVia: "spoils",
  });
  await db.insert(schema.boosterForfeit).values({
    id: ids.forfeit(),
    matchId,
    winnerPlayerId,
    loserPlayerId,
    kind,
    boosterId: booster.id,
    lostInstanceId: taken?.instance.id ?? null,
    lostLevel: taken?.instance.level ?? null,
    grantedInstanceId: granted.id,
  });
  await logTransaction({
    type: "battle_forfeit",
    fromPlayerId: taken ? loserPlayerId : null,
    toPlayerId: winnerPlayerId,
    amount: 0,
    netAmount: 0,
    note: taken
      ? `Match ${matchId}: took ${booster.name} (lv ${taken.instance.level}) off the loser`
      : `Match ${matchId}: bounty ${booster.name}, loser had nothing equipped`,
  });
  return {
    winnerPlayerId,
    loserPlayerId,
    kind,
    booster: { id: booster.id, name: booster.name, rarity: booster.rarity },
    lostInstanceId: taken?.instance.id ?? null,
    lostLevel: taken?.instance.level ?? null,
    grantedInstanceId: granted.id,
  };
}
