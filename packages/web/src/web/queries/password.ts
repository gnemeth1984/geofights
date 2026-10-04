import { useMutation, useQuery } from "@tanstack/react-query";
import { orpc } from "../lib/api";
import { authClient } from "../lib/auth";

/** Asks for a reset link. Always "succeeds" — the server never says whether an email has an account. */
export function useRequestPasswordReset() {
  return useMutation({
    mutationFn: async (email: string) => {
      const { error } = await authClient.requestPasswordReset({
        email,
        redirectTo: `${window.location.origin}/reset-password`,
      });
      if (error) throw new Error(error.message ?? "Couldn't request a reset");
      return true;
    },
  });
}

export function useResetPassword() {
  return useMutation({
    mutationFn: async (input: { token: string; newPassword: string }) => {
      const { error } = await authClient.resetPassword(input);
      if (error?.code === "INVALID_TOKEN" || error?.message === "Invalid token") {
        throw new Error("This reset link is invalid, already used or expired. Ask for a new one.");
      }
      if (error) throw new Error(error.message ?? "Couldn't reset the password");
      return true;
    },
  });
}

/** Operator: open reset links to forward by hand while no email provider is set. */
export function usePasswordResets(enabled: boolean) {
  return useQuery(orpc.moderation.passwordResets.queryOptions({ enabled, refetchInterval: 60_000 }));
}
