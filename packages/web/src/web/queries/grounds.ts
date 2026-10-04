import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { orpc } from "../lib/api";
import type { GeoFix } from "../lib/geo";

/**
 * Player-suggested fighting grounds.
 *
 * The nearby lookup hits OpenStreetMap through the server, so it only runs
 * while the panel is open and its key is rounded to ~100 m — walking around
 * the training area doesn't re-query on every GPS fix.
 */

const round = (v: number) => Math.round(v * 1_000) / 1_000;

export function useNearbyGrounds(fix: GeoFix | null, enabled: boolean) {
  return useQuery(
    orpc.grounds.nearby.queryOptions({
      input: { lat: round(fix?.lat ?? 0), lng: round(fix?.lng ?? 0) },
      enabled: enabled && Boolean(fix),
      staleTime: 10 * 60_000,
      retry: false,
    }),
  );
}

export function useMySuggestions(enabled: boolean) {
  return useQuery(orpc.grounds.mine.queryOptions({ enabled }));
}

export function useSuggestGround() {
  const queryClient = useQueryClient();
  return useMutation(
    orpc.grounds.suggest.mutationOptions({
      onSuccess: (result) => {
        void queryClient.invalidateQueries({ queryKey: orpc.grounds.key() });
        // A ground that went live changes what the play screen resolves to.
        if (result.status === "auto_approved") {
          void queryClient.invalidateQueries({ queryKey: orpc.nature.key() });
          void queryClient.invalidateQueries({ queryKey: orpc.safety.key() });
        }
      },
    }),
  );
}

export function useSuggestionAudit(enabled: boolean) {
  return useQuery(orpc.grounds.audit.queryOptions({ input: { limit: 60 }, enabled }));
}
