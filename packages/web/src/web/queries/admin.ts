import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { client, orpc } from "../lib/api";

/**
 * Admin console data hooks. Every read polls on a short interval — the console
 * is a live view of a running game server — and every write invalidates the
 * whole `admin` namespace, which is cheap at operator scale and keeps counters
 * (currency in circulation, spawn counts, job status) honest after an action.
 */

const LIVE = { refetchInterval: 10_000, staleTime: 5_000 } as const;

function useInvalidateAdmin() {
  const queryClient = useQueryClient();
  return () => queryClient.invalidateQueries({ queryKey: orpc.admin.key() });
}

/* --------------------------------------------------------------------- reads */

export function useOverview() {
  return useQuery(orpc.admin.overview.queryOptions({ ...LIVE }));
}

export function usePlayers(search: string) {
  return useQuery(
    orpc.admin.players.queryOptions({
      input: { search: search.trim() || undefined, limit: 100 },
      staleTime: 5_000,
    }),
  );
}

export function useZones() {
  return useQuery(orpc.admin.zones.queryOptions({ ...LIVE }));
}

export function useMatches(status?: "waiting" | "active" | "finished" | "cancelled") {
  return useQuery(orpc.admin.matches.queryOptions({ input: { status, limit: 40 }, ...LIVE }));
}

export function useBattleLog(matchId: string | null) {
  return useQuery(
    orpc.admin.battleLog.queryOptions({
      input: { matchId: matchId ?? "", limit: 200 },
      enabled: Boolean(matchId),
      refetchInterval: 5_000,
    }),
  );
}

export function useListings() {
  return useQuery(orpc.admin.listings.queryOptions({ input: { limit: 60 }, ...LIVE }));
}

export function useEconomy() {
  return useQuery(orpc.admin.economy.queryOptions({ ...LIVE }));
}

export function useJobs() {
  return useQuery(orpc.admin.jobs.queryOptions({ ...LIVE }));
}

export function useCronHistory() {
  return useQuery(orpc.admin.cronHistory.queryOptions({ input: { limit: 40 }, ...LIVE }));
}

export function useBoosterDefinitions() {
  return useQuery(orpc.admin.boosterDefinitions.queryOptions({ input: { limit: 60 } }));
}

export function useLeaderboardSnapshots() {
  return useQuery(orpc.admin.leaderboardSnapshots.queryOptions({ staleTime: 60_000 }));
}

/* ----------------------------------------------------------------- mutations */

export function useGrantCurrency() {
  const invalidate = useInvalidateAdmin();
  return useMutation(orpc.admin.grantCurrency.mutationOptions({ onSuccess: invalidate }));
}

export function useSetRole() {
  const invalidate = useInvalidateAdmin();
  return useMutation(orpc.admin.setRole.mutationOptions({ onSuccess: invalidate }));
}

export function useGenerateAvatar() {
  const invalidate = useInvalidateAdmin();
  return useMutation(orpc.admin.generateAvatar.mutationOptions({ onSuccess: invalidate }));
}

export function useGenerateBooster() {
  const invalidate = useInvalidateAdmin();
  return useMutation(orpc.admin.generateBooster.mutationOptions({ onSuccess: invalidate }));
}

export function useCreateZone() {
  const queryClient = useQueryClient();
  return useMutation(
    orpc.admin.createZone.mutationOptions({
      // Creating a zone also imports hazards around it, and changes which
      // playground candidates are already covered.
      onSuccess: () => {
        void queryClient.invalidateQueries({ queryKey: orpc.admin.key() });
        void queryClient.invalidateQueries({ queryKey: orpc.safety.key() });
        void queryClient.invalidateQueries({ queryKey: SCOUT_KEY });
      },
    }),
  );
}

export function useUpdateZone() {
  const invalidate = useInvalidateAdmin();
  return useMutation(orpc.admin.updateZone.mutationOptions({ onSuccess: invalidate }));
}

export function useDeleteZone() {
  const invalidate = useInvalidateAdmin();
  return useMutation(orpc.admin.deleteZone.mutationOptions({ onSuccess: invalidate }));
}

