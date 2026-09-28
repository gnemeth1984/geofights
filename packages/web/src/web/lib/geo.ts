/**
 * GPS chokepoint.
 *
 * GeoFights is played by 8–16 year olds, so location is treated as regulated
 * data rather than a device capability: **this file is the only place in the
 * client that is allowed to touch `navigator.geolocation`.** Everything else
 * goes through `useGeo()` (see `hooks/use-geo.tsx`), which cannot produce a fix
 * until a consent record exists here.
 *
 * `scripts/client-smoke.sh` greps the rest of `src/web` for `navigator.geolocation`
 * and fails the build if a second call site appears — the rule is enforced, not
 * just documented.
 *
 * Consent model (COPPA / GDPR-K, strictest reading):
 *   - under 13 and 13–15 both require a guardian to be present and confirm.
 *   - 16+ can consent for themselves.
 *   - Consent is versioned; bumping `CONSENT_VERSION` re-asks everyone.
 *   - Declining is a first-class state, not an error: the client stays usable
 *     in "no-GPS" mode and simply never asks the browser for a fix.
 *
 * Nothing here persists a coordinate. The record holds a decision and an age
 * band; positions live in memory for the length of the session only, and
 * anything shown on screen or written to a log goes through `coarse()` first.
 */

const CONSENT_KEY = "geofights.geo.consent";
export const CONSENT_VERSION = 1;

export const AGE_BANDS = ["under13", "13to15", "16plus"] as const;
export type AgeBand = (typeof AGE_BANDS)[number];

/** Bands that may not consent for themselves. */
export const GUARDIAN_REQUIRED: readonly AgeBand[] = ["under13", "13to15"];

export type GeoConsent = {
  version: number;
  decision: "granted" | "declined";
  ageBand: AgeBand;
  /** A guardian confirmed they are present. Always true for the minor bands. */
  guardianConfirmed: boolean;
  decidedAt: string;
};

