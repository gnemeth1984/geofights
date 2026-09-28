/**
 * Environment checks for the two things that silently break GeoFights when the
 * app is not a plain top-level HTTPS page.
 *
 * 1. **Framed.** Inside an iframe, `navigator.geolocation` is governed by the
 *    parent's permissions policy. Unless the parent sets
 *    `allow="geolocation; camera; xr-spatial-tracking"`, the call fails with a
 *    permission error no amount of clicking "allow" can fix, because the prompt
 *    never reaches the player. The app preview embeds the page this way.
 * 2. **Insecure context.** Geolocation, camera and WebXR are all secure-context
 *    APIs: they work on https and on localhost, and nowhere else. Opening the
 *    dev server by LAN IP on a phone (http://192.168.x.x) fails for this reason
 *    and reports it as a vague permission error.
 *
 * Both produce the same player-visible symptom — "there is an error with geo
 * location" — so the UI needs to name the real cause instead of showing the
 * browser's message.
 */

export type EnvIssue = {
  kind: "framed" | "insecure";
  message: string;
  /** What the player can actually do about it. */
  action: string;
};

/** True when the page is not the top-level document. */
export function isFramed(): boolean {
  try {
    return window.top !== window.self;
  } catch {
    // A cross-origin parent throws on access, which itself means we are framed.
    return true;
  }
}

/** True when the browser will refuse location/camera regardless of consent. */
export function isInsecureContext(): boolean {
  return typeof window !== "undefined" && window.isSecureContext === false;
}

export type EnvProbe = {
  /**
   * Whether a real geolocation call has already come back denied. Being framed
   * is not on its own a fault: a parent that sets `allow="geolocation"` works
   * fine, and `navigator.permissions.query` reports "granted" in both cases, so
   * the only trustworthy signal is an actual refusal. Without one we stay quiet
   * rather than warn a player whose location is about to work.
   */
  geoDenied?: boolean;
};

/**
 * The blocking environment problem, if there is one. Insecure context is
 * reported first: it cannot be worked around by opening a new tab, so telling
 * someone to do that would be wrong.
 */
export function envIssue(probe: EnvProbe = {}): EnvIssue | null {
  if (isInsecureContext()) {
    return {
      kind: "insecure",
      message:
        "This page is not on a secure connection, so the browser blocks location, camera and AR.",
      action: "Open the app over https (or on localhost) and try again.",
    };
  }
  if (probe.geoDenied && isFramed()) {
    return {
      kind: "framed",
      message:
        "The app is running inside a preview frame, which blocks the location prompt from reaching you.",
      action: "Open it in its own browser tab — location works normally there.",
    };
  }
  return null;
}

/** Current page URL, for the "open in a new tab" escape hatch. */
export function topLevelUrl(): string {
  return window.location.href;
}