export function useSpawnBooster() {
  const invalidate = useInvalidateAdmin();
  return useMutation(orpc.admin.spawnBooster.mutationOptions({ onSuccess: invalidate }));
}

export function useRefreshSpawns() {
  const invalidate = useInvalidateAdmin();
  return useMutation(orpc.admin.refreshSpawns.mutationOptions({ onSuccess: invalidate }));
}

export function useCancelMatch() {
  const invalidate = useInvalidateAdmin();
  return useMutation(orpc.admin.cancelMatch.mutationOptions({ onSuccess: invalidate }));
}

export function useTakedownListing() {
  const invalidate = useInvalidateAdmin();
  return useMutation(orpc.admin.takedownListing.mutationOptions({ onSuccess: invalidate }));
}

export function useRunJob() {
  const invalidate = useInvalidateAdmin();
  return useMutation(orpc.admin.runJob.mutationOptions({ onSuccess: invalidate }));
}

/* -------------------------------------------------------------------- safety */

/**
 * Safety operations live under the `safety` router rather than `admin`, so
 * these invalidate both namespaces — approving a zone changes the zone table
 * the Zones tab reads.
 */
function useInvalidateSafety() {
  const queryClient = useQueryClient();
  return () => {
    void queryClient.invalidateQueries({ queryKey: orpc.safety.key() });
    void queryClient.invalidateQueries({ queryKey: orpc.admin.key() });
    void queryClient.invalidateQueries({ queryKey: orpc.grounds.key() });
  };
}

export function usePendingZones() {
  return useQuery(orpc.safety.pending.queryOptions({ ...LIVE }));
}

export function useHazards() {
  return useQuery(orpc.safety.hazardList.queryOptions({ ...LIVE }));
}

export function useSafetyEvents() {
  return useQuery(orpc.safety.events.queryOptions({ input: { limit: 60 }, ...LIVE }));
}

export function useImportOsm() {
  const invalidate = useInvalidateSafety();
  return useMutation(orpc.safety.importOsm.mutationOptions({ onSuccess: invalidate }));
}

export function useReviewZone() {
  const invalidate = useInvalidateSafety();
  return useMutation(orpc.safety.review.mutationOptions({ onSuccess: invalidate }));
}

export function useCreateHazard() {
  const invalidate = useInvalidateSafety();
  return useMutation(orpc.safety.hazardCreate.mutationOptions({ onSuccess: invalidate }));
}

export function useDeleteHazard() {
  const invalidate = useInvalidateSafety();
  return useMutation(orpc.safety.hazardDelete.mutationOptions({ onSuccess: invalidate }));
}

/* ------------------------------------------------------------ zone planner */

/**
 * Kept outside the `admin` namespace on purpose: every admin write invalidates
 * that namespace, and this one costs a live OpenStreetMap request.
 */
const SCOUT_KEY = ["zone-scout"] as const;

export function useSignupAreas() {
  return useQuery(orpc.admin.signupAreas.queryOptions({ staleTime: 60_000 }));
}

export function usePlaygroundsNear(center: { lat: number; lng: number } | null, radiusM = 1_500) {
  const lat = center ? Number(center.lat.toFixed(4)) : 0;
  const lng = center ? Number(center.lng.toFixed(4)) : 0;
  return useQuery({
    queryKey: [...SCOUT_KEY, lat, lng, radiusM],
    queryFn: () => client.admin.playgroundsNear({ lat, lng, radiusM, includeParks: true }),
    enabled: Boolean(center),
    staleTime: 10 * 60_000,
    retry: 1,
  });
}

export function useMapHazards(center: { lat: number; lng: number } | null, radiusM = 2_000) {
  // Rounded so small pans reuse the cached box instead of refetching.
  const lat = center ? Number(center.lat.toFixed(2)) : 0;
  const lng = center ? Number(center.lng.toFixed(2)) : 0;
  return useQuery(
    orpc.admin.mapHazards.queryOptions({
      input: { lat, lng, radiusM },
      enabled: Boolean(center),
      staleTime: 60_000,
    }),
  );
}