export function readConsent(): GeoConsent | null {
  try {
    const raw = localStorage.getItem(CONSENT_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as GeoConsent;
    if (parsed.version !== CONSENT_VERSION) return null;
    if (!AGE_BANDS.includes(parsed.ageBand)) return null;
    if (parsed.decision !== "granted" && parsed.decision !== "declined") return null;
    // A stored "granted" for a minor band without a guardian flag is not
    // trusted — treat it as never asked and ask again.
    if (
      parsed.decision === "granted" &&
      GUARDIAN_REQUIRED.includes(parsed.ageBand) &&
      !parsed.guardianConfirmed
    ) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export function writeConsent(input: {
  decision: "granted" | "declined";
  ageBand: AgeBand;
  guardianConfirmed: boolean;
}): GeoConsent {
  const record: GeoConsent = {
    version: CONSENT_VERSION,
    decision: input.decision,
    ageBand: input.ageBand,
    guardianConfirmed: input.guardianConfirmed,
    decidedAt: new Date().toISOString(),
  };
  try {
    localStorage.setItem(CONSENT_KEY, JSON.stringify(record));
  } catch {
    // Private-mode storage failure: the session still works, we just re-ask.
  }
  return record;
}

export function clearConsent() {
  try {
    localStorage.removeItem(CONSENT_KEY);
  } catch {
    /* ignore */
  }
}

/** Whether a record is sufficient to ask the browser for a position. */
export function consentAllowsGps(consent: GeoConsent | null): boolean {
  if (!consent || consent.decision !== "granted") return false;
  if (GUARDIAN_REQUIRED.includes(consent.ageBand)) return consent.guardianConfirmed;
  return true;
}

/* -------------------------------------------------------------------- fixes */

export type GeoFix = {
  lat: number;
  lng: number;
  accuracyM: number;
  altitude: number | null;
  /** Metres per second — the device's own value, or derived from two fixes. */
  speedMps: number | null;
  /** Degrees clockwise from true north, when the device reports a course. */
  heading: number | null;
  at: number;
};

export type GeoWatchError = {
  code: "denied" | "unavailable" | "timeout" | "unsupported";
  message: string;
};

export type GeoWatchHandlers = {
  onFix: (fix: GeoFix) => void;
  onError: (error: GeoWatchError) => void;
};

/**
 * The single call into the platform geolocation API.
 *
 * Refuses outright without consent — a caller that forgets the gate gets an
 * error callback instead of a silent location read.
 */
export function startGeoWatch(
  consent: GeoConsent | null,
  handlers: GeoWatchHandlers,
): () => void {
  if (!consentAllowsGps(consent)) {
    handlers.onError({ code: "denied", message: "Location consent has not been given." });
    return () => {};
  }
  if (typeof navigator === "undefined" || !navigator.geolocation) {
    handlers.onError({ code: "unsupported", message: "This device has no location sensor." });
    return () => {};
  }

  let previous: GeoFix | null = null;

  const id = navigator.geolocation.watchPosition(
    (position) => {
      const c = position.coords;
      const at = position.timestamp || Date.now();
      const derived = previous ? derivedSpeed(previous, { lat: c.latitude, lng: c.longitude }, at) : null;
      const fix: GeoFix = {
        lat: c.latitude,
        lng: c.longitude,
        accuracyM: c.accuracy ?? 9999,
        altitude: c.altitude ?? null,
        speedMps: Number.isFinite(c.speed ?? NaN) && (c.speed ?? -1) >= 0 ? c.speed! : derived,
        heading: Number.isFinite(c.heading ?? NaN) ? c.heading! : null,
        at,
      };
      previous = fix;
      handlers.onFix(fix);
    },
    (error) => {
      const code =
        error.code === error.PERMISSION_DENIED
          ? "denied"
          : error.code === error.TIMEOUT
            ? "timeout"
            : "unavailable";
      handlers.onError({ code, message: error.message || "Could not get a position." });
    },
    { enableHighAccuracy: true, maximumAge: 2_000, timeout: 20_000 },
  );

  return () => navigator.geolocation.clearWatch(id);
}

function derivedSpeed(from: GeoFix, to: { lat: number; lng: number }, at: number) {
  const seconds = (at - from.at) / 1000;
  if (seconds <= 0.25) return from.speedMps;
  const metres = distanceM(from, to);
  const speed = metres / seconds;
  // A jumpy fix can fake a sprint; clamp to something a human could do.
  return Number.isFinite(speed) ? Math.min(speed, 45) : null;
}

/* --------------------------------------------------------------------- math */

const EARTH_R = 6_371_000;

export type LatLng = { lat: number; lng: number };

const rad = (deg: number) => (deg * Math.PI) / 180;

/** Great-circle distance in metres. */
export function distanceM(a: LatLng, b: LatLng): number {
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_R * Math.asin(Math.min(1, Math.sqrt(s)));
}

/** Initial bearing a → b, degrees clockwise from north. */
export function bearingDeg(a: LatLng, b: LatLng): number {
  const dLng = rad(b.lng - a.lng);
  const y = Math.sin(dLng) * Math.cos(rad(b.lat));
  const x =
    Math.cos(rad(a.lat)) * Math.sin(rad(b.lat)) -
    Math.sin(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.cos(dLng);
  return (((Math.atan2(y, x) * 180) / Math.PI) + 360) % 360;
}

/**
 * Local east/north offset in metres — the world-scale AR anchor math. Accurate
 * to well under a centimetre over the few hundred metres a play area spans.
 */
export function enuOffset(origin: LatLng, point: LatLng): { east: number; north: number } {
  const latScale = 111_132.92 - 559.82 * Math.cos(2 * rad(origin.lat));
  const lngScale = 111_412.84 * Math.cos(rad(origin.lat)) - 93.5 * Math.cos(3 * rad(origin.lat));
  return {
    east: (point.lng - origin.lng) * lngScale,
    north: (point.lat - origin.lat) * latScale,
  };
}

/**
 * Coordinate rounded down to roughly 11 m. Used for anything that leaves the
 * render loop — on-screen readouts, diagnostics — so a child's exact position
 * is never displayed or copied out of the app.
 */
export function coarse(fix: LatLng): LatLng {
  return {
    lat: Math.round(fix.lat * 10_000) / 10_000,
    lng: Math.round(fix.lng * 10_000) / 10_000,
  };
}

export function coarseLabel(fix: LatLng | null | undefined): string {
  if (!fix) return "—";
  const c = coarse(fix);
  return `${c.lat.toFixed(4)}, ${c.lng.toFixed(4)}`;
}

export function metres(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "—";
  return value >= 1_000 ? `${(value / 1_000).toFixed(1)} km` : `${Math.round(value)} m`;
}

export function speedLabel(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "—";
  return `${value.toFixed(1)} m/s`;
}
