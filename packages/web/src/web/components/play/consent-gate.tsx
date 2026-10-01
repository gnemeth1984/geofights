import * as React from "react";
import { MapPin, ShieldCheck, TriangleAlert } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Panel, PanelBody, PanelHeader, PanelTitle } from "@/components/ui/panel";
import { AGE_BANDS, AGE_BAND_LABEL as BAND_LABEL, GUARDIAN_REQUIRED, type AgeBand } from "@/lib/geo";
import { useGeo } from "@/hooks/use-geo";
import { EnvNotice } from "@/components/play/env-notice";
import { primeSfx } from "@/ar/sfx";

/**
 * The location gate. Nothing in the client touches GPS until this screen is
 * answered, and for a player under 16 it will not unlock without a guardian
 * confirming — which is why the age band is asked before the permission, not
 * after. The browser prompt only appears once `grant()` runs.
 *
 * Declining is a first-class path, not a dead end: the player still gets the
 * AR character preview, just nothing that needs to know where they are.
 */

export function ConsentGate({ rules, lockedBand }: { rules?: string[]; lockedBand?: AgeBand | null }) {
  const geo = useGeo();
  // A signed-in player's band is on their account; this device only asks again
  // for the location permission, not for a different age.
  const [band, setBand] = React.useState<AgeBand | null>(lockedBand ?? null);
  const [guardian, setGuardian] = React.useState(false);

  const needsGuardian = band ? GUARDIAN_REQUIRED.includes(band) : false;
  const canGrant = Boolean(band) && (!needsGuardian || guardian);

  return (
    <div className="mx-auto flex min-h-dvh max-w-2xl flex-col justify-center px-4 py-10 sm:px-6">
      <Panel>
        <PanelHeader>
          <PanelTitle>
            <span className="inline-flex items-center gap-2">
              <ShieldCheck className="size-4 text-primary" />
              Before you play
            </span>
          </PanelTitle>
          <Badge tone="warn">location required</Badge>
        </PanelHeader>
        <PanelBody className="space-y-6">
          <p className="text-sm leading-relaxed text-muted-foreground">
            GeoFights puts characters in the real world around you, so it needs your device
            location to know which park you are in, where the boosters are, and how far away
            your opponent is. Your position is used while you play and is never shown to other
            players as an exact point.
          </p>

          <div className="space-y-2">
            <div className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">
              How old is the player?
            </div>
            <div className="flex flex-wrap gap-2">
              {AGE_BANDS.map((value) => (
                <Button
                  key={value}
                  size="sm"
                  variant={band === value ? "default" : "outline"}
                  disabled={Boolean(lockedBand) && lockedBand !== value}
                  onClick={() => {
                    setBand(value);
                    setGuardian(false);
                  }}
                >
                  {BAND_LABEL[value]}
                </Button>
              ))}
            </div>
          </div>

          {needsGuardian && (
            <label className="flex cursor-pointer items-start gap-3 rounded-md border border-accent/40 bg-accent/10 p-3 text-sm">
              <input
                type="checkbox"
                checked={guardian}
                onChange={(event) => setGuardian(event.target.checked)}
                aria-label="I am the parent or guardian of this player and I agree to them sharing their location"
                className="mt-0.5 size-4 accent-[var(--color-primary)]"
              />
              <span>
                <span className="font-medium">I am the parent or guardian</span> of this player,
                I am here now, and I agree to them sharing their location while they play.
              </span>
            </label>
          )}

          {rules && rules.length > 0 && (
            <div className="rounded-md border border-border bg-secondary/40 p-3">
              <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                <TriangleAlert className="size-3.5 text-accent" />
                The rules the game enforces
              </div>
              <ul className="mt-2 space-y-1 text-sm text-muted-foreground">
                {rules.map((rule) => (
                  <li key={rule}>— {rule}</li>
                ))}
              </ul>
            </div>
          )}

          {/*
           * Pre-click warning, and only for the case we can be sure about: an
           * insecure origin refuses location no matter what. Being framed is
           * left alone here — it often works, and the play screen raises it
           * once a real fix attempt actually comes back denied.
           */}
          <EnvNotice />

          <div className="flex flex-wrap gap-3">
            <Button
              disabled={!canGrant}
              onClick={() => {
                // Both buttons open the audio graph on the way through. It is
                // a real tap, which is the only thing a browser accepts as
                // permission to make noise, and it buys the fight the seconds
                // it takes to pull the cue files down before the first swing.
                primeSfx();
                if (band) geo.grant({ ageBand: band, guardianConfirmed: guardian });
              }}
            >
              <MapPin className="size-4" />
              Allow location and play
            </Button>
            <Button
              variant="outline"
              disabled={!band}
              onClick={() => {
                primeSfx();
                if (band) geo.decline(band);
              }}
            >
              Play without location
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            {band
              ? needsGuardian && !guardian
                ? "A guardian has to confirm before location can be turned on."
                : "You can change this later from the play screen."
              : "Pick an age band to continue."}
          </p>
        </PanelBody>
      </Panel>
    </div>
  );
}
