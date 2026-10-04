import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { orpc } from "../lib/api";

/** Operator: per-channel visits/sign-ups and the 14-day trend. */
export function useLaunchStats() {
  return useQuery(orpc.launch.stats.queryOptions({ refetchInterval: 60_000 }));
}

/** Operator: saved progress on each launch-kit post and chore. */
export function useLaunchItems() {
  return useQuery(orpc.launch.items.queryOptions());
}

export function useSetLaunchItem() {
  const qc = useQueryClient();
  return useMutation(
    orpc.launch.setItem.mutationOptions({
      onSuccess: () => qc.invalidateQueries({ queryKey: orpc.launch.items.key() }),
    }),
  );
}
