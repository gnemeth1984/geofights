import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { orpc } from "../lib/api";

/**
 * Player-facing marketplace. Boosters only for now — that is what fights and
 * park drops hand out, and what a winner walks away with to equip or sell.
 */

export function useMarketBrowse(enabled: boolean) {
  return useQuery(
    orpc.marketplace.browse.queryOptions({
      input: { itemType: "booster", sort: "recent", limit: 40 },
      enabled,
      refetchInterval: enabled ? 20_000 : false,
    }),
  );
}

export function useMarketSellable(enabled: boolean) {
  return useQuery(orpc.marketplace.sellable.queryOptions({ enabled, staleTime: 10_000 }));
}

export function useMyListings(enabled: boolean) {
  return useQuery(orpc.marketplace.myListings.queryOptions({ enabled, staleTime: 10_000 }));
}

export function useMarketConfig(enabled: boolean) {
  return useQuery(orpc.marketplace.config.queryOptions({ enabled, staleTime: 10 * 60_000 }));
}

/** Every market write moves items and currency, so it refreshes all of it. */
function useInvalidateMarket() {
  const queryClient = useQueryClient();
  return () => {
    void queryClient.invalidateQueries({ queryKey: orpc.marketplace.key() });
    void queryClient.invalidateQueries({ queryKey: orpc.boosters.key() });
    void queryClient.invalidateQueries({ queryKey: orpc.players.key() });
    void queryClient.invalidateQueries({ queryKey: orpc.avatars.key() });
  };
}

export function useMarketSell() {
  const onSuccess = useInvalidateMarket();
  return useMutation(orpc.marketplace.sell.mutationOptions({ onSuccess }));
}

export function useMarketBuy() {
  const onSuccess = useInvalidateMarket();
  return useMutation(orpc.marketplace.buy.mutationOptions({ onSuccess }));
}

export function useMarketCancel() {
  const onSuccess = useInvalidateMarket();
  return useMutation(orpc.marketplace.cancel.mutationOptions({ onSuccess }));
}
