import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { orpc } from "../lib/api";
import type { GeoFix } from "../lib/geo";

/**
 * Data hooks for the AR client.
 *
 * Every hook that needs a position takes the fix from `useGeo()` and is
 * `enabled` only when one exists — so a player who declined location consent
 * never triggers a single location-bearing request. The server stays the
 * authority: the client polls `safety.check` and renders the verdict verbatim
 * rather than deciding anything about roads, zones or speed itself.
 *
 * Poll intervals are deliberate. Safety is the fastest thing on the wire
 * because it is what stops a child walking into a road; spawns and hazards move
 * slowly and are polled lazily.
 */

const SAFETY_MS = 4_000;
const SPAWN_MS = 10_000;
const HAZARD_MS = 30_000;

type Fix = GeoFix | null;

/* ------------------------------------------------------------------- safety */

export function useSafetyConfig(enabled: boolean) {
  return useQuery(orpc.safety.config.queryOptions({ enabled, staleTime: 5 * 60_000 }));
}

/** The overlay verdict. This is the only thing allowed to say "stop". */
export function useSafetyCheck(fix: Fix, enabled: boolean) {
  return useQuery(
    orpc.safety.check.queryOptions({
      input: {
        lat: fix?.lat,
        lng: fix?.lng,
        speedMps: fix?.speedMps ?? undefined,
      },
      enabled: enabled && Boolean(fix),
      refetchInterval: SAFETY_MS,
      staleTime: 0,
      // Keep the last verdict on screen through a transient failure rather
      // than flashing "unknown" at the player.
      placeholderData: (previous) => previous,
    }),
  );
}

export function useHazards(fix: Fix, enabled: boolean) {
  return useQuery(
    orpc.safety.hazards.queryOptions({
      input: { lat: fix?.lat ?? 0, lng: fix?.lng ?? 0, radiusM: 500 },
      enabled: enabled && Boolean(fix),
      refetchInterval: HAZARD_MS,
      placeholderData: (previous) => previous,
    }),
  );
}

/* ---------------------------------------------------------------- explore */

export function useNearestZone(fix: Fix, enabled: boolean) {
  return useQuery(
    orpc.nature.nearestZone.queryOptions({
      input: { lat: fix?.lat, lng: fix?.lng },
      enabled: enabled && Boolean(fix),
      staleTime: 60_000,
      placeholderData: (previous) => previous,
    }),
  );
}

export function useNearbySpawns(fix: Fix, enabled: boolean) {
  return useQuery(
    orpc.nature.nearby.queryOptions({
      input: { lat: fix?.lat ?? 0, lng: fix?.lng ?? 0, radiusM: 1_000 },
      enabled: enabled && Boolean(fix),
      refetchInterval: SPAWN_MS,
      placeholderData: (previous) => previous,
    }),
  );
}

export function useCollectSpawn() {
  const queryClient = useQueryClient();
  return useMutation(
    orpc.nature.collect.mutationOptions({
      onSuccess: () => {
        void queryClient.invalidateQueries({ queryKey: orpc.nature.key() });
        void queryClient.invalidateQueries({ queryKey: orpc.boosters.key() });
        void queryClient.invalidateQueries({ queryKey: orpc.players.key() });
      },
    }),
  );
}

/* ----------------------------------------------------------------- avatars */

export function useEligibleAvatars(enabled: boolean) {
  return useQuery(orpc.matches.eligibleAvatars.queryOptions({ enabled, staleTime: 30_000 }));
}

export function useAvatarLimits(enabled: boolean) {
  return useQuery(orpc.avatars.limits.queryOptions({ enabled, staleTime: 5 * 60_000 }));
}

export function useGenerateAvatar() {
  const queryClient = useQueryClient();
  return useMutation(
    orpc.avatars.generate.mutationOptions({
      onSuccess: () => {
        void queryClient.invalidateQueries({ queryKey: orpc.avatars.key() });
        void queryClient.invalidateQueries({ queryKey: orpc.matches.key() });
      },
    }),
  );
}

/** Every character this player owns, with effective stats. */
export function useMyAvatars(enabled: boolean) {
  return useQuery(orpc.avatars.list.queryOptions({ enabled, staleTime: 15_000 }));
}

