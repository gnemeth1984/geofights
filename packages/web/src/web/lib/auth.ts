import { createAuthClient } from "better-auth/react";
import { authHeaders, captureSessionToken, clearSessionToken } from "./session-token";

/**
 * Email + password client.
 *
 * Sessions are cookie-based when the app is top-level and same-origin. Inside
 * an iframe, or on a browser blocking third-party cookies, that cookie is
 * dropped — so every request also carries the bearer token kept in
 * `session-token.ts`, captured from the `set-auth-token` header the server's
 * `bearer()` plugin returns. See that file for the full reasoning.
 */
export const authClient = createAuthClient({
  baseURL: window.location.origin,
  basePath: "/api/auth",
  fetchOptions: {
    headers: authHeaders(),
    onRequest: (context) => {
      const headers = new Headers(context.headers);
      const token = authHeaders().Authorization;
      if (token) headers.set("Authorization", token);
      return { ...context, headers };
    },
    onSuccess: (context) => {
      captureSessionToken(context.response, context.data);
    },
  },
});

/** Sign-out has to drop the fallback token too, or the session comes back. */
export function forgetSessionToken() {
  clearSessionToken();
}
