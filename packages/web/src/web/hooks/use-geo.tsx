import * as React from "react";
import {
  consentAllowsGps,
  clearConsent,
  readConsent,
  startGeoWatch,
  writeConsent,
  type AgeBand,
  type GeoConsent,
  type GeoFix,
  type GeoWatchError,
} from "@/lib/geo";

/**
 * The client's single source of location.
 *
 * Every component that needs a position calls `useGeo()`. The provider is the
 * only caller of `startGeoWatch`, which in turn is the only caller of the
 * browser API — so location access in this app is one funnel with one gate on
 * it, mirroring how the server funnels every safety decision through `assess()`.
 *
 * State machine:
 *   unasked  → no consent record yet; the gate is showing, no sensor touched
 *   declined → the player (or their guardian) said no; GPS features stay off
 *   locating → consent given, waiting on the first fix
 *   live     → fixes arriving
 *   error    → browser denied / no signal; consent may still be granted
 */

export type GeoStatus = "unasked" | "declined" | "locating" | "live" | "error";

type GeoContextValue = {
  status: GeoStatus;
  consent: GeoConsent | null;
  /** Current fix. Null unless `status === "live"`. */
  fix: GeoFix | null;
  /** First fix of the session — the AR world anchor. */
  origin: GeoFix | null;
  error: GeoWatchError | null;
  /** Number of fixes seen, useful for "is the sensor actually alive" UI. */
  fixCount: number;
  grant: (input: { ageBand: AgeBand; guardianConfirmed: boolean }) => void;
  decline: (ageBand: AgeBand) => void;
  /** Forget the decision and stop the watch — the "withdraw consent" path. */
  revoke: () => void;
  /** Restart the watch after a failed fix, keeping the existing consent. */
  retry: () => void;
  /** Re-anchor the AR world on the current fix. */
  resetOrigin: () => void;
};

const GeoContext = React.createContext<GeoContextValue | null>(null);

export function GeoProvider({ children }: { children: React.ReactNode }) {
  const [consent, setConsent] = React.useState<GeoConsent | null>(() => readConsent());
  const [fix, setFix] = React.useState<GeoFix | null>(null);
  const [origin, setOrigin] = React.useState<GeoFix | null>(null);
  const [error, setError] = React.useState<GeoWatchError | null>(null);
  const [fixCount, setFixCount] = React.useState(0);
  // Bumped by `retry` so a dead watch (indoor timeout, transient denial) can be
  // restarted without making the player re-consent.
  const [attempt, setAttempt] = React.useState(0);

  const allowed = consentAllowsGps(consent);

  React.useEffect(() => {
    if (!allowed) {
      setFix(null);
      setOrigin(null);
      return;
    }
    setError(null);
    const stop = startGeoWatch(consent, {
      onFix: (next) => {
        setError(null);
        setFix(next);
        setFixCount((n) => n + 1);
        setOrigin((current) => current ?? next);
      },
      onError: (next) => setError(next),
    });
    return stop;
  }, [allowed, consent, attempt]);

  const value = React.useMemo<GeoContextValue>(() => {
    const status: GeoStatus = !consent
      ? "unasked"
      : consent.decision === "declined"
        ? "declined"
        : fix
          ? "live"
          : error
            ? "error"
            : "locating";

    return {
      status,
      consent,
      fix: status === "live" ? fix : null,
      origin,
      error,
      fixCount,
      grant: (input) =>
        setConsent(
          writeConsent({
            decision: "granted",
            ageBand: input.ageBand,
            guardianConfirmed: input.guardianConfirmed,
          }),
        ),
      decline: (ageBand) =>
        setConsent(writeConsent({ decision: "declined", ageBand, guardianConfirmed: false })),
      revoke: () => {
        clearConsent();
        setConsent(null);
        setFix(null);
        setOrigin(null);
        setError(null);
        setFixCount(0);
      },
      retry: () => {
        setError(null);
        setAttempt((n) => n + 1);
      },
      resetOrigin: () => setOrigin(fix),
    };
  }, [consent, fix, origin, error, fixCount]);

  return <GeoContext.Provider value={value}>{children}</GeoContext.Provider>;
}

export function useGeo(): GeoContextValue {
  const value = React.useContext(GeoContext);
  if (!value) {
    throw new Error("useGeo must be used inside <GeoProvider> — it is the only GPS access point.");
  }
  return value;
}