/**
 * Summon a creature from a description. Left unpersisted this writes nothing —
 * "Generate" and "Regenerate" only look at what the parser produced — so no
 * cache needs invalidating unless the call actually saved a row.
 */
export function useGenerateFromDescription() {
  const queryClient = useQueryClient();
  return useMutation(
    orpc.avatars.generateFromDescription.mutationOptions({
      onSuccess: (result) => {
        if (!result.saved) return;
        void queryClient.invalidateQueries({ queryKey: orpc.avatars.key() });
        void queryClient.invalidateQueries({ queryKey: orpc.matches.key() });
      },
    }),
  );
}

/**
 * Re-train a saved character into another creature category.
 *
 * This rewrites the stored body, the stats and the moveset, so everything that
 * reads a character is stale afterwards: the avatar rows the lab and the roster
 * draw from, the match list that shows each fighter's moves, and the booster
 * views whose bonuses are quoted against the new base stats.
 */
export function useSetAvatarCategory() {
  const queryClient = useQueryClient();
  return useMutation(
    orpc.avatars.setCategory.mutationOptions({
      onSuccess: () => {
        void queryClient.invalidateQueries({ queryKey: orpc.avatars.key() });
        void queryClient.invalidateQueries({ queryKey: orpc.matches.key() });
        void queryClient.invalidateQueries({ queryKey: orpc.boosters.key() });
      },
    }),
  );
}

/**
 * Free an avatar slot. The server blocks this while the avatar is in an active
 * match, so the caller surfaces the error rather than pre-checking it here.
 */
export function useReleaseAvatar() {
  const queryClient = useQueryClient();
  return useMutation(
    orpc.avatars.release.mutationOptions({
      onSuccess: () => {
        void queryClient.invalidateQueries({ queryKey: orpc.avatars.key() });
        void queryClient.invalidateQueries({ queryKey: orpc.matches.key() });
        void queryClient.invalidateQueries({ queryKey: orpc.boosters.key() });
      },
    }),
  );
}

/**
 * Ask an avatar for a line. Deliberately not invalidating anything: speech is
 * fire-and-forget flavour, and a failed line must never disturb the HUD or
 * retry into a second charge on the model.
 */
export function useSpeakAvatar() {
  return useMutation(orpc.avatars.speak.mutationOptions({ retry: false }));
}

/**
 * Effective stats for one avatar — base plus every equipped booster, each with
 * its own instance level. This is where the client learns how levelled the
 * loadout is, which drives animation intensity in the AR scene.
 */
export function useAvatarLoadout(avatarId: string | null) {
  return useQuery(
    orpc.avatars.get.queryOptions({
      input: { avatarId: avatarId ?? "" },
      enabled: Boolean(avatarId),
      staleTime: 15_000,
    }),
  );
}

/* ---------------------------------------------------------------- boosters */

export function useBoosterInventory(enabled: boolean) {
  return useQuery(orpc.boosters.inventory.queryOptions({ enabled, staleTime: 15_000 }));
}

export function useBoosterPacks(enabled: boolean) {
  return useQuery(orpc.boosters.packs.queryOptions({ enabled, staleTime: 10 * 60_000 }));
}

export function useBoosterLimits(enabled: boolean) {
  return useQuery(orpc.boosters.limits.queryOptions({ enabled, staleTime: 10 * 60_000 }));
}

/** Buy and open a pack. Mints several instances, so inventory and wallet move. */
export function useBuyPack() {
  const queryClient = useQueryClient();
  return useMutation(
    orpc.boosters.buyPack.mutationOptions({
      onSuccess: () => {
        void queryClient.invalidateQueries({ queryKey: orpc.boosters.key() });
        void queryClient.invalidateQueries({ queryKey: orpc.players.key() });
      },
    }),
  );
}

export function useEquipBooster() {
  const queryClient = useQueryClient();
  return useMutation(
    orpc.boosters.equip.mutationOptions({
      onSuccess: () => {
        void queryClient.invalidateQueries({ queryKey: orpc.boosters.key() });
        void queryClient.invalidateQueries({ queryKey: orpc.avatars.key() });
      },
    }),
  );
}

