import * as React from "react";
import { Check, Loader2, MapPin } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { AGE_BANDS, AGE_BAND_LABEL, GUARDIAN_REQUIRED, getOneFix, type AgeBand, type GeoFix } from "@/lib/geo";

/**
 * Age band + location, the two things an account cannot exist without.
 *
 * Used by sign-up (before the account is created) and by the finish-sign-up
 * gate (for accounts made before this step existed). The fix is a single read;
 * only 2 decimal places of it — roughly a neighbourhood — are kept server-side.
 */

export type AgeLocation = {
  band: AgeBand | null;
  guardian: boolean;
  parentEmail: string;
  fix: GeoFix | null;
};

export function useAgeLocation(lockedBand?: AgeBand | null) {
  const [state, setState] = React.useState<AgeLocation>({
    band: lockedBand ?? null,
    guardian: false,
    parentEmail: "",
    fix: null,
  });
  const needsGuardian = state.band ? GUARDIAN_REQUIRED.includes(state.band) : false;
  const needsParentEmail = state.band === "under13";
  const emailOk = !needsParentEmail || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(state.parentEmail.trim());
  const ready = Boolean(state.band) && (!needsGuardian || state.guardian) && emailOk && Boolean(state.fix);

  return {
    state,
    setState,
    needsGuardian,
    needsParentEmail,
    ready,
    /** The `community.completeSignup` input, once `ready`. */
    payload: () =>
      state.band && state.fix
        ? {
            ageBand: state.band,
            lat: state.fix.lat,
            lng: state.fix.lng,
            guardianConfirmed: state.guardian,
            parentEmail: needsParentEmail ? state.parentEmail.trim() : undefined,
          }
        : null,
  };
}

export function AgeLocationFields({
  form,
  lockedBand,
}: {
  form: ReturnType<typeof useAgeLocation>;
  lockedBand?: AgeBand | null;
}) {
  const { state, setState, needsGuardian, needsParentEmail } = form;
  const [locating, setLocating] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const locate = async () => {
    if (!state.band) return;
    setLocating(true);
    setError(null);
    try {
      const fix = await getOneFix({ ageBand: state.band, guardianConfirmed: state.guardian });
      setState((s) => ({ ...s, fix }));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not get a position.");
    } finally {
      setLocating(false);
    }
  };

  const canLocate = Boolean(state.band) && (!needsGuardian || state.guardian);

  return (
    <div className="space-y-3">
      <fieldset className="space-y-2">
        <legend className="text-xs font-medium text-muted-foreground">How old is the player?</legend>
        <div className="flex flex-wrap gap-1.5">
          {AGE_BANDS.map((value) => (
            <Button
              key={value}
              type="button"
              size="sm"
              variant={state.band === value ? "default" : "outline"}
              disabled={Boolean(lockedBand) && lockedBand !== value}
              onClick={() => setState((s) => ({ ...s, band: value, guardian: false, fix: null }))}
            >
              {AGE_BAND_LABEL[value]}
            </Button>
          ))}
        </div>
        {lockedBand && (
          <p className="text-[11px] text-muted-foreground">Your age band is set on your account.</p>
        )}
      </fieldset>

      {needsGuardian && (
        <label className="flex cursor-pointer items-start gap-2.5 rounded-md border border-accent/40 bg-accent/10 p-2.5 text-xs leading-relaxed">
          <input
            type="checkbox"
            aria-label="I am the parent or guardian and agree to location sharing"
            checked={state.guardian}
            onChange={(event) => setState((s) => ({ ...s, guardian: event.target.checked }))}
            className="mt-0.5 size-4 accent-[var(--color-primary)]"
          />
          <span>
            <span className="font-medium">I am the parent or guardian</span>, I am here now, and I agree to
            this player sharing their location while they play.
          </span>
        </label>
      )}

      {needsParentEmail && (
        <div className="space-y-1">
          <Input
            type="email"
            placeholder="Parent's email"
            value={state.parentEmail}
            onChange={(event) => setState((s) => ({ ...s, parentEmail: event.target.value }))}
            autoComplete="off"
          />
          <p className="text-[11px] leading-relaxed text-muted-foreground">
            Under 13, a parent confirms by email before friends, chat or fights with other players switch on.
            Solo training works straight away.
          </p>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" size="sm" variant={state.fix ? "secondary" : "outline"} disabled={!canLocate || locating} onClick={() => void locate()}>
          {locating ? <Loader2 className="size-4 animate-spin" /> : state.fix ? <Check className="size-4" /> : <MapPin className="size-4" />}
          {state.fix ? "Location shared" : locating ? "Finding you…" : "Share my location"}
        </Button>
        {!state.fix && (
          <span className="text-[11px] text-muted-foreground">
            {state.band ? "Required — the game is played at parks near you." : "Pick an age band first."}
          </span>
        )}
      </div>
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}
