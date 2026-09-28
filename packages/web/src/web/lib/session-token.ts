/**
 * Bearer-token fallback for the session.
 *
 * The session is normally a cookie, which is the right thing same-origin. It
 * stops working in two contexts the game actually ships into:
 *
 *   - the app running inside an iframe (the Runable preview), where the cookie
 *     is third-party and silently dropped;
 *   - iOS Safari and any browser set to block third-party cookies, where the
 *     same thing happens without a visible error.
 *
 * In both, sign-in "succeeds" — the POST returns 200 with a user — and then
 * every authenticated call after it comes back unauthenticated, which reads to
 * a player as "I made an account but I cannot log in".
 *
 * The server already runs better-auth's `bearer()` plugin, so it hands us a
 * `set-auth-token` header on sign-in/sign-up. We keep that token here and send
 * it as `Authorization: Bearer …` on every request — auth calls and oRPC alike.
 * When cookies do work this is simply redundant; the server prefers whichever
 * credential is valid.
 */

const KEY = "geofights.session.token";

export function readSessionToken(): string | null {
  try {
    return localStorage.getItem(KEY);
  } catch {
    // Private mode with storage disabled: we fall back to cookies only.
    return null;
  }
}

export function writeSessionToken(token: string) {
  try {
    localStorage.setItem(KEY, token);
  } catch {
    /* ignore — cookie path may still work */
  }
}

export function clearSessionToken() {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}

/** `Authorization` header for the stored token, or nothing when we have none. */
export function authHeaders(): Record<string, string> {
  const token = readSessionToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

/**
 * Picks the token out of an auth response. better-auth sends it in a header;
 * sign-in/sign-up also return it in the body, which is the path that survives
 * a proxy that strips unknown headers.
 */
export function captureSessionToken(response: Response, body?: unknown) {
  const header = response.headers.get("set-auth-token");
  if (header) {
    writeSessionToken(header);
    return;
  }
  rememberSessionToken(body);
}

/**
 * Stores the token out of a sign-in / sign-up result body. This is the reliable
 * path: the client-level response hook does not fire for every better-auth
 * call, but these two always return the token inline.
 */
export function rememberSessionToken(body: unknown) {
  const token = (body as { token?: unknown } | null | undefined)?.token;
  if (typeof token === "string" && token.length > 0) writeSessionToken(token);
}