export function useUnequipBooster() {
  const queryClient = useQueryClient();
  return useMutation(
    orpc.boosters.unequip.mutationOptions({
      onSuccess: () => {
        void queryClient.invalidateQueries({ queryKey: orpc.boosters.key() });
        void queryClient.invalidateQueries({ queryKey: orpc.avatars.key() });
      },
    }),
  );
}

/* ----------------------------------------------------------------- battle */

export function useBattleConfig(enabled: boolean) {
  return useQuery(orpc.battle.config.queryOptions({ enabled, staleTime: 5 * 60_000 }));
}

export function useMatch(matchId: string | null, intervalMs = 5_000) {
  return useQuery(
    orpc.matches.get.queryOptions({
      input: { matchId: matchId ?? "" },
      enabled: Boolean(matchId),
      refetchInterval: intervalMs,
    }),
  );
}

/** The player's own combat state — health and the two cooldowns. */
export function useMyBattleState(matchId: string | null, intervalMs = 2_000) {
  return useQuery(
    orpc.battle.myState.queryOptions({
      input: { matchId: matchId ?? "" },
      enabled: Boolean(matchId),
      refetchInterval: intervalMs,
      retry: false,
    }),
  );
}

/**
 * The player's own match history, newest first. The client reads it for one
 * reason: a reload must not drop a player out of a match they are still
 * standing in, so the live match id is recovered from here rather than kept
 * only in component state.
 */
export function useMyMatches(enabled: boolean) {
  return useQuery(
    orpc.matches.mine.queryOptions({ input: { limit: 20 }, enabled, staleTime: 10_000 }),
  );
}

export function useQuickMatch() {
  const queryClient = useQueryClient();
  return useMutation(
    orpc.matches.quick.mutationOptions({
      onSuccess: () => queryClient.invalidateQueries({ queryKey: orpc.matches.key() }),
    }),
  );
}

export function useStartMatch() {
  const queryClient = useQueryClient();
  return useMutation(
    orpc.matches.start.mutationOptions({
      onSuccess: () => queryClient.invalidateQueries({ queryKey: orpc.matches.key() }),
    }),
  );
}

export function useLeaveMatch() {
  const queryClient = useQueryClient();
  return useMutation(
    orpc.matches.leave.mutationOptions({
      onSuccess: () => queryClient.invalidateQueries({ queryKey: orpc.matches.key() }),
    }),
  );
}

/**
 * Report the device pose. The response carries the server's own speed
 * derivation, the movement/settle state that gates combat, and a fresh safety
 * verdict — so this one call is also the authoritative answer to "may I fight
 * right now", which is why the client never computes that itself.
 */
export function useUpdatePosition() {
  return useMutation(orpc.battle.updatePosition.mutationOptions({ retry: false }));
}

export function useAttack() {
  const queryClient = useQueryClient();
  return useMutation(
    orpc.battle.attack.mutationOptions({
      retry: false,
      onSuccess: () => queryClient.invalidateQueries({ queryKey: orpc.battle.key() }),
    }),
  );
}

/**
 * Commit a defence against a blow already in the air.
 *
 * The client sends *what* it is guarding with and never *when* — the server
 * stamps the arrival and grades it against the strike time it stamped when the
 * attack committed. So there is no optimistic anything here and no retry: a
 * guard is a moment, and a request replayed a second later is a different
 * moment that the player did not choose.
 */
export function useGuard() {
  const queryClient = useQueryClient();
  return useMutation(
    orpc.battle.guard.mutationOptions({
      retry: false,
      onSettled: () => queryClient.invalidateQueries({ queryKey: orpc.battle.key() }),
    }),
  );
}

export function useUseAbility() {
  const queryClient = useQueryClient();
  return useMutation(
    orpc.battle.useAbility.mutationOptions({
      retry: false,
      onSuccess: () => queryClient.invalidateQueries({ queryKey: orpc.battle.key() }),
    }),
  );
}

/** Presence heartbeat — also what keeps the player's zone assignment fresh. */
export function usePing() {
  return useMutation(orpc.players.ping.mutationOptions({ retry: false }));
}
