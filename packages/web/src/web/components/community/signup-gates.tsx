import { ShieldCheck } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Panel, PanelBody, PanelHeader, PanelTitle } from "@/components/ui/panel";
import { ConsentGate } from "@/components/play/consent-gate";
import { AgeLocationFields, useAgeLocation } from "@/components/play/age-location-step";
import { useGeo } from "@/hooks/use-geo";
import { useCommunityAccess, useCompleteSignup } from "@/queries/community";
import { ErrorLine, Muted } from "./shared";

/**
 * The two full-screen gates in front of the arena, in order:
 *
 * 1. Finish sign-up — accounts made before age band + location were required
 *    have neither, and the server will not match them until they do.
 * 2. Device location consent — the band is already on the account, so the
 *    gate is locked to it; this device only asks for the permission.
 */
export function SignupGates({
  signedIn,
  geoUnasked,
  rules,
}: {
  signedIn: boolean;
  geoUnasked: boolean;
  rules?: string[];
}) {
  const access = useCommunityAccess(signedIn);
  if (!signedIn || !access.data) return null;

  if (!access.data.profileComplete) {
    return (
      <div className="absolute inset-0 z-50 overflow-y-auto bg-background/96 backdrop-blur">
        <FinishSignup />
      </div>
    );
  }
  if (geoUnasked) {
    return (
      <div className="absolute inset-0 z-40 overflow-y-auto bg-background/96 backdrop-blur">
        <ConsentGate rules={rules} lockedBand={access.data.ageBand} />
      </div>
    );
  }
  return null;
}

function FinishSignup() {
  const form = useAgeLocation();
  const complete = useCompleteSignup();
  const geo = useGeo();

  const submit = async () => {
    const payload = form.payload();
    if (!form.ready || !payload) return;
    await complete.mutateAsync(payload);
    geo.grant({ ageBand: payload.ageBand, guardianConfirmed: payload.guardianConfirmed });
  };

  return (
    <div className="mx-auto flex min-h-dvh max-w-xl flex-col justify-center px-4 py-10 sm:px-6">
      <Panel>
        <PanelHeader>
          <PanelTitle>
            <span className="inline-flex items-center gap-2">
              <ShieldCheck className="size-4 text-primary" />
              Finish sign-up
            </span>
          </PanelTitle>
          <Badge tone="warn">one time</Badge>
        </PanelHeader>
        <PanelBody className="space-y-4">
          <p className="text-sm leading-relaxed text-muted-foreground">
            GeoFights now keeps adults and under-18s completely apart, and every account needs a home area.
            Tell us the player's age group and share your location once to keep playing.
          </p>
          <AgeLocationFields form={form} />
          <Button className="w-full" disabled={!form.ready || complete.isPending} onClick={() => void submit()}>
            {complete.isPending ? "Saving…" : "Continue"}
          </Button>
          <Muted>
            Only a rough area (about a neighbourhood) is stored. The age group cannot be changed later without
            contacting support.
          </Muted>
          <ErrorLine error={complete.error} />
        </PanelBody>
      </Panel>
    </div>
  );
}
