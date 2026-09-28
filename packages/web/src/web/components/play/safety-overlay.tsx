import { Ban, Dumbbell, Footprints, MapPin, ShieldCheck, TriangleAlert } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * The safety verdict, rendered verbatim.
 *
 * Every string here comes from the server's `assess()` — the client does not
 * decide, soften or re-word what stops play. At level 2 the overlay covers the
 * scene: it has to be impossible to keep fighting while standing on a road or
 * riding in a car, and the cheapest way to guarantee that is to take the
 * controls off screen.
 *
 * A training zone is deliberately *not* that. It blocks battles and pickups
 * and nothing else, so it gets a banner instead of a cover: the player keeps
 * their character on screen, animated and talking, and can walk out of it.
 */

export type SafetyVerdictKind =
  | "ok"
  | "outside_zone"
  | "training_zone"
  | "hazard"
  | "too_fast"
  | "no_fix";

export type SafetyVerdict = {
  verdict: SafetyVerdictKind;
  allowed: boolean;
  canBattle: boolean;
  canPickup: boolean;
  canExplore: boolean;
  headline: string;
  advice: string;
  zone: { id: string; name: string; distanceM: number } | null;
  hazards: Array<{ name: string; kind: string; distanceM: number; inside: boolean }>;
  speedMps: number | null;
  level: 0 | 1 | 2;
};

const ICON = { 0: ShieldCheck, 1: TriangleAlert, 2: Ban } as const;

export function SafetyStrip({
  verdict,
  pending,
  noFix,
}: {
  verdict: SafetyVerdict | undefined;
  pending: boolean;
  /** No position yet, so there is nothing to assess — say that instead of implying a failure. */
  noFix?: boolean;
}) {
  if (!verdict) {
    return (
      <div className="rounded-md border border-border bg-background/80 px-3 py-2 text-xs text-muted-foreground backdrop-blur">
        {noFix
          ? "Location off — the game needs it to place you in a play area."
          : pending
            ? "Checking where you are…"
            : "Safety check unavailable — play paused."}
      </div>
    );
  }

  const Icon = verdict.verdict === "training_zone" ? Dumbbell : ICON[verdict.level];
  return (
    <div
      className={cn(
        "rounded-md border px-3 py-2 text-xs backdrop-blur",
        verdict.level === 0 && "border-primary/40 bg-primary/10 text-primary",
        verdict.level === 1 && "border-accent/50 bg-accent/15 text-accent",
        verdict.level === 2 && "border-destructive/60 bg-destructive/20 text-destructive",
      )}
    >
      <div className="flex items-center gap-2 font-semibold uppercase tracking-[0.12em]">
        <Icon className="size-3.5" />
        {verdict.headline}
      </div>
      <div className="mt-1 text-[11px] leading-relaxed text-foreground/80">{verdict.advice}</div>
      <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
        <span className="inline-flex items-center gap-1">
          <MapPin className="size-3" />
          {verdict.zone ? verdict.zone.name : "no approved zone"}
        </span>
        <span className="inline-flex items-center gap-1">
          <Footprints className="size-3" />
          {verdict.speedMps == null ? "—" : `${verdict.speedMps.toFixed(1)} m/s`}
        </span>
        {verdict.hazards.length > 0 && (
          <span className="inline-flex items-center gap-1 text-destructive">
            <TriangleAlert className="size-3" />
            {verdict.hazards[0]!.name} {verdict.hazards[0]!.distanceM} m
          </span>
        )}
      </div>
    </div>
  );
}

/** Level 2: covers the scene until the situation clears on its own. */
export function SafetyBlock({ verdict }: { verdict: SafetyVerdict }) {
  return (
    <div className="pointer-events-auto absolute inset-0 z-30 flex flex-col items-center justify-center gap-4 bg-background/92 px-6 text-center backdrop-blur-sm">
      <div className="flex size-16 items-center justify-center rounded-full border border-destructive/60 bg-destructive/15">
        <Ban className="size-8 text-destructive" />
      </div>
      <h2 className="font-display text-2xl font-semibold text-destructive">{verdict.headline}</h2>
      <p className="max-w-sm text-sm leading-relaxed text-muted-foreground">{verdict.advice}</p>
      {verdict.hazards.some((hazard) => hazard.inside) && (
        <p className="max-w-sm text-xs text-destructive">
          You are inside {verdict.hazards.find((hazard) => hazard.inside)!.name}. Move away from
          it to carry on.
        </p>
      )}
      <p className="text-[11px] uppercase tracking-[0.14em] text-muted-foreground">
        Play resumes on its own — keep the phone down until it does
      </p>
    </div>
  );
}

