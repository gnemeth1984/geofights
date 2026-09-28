import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { orpc } from "../lib/api";
import { authClient, forgetSessionToken } from "../lib/auth";
import { rememberSessionToken } from "../lib/session-token";

/**
 * Operator session. The console authenticates with Better Auth email/password
 * (`/api/auth/*`); the cookie it sets is what the oRPC client rides on, so no
 * token plumbing is needed. Whether the signed-in account may use the console
 * is decided server-side by `adminProc` (`player.role === "admin"`).
 */

export function useSession() {
  return authClient.useSession();
}

/**
 * The caller's game profile, which is what carries `role`. The console gates
 * on this rather than on the auth session: an account can be signed in and
 * still not be an operator.
 */
export function useMe(enabled: boolean) {
  return useQuery({
    ...orpc.players.me.queryOptions(),
    enabled,
    retry: false,
  });
}

export function useSignIn() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: { email: string; password: string }) => {
      const { data, error } = await authClient.signIn.email(input);
      if (error) throw new Error(error.message ?? "Sign-in failed");
      // Kept for the no-cookie case — see lib/session-token.ts.
      rememberSessionToken(data);
      return data;
    },
    onSuccess: () => queryClient.invalidateQueries(),
  });
}

export function useSignUp() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: { email: string; password: string; name: string }) => {
      const { data, error } = await authClient.signUp.email(input);
      if (error) throw new Error(error.message ?? "Sign-up failed");
      rememberSessionToken(data);
      return data;
    },
    onSuccess: () => queryClient.invalidateQueries(),
  });
}

export function useSignOut() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      await authClient.signOut();
      // Without this the bearer fallback would keep the session alive.
      forgetSessionToken();
    },
    onSuccess: () => queryClient.clear(),
  });
}
