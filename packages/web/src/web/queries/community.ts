import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { orpc } from "../lib/api";

/**
 * Community + moderation hooks. Every mutation refreshes the whole community
 * tree: the lists are small and a stale friend list after a block is exactly
 * the kind of bug that matters here.
 */

function useRefresh() {
  const queryClient = useQueryClient();
  return () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: orpc.community.key() }),
      queryClient.invalidateQueries({ queryKey: orpc.moderation.key() }),
      queryClient.invalidateQueries({ queryKey: orpc.matches.key() }),
    ]);
}

export function useCommunityAccess(enabled: boolean) {
  return useQuery(orpc.community.access.queryOptions({ enabled, staleTime: 30_000, retry: false }));
}

export function useCompleteSignup() {
  const refresh = useRefresh();
  const queryClient = useQueryClient();
  return useMutation(
    orpc.community.completeSignup.mutationOptions({
      onSuccess: () => {
        void refresh();
        void queryClient.invalidateQueries({ queryKey: orpc.players.key() });
      },
    }),
  );
}

export function useResendParentConsent() {
  const refresh = useRefresh();
  return useMutation(orpc.community.parentConsent.resend.mutationOptions({ onSuccess: () => void refresh() }));
}

/* ------------------------------------------------------------------ friends */

export function useFriends(enabled: boolean) {
  return useQuery(orpc.community.friends.list.queryOptions({ enabled, refetchInterval: 20_000 }));
}
export function useMyInvite(enabled: boolean) {
  return useQuery(orpc.community.friends.invite.queryOptions({ enabled, staleTime: 5 * 60_000 }));
}
export function useRedeemInvite() {
  const refresh = useRefresh();
  return useMutation(orpc.community.friends.redeem.mutationOptions({ onSuccess: () => void refresh() }));
}
export function useRespondFriend() {
  const refresh = useRefresh();
  return useMutation(orpc.community.friends.respond.mutationOptions({ onSuccess: () => void refresh() }));
}
export function useRemoveFriend() {
  const refresh = useRefresh();
  return useMutation(orpc.community.friends.remove.mutationOptions({ onSuccess: () => void refresh() }));
}

/* -------------------------------------------------------------------- teams */

export function useMyTeam(enabled: boolean) {
  return useQuery(orpc.community.teams.mine.queryOptions({ enabled }));
}
export function useCreateTeam() {
  const refresh = useRefresh();
  return useMutation(orpc.community.teams.create.mutationOptions({ onSuccess: () => void refresh() }));
}
export function useJoinTeam() {
  const refresh = useRefresh();
  return useMutation(orpc.community.teams.join.mutationOptions({ onSuccess: () => void refresh() }));
}
export function useLeaveTeam() {
  const refresh = useRefresh();
  return useMutation(orpc.community.teams.leave.mutationOptions({ onSuccess: () => void refresh() }));
}

/* --------------------------------------------------------------------- chat */

export type ChatChannel = { scope: "friend" | "team"; channelId: string };

export function useChatOverview(enabled: boolean) {
  return useQuery(orpc.community.chat.overview.queryOptions({ enabled, refetchInterval: 15_000 }));
}

export function useChatHistory(channel: ChatChannel | null) {
  return useQuery(
    orpc.community.chat.history.queryOptions({
      input: channel ?? { scope: "friend", channelId: "" },
      enabled: Boolean(channel),
      refetchInterval: 5_000,
    }),
  );
}
export function useSendPreset() {
  const refresh = useRefresh();
  return useMutation(orpc.community.chat.preset.mutationOptions({ onSuccess: () => void refresh() }));
}
export function useSendText() {
  const refresh = useRefresh();
  return useMutation(orpc.community.chat.send.mutationOptions({ onSuccess: () => void refresh() }));
}

/* ------------------------------------------------------------------ meetups */

export function useMeetups(enabled: boolean) {
  return useQuery(orpc.community.meetups.upcoming.queryOptions({ input: {}, enabled, refetchInterval: 60_000 }));
}
export function useCreateMeetup() {
  const refresh = useRefresh();
  return useMutation(orpc.community.meetups.create.mutationOptions({ onSuccess: () => void refresh() }));
}
export function useJoinMeetup() {
  const refresh = useRefresh();
  return useMutation(orpc.community.meetups.join.mutationOptions({ onSuccess: () => void refresh() }));
}
export function useLeaveMeetup() {
  const refresh = useRefresh();
  return useMutation(orpc.community.meetups.leave.mutationOptions({ onSuccess: () => void refresh() }));
}
export function useCancelMeetup() {
  const refresh = useRefresh();
  return useMutation(orpc.community.meetups.cancel.mutationOptions({ onSuccess: () => void refresh() }));
}
export function useParkBoard(zoneId: string | null) {
  return useQuery(
    orpc.community.parkBoard.queryOptions({
      input: { zoneId: zoneId ?? "" },
      enabled: Boolean(zoneId),
      staleTime: 60_000,
    }),
  );
}

/* --------------------------------------------------------------- moderation */

export function useReport() {
  const refresh = useRefresh();
  return useMutation(orpc.moderation.report.mutationOptions({ onSuccess: () => void refresh() }));
}
export function useBlock() {
  const refresh = useRefresh();
  return useMutation(orpc.moderation.block.mutationOptions({ onSuccess: () => void refresh() }));
}
export function useUnblock() {
  const refresh = useRefresh();
  return useMutation(orpc.moderation.unblock.mutationOptions({ onSuccess: () => void refresh() }));
}
export function useBlocks(enabled: boolean) {
  return useQuery(orpc.moderation.blocks.queryOptions({ enabled }));
}

/* ------------------------------------------------------------- admin queue */

export function useReportQueue(status: "open" | "actioned" | "dismissed", enabled: boolean) {
  return useQuery(orpc.moderation.queue.queryOptions({ input: { status, limit: 100 }, enabled, refetchInterval: 30_000 }));
}
export function useModerationStats(enabled: boolean) {
  return useQuery(orpc.moderation.stats.queryOptions({ enabled, refetchInterval: 30_000 }));
}
export function useResolveReport() {
  const refresh = useRefresh();
  return useMutation(orpc.moderation.resolve.mutationOptions({ onSuccess: () => void refresh() }));
}
export function useSetModerationState() {
  const refresh = useRefresh();
  return useMutation(orpc.moderation.setState.mutationOptions({ onSuccess: () => void refresh() }));
}
export function usePendingConsents(enabled: boolean) {
  return useQuery(orpc.moderation.pendingConsents.queryOptions({ enabled, refetchInterval: 60_000 }));
}

/* ------------------------------------------------------- public: parent link */

export function useVerifyParentConsent() {
  return useMutation(orpc.community.parentConsent.verify.mutationOptions());
}
export function useRevokeParentConsent() {
  return useMutation(orpc.community.parentConsent.revoke.mutationOptions());
}
