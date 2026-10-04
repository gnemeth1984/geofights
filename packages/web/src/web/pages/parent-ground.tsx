import * as React from "react";
import { Link } from "wouter";
import { Check, MapPin, ShieldCheck, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Panel, PanelBody, PanelHeader, PanelTitle } from "@/components/ui/panel";
import { errorText } from "@/components/community/shared";
import { useParentGround, useParentGroundDecide } from "@/queries/grounds";

/**
 * Where a parent lands to approve their under-13's suggested play area.
 * Opening the link changes nothing (mail scanners prefetch links); the parent
 * has to press a button. The token is the only credential.
 */
export default function ParentGround() {
  const token = React.useMemo(() => new URLSearchParams(window.location.search).get("token") ?? "", []);
  const view = useParentGround(token);
  const decide = useParentGroundDecide();
  const error = errorText(view.error ?? decide.error);
  const data = view.data;

  return (
    <main className="mx-auto flex min-h-dvh max-w-xl flex-col justify-center px-4 py-10">
      <Panel>
        <PanelHeader>
          <PanelTitle>
            <span className="inline-flex items-center gap-2">
              <ShieldCheck className="size-4 text-primary" /> GeoFights · suggested play area
            </span>
          </PanelTitle>
        </PanelHeader>
        <PanelBody className="space-y-4 text-sm leading-relaxed">
          {token.length < 12 ? (
            <p>This link is incomplete. Open it again from the email, or copy the whole address.</p>
          ) : view.isLoading ? (
            <p className="text-muted-foreground">Loading…</p>
          ) : !data ? null : decide.isSuccess ? (
            <p className="flex items-center gap-2 font-medium">
              <Check className="size-4 text-primary" />
              {decide.data.status === "rejected"
                ? `Done — ${data.name} won't be used.`
                : decide.data.status === "auto_approved"
                  ? `Thank you — ${data.name} is now a GeoFights play area.`
                  : `Thank you. One of the automatic checks flagged ${data.name}, so a person on the GeoFights team will look at it before it goes live.`}
            </p>
          ) : !data.open ? (
            <p>This suggestion has already been answered. Nothing else to do.</p>
          ) : (
            <>
              <p>
                <strong>{data.username}</strong> suggested <strong>{data.name}</strong> as a place to play GeoFights.
                It only becomes a play area if you say yes.
              </p>
              <a
                className="inline-flex items-center gap-1.5 text-primary underline"
                href={`https://www.openstreetmap.org/?mlat=${data.lat}&mlon=${data.lng}#map=18/${data.lat}/${data.lng}`}
                target="_blank"
                rel="noreferrer"
              >
                <MapPin className="size-4" /> See where it is on the map
              </a>
              <div className="space-y-1.5 rounded-md border border-border bg-background/50 p-3 text-xs">
                <p className="font-medium">What our automatic checks found</p>
                <ul className="space-y-1">
                  {data.checks.map((c) => (
                    <li key={c.name} className="flex gap-2">
                      {c.ok ? (
                        <Check className="mt-0.5 size-3.5 shrink-0 text-primary" />
                      ) : (
                        <X className="mt-0.5 size-3.5 shrink-0 text-destructive" />
                      )}
                      <span>
                        <span className="font-medium">{c.name}</span>{" "}
                        <span className="text-muted-foreground">— {c.detail}</span>
                      </span>
                    </li>
                  ))}
                </ul>
                <p className="pt-1 text-muted-foreground">
                  A play area is open to every GeoFights player nearby, but adults and under-18s are never matched,
                  friended or chatted together. Roads, rail and water inside it are still blocked while playing.
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button disabled={decide.isPending} onClick={() => decide.mutate({ token, approve: true })}>
                  <Check className="size-4" /> Yes, it's a safe place to play
                </Button>
                <Button
                  variant="outline"
                  disabled={decide.isPending}
                  onClick={() => decide.mutate({ token, approve: false })}
                >
                  No
                </Button>
              </div>
            </>
          )}
          {error && <p className="text-xs text-destructive">{error}</p>}
          <p className="text-[11px] text-muted-foreground">
            <Link href="/" className="underline">
              About GeoFights
            </Link>
          </p>
        </PanelBody>
      </Panel>
    </main>
  );
}
