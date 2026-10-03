import * as React from "react";
import { ChevronDown, Gift, Navigation2, Sparkles, Trees, X } from "lucide-react";
import { RarityBadge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { duration } from "@/lib/format";
import { bearingDeg, distanceM, metres, type LatLng } from "@/lib/geo";
import { cn } from "@/lib/utils";
import { useDropAllowance } from "@/queries/play";

/**
 * Free personal drops, from the player's side.
 *
 * The server already drops an upgrade inside a reviewed park for a player who
 * is near one (a few a day, with a gap between). This is what makes that
 * visible: how many are left today, when the next one can land, where the ones
 * waiting are, and which park to head for when there are none yet.
 *
 * Directions are compass bearings from where the player stands — never a map,
 * and never anyone else's position.
 */

export type DropSpawn = {
  id: string;
  lat: number;
  lng: number;
  personal?: boolean;
  distanceM: number;
  inRange: boolean;
  zoneName: string | null;
  expiresAt: Date | string;
  booster: { name: string; rarity: string };
};

type Zone = { name: string; centerLat: number; centerLng: number; radiusM: number } | null;

/** Further than this, the "nearest park" is not a walk — it is the fallback zone. */
const WALKABLE_M = 50_000;
const SEEN_KEY = "gf.seenDrops";
const CARDINALS = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"] as const;

function cardinal(deg: number) {
  return CARDINALS[Math.round(deg / 45) % 8]!;
}

function useNow(intervalMs: number) {
  const [now, setNow] = React.useState(() => Date.now());
  React.useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(timer);
  }, [intervalMs]);
  return now;
}

function personalDrops(spawns: DropSpawn[] | undefined) {
  return (spawns ?? []).filter((s) => s.personal).sort((a, b) => a.distanceM - b.distanceM);
}

/** Bring the pickup sheet into view: it sits above the drawer, which may be scrolled. */
function revealCollectSheet() {
  requestAnimationFrame(() =>
    document.getElementById("collect-sheet")?.scrollIntoView({ behavior: "smooth", block: "center" }),
  );
}

function Direction({ from, to }: { from: LatLng | null; to: LatLng }) {
  if (!from) return null;
  const deg = bearingDeg(from, to);
  return (
    <span className="inline-flex items-center gap-0.5" title="Compass direction, north-up">
      <Navigation2 className="size-3 text-primary" style={{ transform: `rotate(${deg}deg)` }} />
      {cardinal(deg)}
    </span>
  );
}

/* ----------------------------------------------------------------- panel */

export function DropsPanel({
  spawns,
  fix,
  zone,
  signedIn,
  onSelect,
}: {
  spawns: DropSpawn[] | undefined;
  fix: LatLng | null;
  zone: Zone;
  signedIn: boolean;
  onSelect: (spawnId: string) => void;
}) {
  const [open, setOpen] = React.useState(false);
  const allowance = useDropAllowance(signedIn);
  const now = useNow(30_000);
  const waiting = personalDrops(spawns);
  // A new personal drop spends one of today's allowance — refresh the pips now
  // instead of waiting for the next 60s poll.
  const waitingKey = waiting.map((s) => s.id).join(",");
  const refetchAllowance = allowance.refetch;
  React.useEffect(() => {
    if (signedIn && waitingKey) void refetchAllowance();
  }, [signedIn, waitingKey, refetchAllowance]);
  const a = allowance.data;
  const nextAt = a?.nextDropAt ? new Date(a.nextDropAt).getTime() : null;
  const waitMs = nextAt && nextAt > now ? nextAt - now : 0;

  const summary = !signedIn
    ? "sign in for free drops"
    : waiting.length > 0
      ? `${waiting.length} waiting for you`
      : !a
        ? "checking…"
        : waitMs > 0
          ? `next in ${duration(waitMs)}`
          : `${a.remainingToday} left today`;

  return (
    <div className="rounded-lg border border-border bg-background/60">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2 px-3 py-2 text-left"
        aria-expanded={open}
      >
        <Gift className="size-4 text-primary" />
        <span className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">
          Free drops
        </span>
        <span
          className={cn("font-mono text-[11px]", waiting.length > 0 ? "text-primary" : "text-muted-foreground")}
        >
          {summary}
        </span>
        <ChevronDown
          className={cn("ml-auto size-4 text-muted-foreground transition-transform", open && "rotate-180")}
        />
      </button>

      {open && (
        <div className="space-y-3 border-t border-border p-3">
          {!signedIn ? (
            <p className="text-xs text-muted-foreground">
              Create a player and free upgrades start dropping in parks near you.
            </p>
          ) : (
            <>
              {a && <Allowance used={a.usedToday} perDay={a.perDay} waitMs={waitMs} />}
              {waiting.length > 0 ? (
                <ul className="space-y-1.5">
                  {waiting.map((drop) => (
                    <DropRow
                      key={drop.id}
                      drop={drop}
                      fix={fix}
                      now={now}
                      onSelect={() => {
                        onSelect(drop.id);
                        revealCollectSheet();
                      }}
                    />
                  ))}
                </ul>
              ) : (
                <NextPark fix={fix} zone={zone} rangeM={a?.rangeM ?? 1_500} ready={Boolean(a && waitMs === 0 && a.remainingToday > 0)} />
              )}
              <p className="text-[11px] leading-relaxed text-muted-foreground">
                Only you can see your drops. They are never put on roads, rail or water — still, look up
                while you walk. Drops fade after about a day.
              </p>
            </>
          )}
        </div>
      )}
    </div>
  );
}

function Allowance({ used, perDay, waitMs }: { used: number; perDay: number; waitMs: number }) {
  const left = Math.max(0, perDay - used);
  return (
    <div className="flex items-center gap-3">
      <div className="flex gap-1" aria-label={`${left} of ${perDay} drops left today`}>
        {Array.from({ length: perDay }, (_, i) => (
          <span
            key={i}
            className={cn(
              "h-2 w-6 rounded-full",
              i < left ? "bg-primary" : "bg-secondary ring-1 ring-inset ring-border",
            )}
          />
        ))}
      </div>
      <span className="font-mono text-[11px] text-muted-foreground">
        {left} of {perDay} left today
        {waitMs > 0 && ` · next in ${duration(waitMs)}`}
      </span>
    </div>
  );
}

function DropRow({
  drop,
  fix,
  now,
  onSelect,
}: {
  drop: DropSpawn;
  fix: LatLng | null;
  now: number;
  onSelect: () => void;
}) {
  const fadesIn = new Date(drop.expiresAt).getTime() - now;
  return (
    <li>
      <button
        type="button"
        onClick={onSelect}
        className={cn(
          "flex w-full items-center gap-2 rounded-md border px-2.5 py-2 text-left transition-colors",
          drop.inRange ? "border-primary/60 bg-primary/10" : "border-border hover:bg-secondary/60",
        )}
      >
        <Sparkles className="size-4 shrink-0 text-primary" />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <span className="truncate text-xs font-medium">{drop.booster.name}</span>
            <RarityBadge rarity={drop.booster.rarity} />
          </div>
          <div className="mt-0.5 flex flex-wrap items-center gap-x-2 font-mono text-[11px] text-muted-foreground">
            {drop.inRange ? (
              <span className="text-primary">in reach — tap to pick up</span>
            ) : (
              <>
                <span>{metres(drop.distanceM)}</span>
                <Direction from={fix} to={drop} />
              </>
            )}
            {drop.zoneName && <span className="truncate">{drop.zoneName}</span>}
            {fadesIn > 0 && fadesIn < 6 * 3_600_000 && <span>fades in {duration(fadesIn)}</span>}
          </div>
        </div>
      </button>
    </li>
  );
}

function NextPark({
  fix,
  zone,
  rangeM,
  ready,
}: {
  fix: LatLng | null;
  zone: Zone;
  rangeM: number;
  ready: boolean;
}) {
  if (!fix) {
    return <p className="text-xs text-muted-foreground">Turn location on to find the parks near you.</p>;
  }
  const centre = zone ? { lat: zone.centerLat, lng: zone.centerLng } : null;
  const toCentre = centre ? distanceM(fix, centre) : Infinity;
  if (!zone || !centre || toCentre > WALKABLE_M) {
    return (
      <p className="text-xs leading-relaxed text-muted-foreground">
        No reviewed parks near you yet. Drops only land in parks, pitches and playgrounds a person has
        checked — more are added all the time.
      </p>
    );
  }
  const toEdge = Math.max(0, toCentre - zone.radiusM);
  const close = toEdge <= rangeM;
  return (
    <div className="flex items-start gap-2 rounded-md border border-border px-2.5 py-2">
      <Trees className="mt-0.5 size-4 shrink-0 text-primary" />
      <div className="text-xs leading-relaxed">
        <div className="font-medium">{zone.name}</div>
        <div className="font-mono text-[11px] text-muted-foreground">
          {toEdge === 0 ? "you're in it" : (
            <>
              {metres(toEdge)} <Direction from={fix} to={centre} />
            </>
          )}
        </div>
        <p className="mt-1 text-muted-foreground">
          {!ready
            ? "Your next drop will land in a park like this one."
            : close
              ? "You're close enough — a drop should land here within a minute."
              : `Get within ${metres(rangeM)} of it and a drop lands inside, just for you.`}
        </p>
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------- banner */

function readSeen(): string[] {
  try {
    const raw = window.localStorage.getItem(SEEN_KEY);
    return raw ? (JSON.parse(raw) as string[]) : [];
  } catch {
    return [];
  }
}

function writeSeen(ids: string[]) {
  try {
    window.localStorage.setItem(SEEN_KEY, JSON.stringify(ids.slice(-30)));
  } catch {
    // Private mode: the banner simply shows again next visit.
  }
}

/** A one-line heads-up when a new personal drop lands. Tapping it opens the pickup. */
export function DropBanner({
  spawns,
  fix,
  onSelect,
}: {
  spawns: DropSpawn[] | undefined;
  fix: LatLng | null;
  onSelect: (spawnId: string) => void;
}) {
  const [seen, setSeen] = React.useState<string[]>(readSeen);
  const fresh = personalDrops(spawns).find((drop) => !seen.includes(drop.id));
  if (!fresh) return null;

  const dismiss = () => {
    const next = [...seen, fresh.id];
    setSeen(next);
    writeSeen(next);
  };

  return (
    <div className="flex items-center gap-2 rounded-md border border-primary/50 bg-background/92 px-3 py-2 backdrop-blur">
      <Gift className="size-4 shrink-0 text-primary" />
      <button
        type="button"
        className="min-w-0 flex-1 text-left text-[11px] leading-snug"
        onClick={() => {
          onSelect(fresh.id);
          dismiss();
          revealCollectSheet();
        }}
      >
        <span className="font-semibold text-primary">Free drop: {fresh.booster.name}</span>
        <span className="block font-mono text-muted-foreground">
          {fresh.inRange ? "in reach" : metres(fresh.distanceM)}{" "}
          {!fresh.inRange && <Direction from={fix} to={fresh} />}
          {fresh.zoneName ? ` · ${fresh.zoneName}` : ""}
        </span>
      </button>
      <Button size="icon" variant="ghost" className="size-6" aria-label="Dismiss" onClick={dismiss}>
        <X className="size-3.5" />
      </Button>
    </div>
  );
}
