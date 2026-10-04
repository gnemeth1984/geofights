import { useState } from "react";
import { CheckCircle2, Clock, MapPinPlus, ShieldAlert, X, XCircle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { errorMessage } from "@/lib/format";
import type { GeoFix } from "@/lib/geo";
import { useMySuggestions, useNearbyGrounds, useSuggestGround } from "@/queries/grounds";

/**
 * "Suggest a fighting ground" — the way out of the training area.
 *
 * The player picks a playground or park OpenStreetMap already knows about
 * near them (never a free pin: the server re-reads the place by id and
 * checks it against roads, rail, water and restricted land, then has an AI
 * reviewer read it). Clean on every count, it goes live straight away;
 * otherwise a person looks at it. The player's own position is only used to
 * search — it is never stored with the suggestion.
 */

type Result = NonNullable<ReturnType<typeof useSuggestGround>["data"]>;

const STATUS_LABEL = {
  open: { label: "suggest", tone: "neutral" },
  live: { label: "live", tone: "live" },
  in_review: { label: "in review", tone: "warn" },
  turned_down: { label: "turned down", tone: "bad" },
} as const;

const RESULT_COPY: Record<Result["status"], { title: string; tone: "live" | "warn" | "bad" | "neutral" }> = {
  auto_approved: { title: "It's live", tone: "live" },
  pending: { title: "Sent to a person", tone: "warn" },
  rejected: { title: "Can't use this one", tone: "bad" },
  duplicate: { title: "Already a ground", tone: "neutral" },
};

function formatDistance(m: number) {
  return m < 1_000 ? `${Math.round(m / 10) * 10} m` : `${(m / 1_000).toFixed(1)} km`;
}

export function SuggestGround({ fix }: { fix: GeoFix | null }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="pointer-events-auto inline-flex items-center gap-1.5 rounded-full border border-primary/50 bg-background/75 px-3 py-1 text-[11px] font-medium text-primary backdrop-blur transition-colors hover:bg-primary/15"
      >
        <MapPinPlus className="size-3" />
        Suggest a ground
      </button>
      {open && <SuggestSheet fix={fix} onClose={() => setOpen(false)} />}
    </>
  );
}

function SuggestSheet({ fix, onClose }: { fix: GeoFix | null; onClose: () => void }) {
  const nearby = useNearbyGrounds(fix, true);
  const mine = useMySuggestions(true);
  const suggest = useSuggestGround();
  const [picked, setPicked] = useState<string | null>(null);
  const [note, setNote] = useState("");

  const send = (osmRef: string) => {
    if (!fix) return;
    suggest.mutate(
      { osmRef, lat: fix.lat, lng: fix.lng, note: note.trim() || undefined },
      {
        onSuccess: () => {
          setPicked(null);
          setNote("");
        },
      },
    );
  };

  const left = nearby.data?.suggestionsLeft ?? null;
  const places = nearby.data?.places ?? [];

  return (
    <div className="pointer-events-auto fixed inset-0 z-50 flex items-end justify-center bg-black/55 backdrop-blur-sm sm:items-center">
      <div className="flex max-h-[88dvh] w-full max-w-md flex-col rounded-t-2xl border border-border bg-background sm:rounded-2xl">
        <div className="flex items-start gap-2 border-b border-border p-4">
          <div className="min-w-0 flex-1">
            <h2 className="text-base font-semibold">Suggest a fighting ground</h2>
            <p className="mt-1 text-[12px] leading-snug text-muted-foreground">
              Pick a playground or park near you. We check it against roads, rail, water and restricted land, and
              an AI reviewer reads it. Clean on every count, it goes live straight away. If anything looks off, a
              person checks it first.
            </p>
          </div>
          <Button size="sm" variant="ghost" className="size-8 shrink-0 p-0" onClick={onClose} title="Close">
            <X className="size-4" />
          </Button>
        </div>

        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-4">
          {suggest.data && <ResultCard result={suggest.data} />}
          {suggest.error && (
            <p className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-[12px] text-destructive">
              {errorMessage(suggest.error)}
            </p>
          )}

          {!fix ? (
            <p className="text-[12px] text-muted-foreground">Waiting for your location…</p>
          ) : nearby.isPending ? (
            <p className="text-[12px] text-muted-foreground">Looking for playgrounds and parks near you…</p>
          ) : nearby.error ? (
            <div className="space-y-2">
              <p className="text-[12px] text-destructive">{errorMessage(nearby.error)}</p>
              <Button size="sm" variant="outline" onClick={() => void nearby.refetch()}>
                Try again
              </Button>
            </div>
          ) : places.length === 0 ? (
            <p className="text-[12px] text-muted-foreground">
              OpenStreetMap has no playgrounds or parks within a kilometre of you.
            </p>
          ) : (
            <>
              <div className="flex items-center justify-between text-[11px] text-muted-foreground">
                <span>{places.length} places within 1 km</span>
                {left !== null && <span>{left} of 3 suggestions left today</span>}
              </div>
              <ul className="divide-y divide-border rounded-lg border border-border">
                {places.map((place) => {
                  const badge = STATUS_LABEL[place.status];
                  const isPicked = picked === place.osmRef;
                  return (
                    <li key={place.osmRef} className="p-3">
                      <div className="flex items-center gap-2">
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-[13px] font-medium">{place.name}</p>
                          <p className="text-[11px] text-muted-foreground">
                            {place.kind.replace(/_/g, " ")} · {formatDistance(place.distanceM)}
                          </p>
                        </div>
                        {place.status === "open" ? (
                          <Button
                            size="sm"
                            variant={isPicked ? "outline" : "default"}
                            className="h-7 px-2 text-[11px]"
                            disabled={left === 0 || suggest.isPending}
                            onClick={() => setPicked(isPicked ? null : place.osmRef)}
                          >
                            {isPicked ? "cancel" : "suggest"}
                          </Button>
                        ) : (
                          <Badge tone={badge.tone}>{badge.label}</Badge>
                        )}
                      </div>
                      {isPicked && (
                        <div className="mt-2 space-y-2">
                          <Input
                            value={note}
                            maxLength={200}
                            onChange={(e) => setNote(e.target.value)}
                            placeholder="Anything we should know? (optional)"
                            className="h-8 text-[12px]"
                          />
                          <Button
                            size="sm"
                            className="w-full"
                            disabled={suggest.isPending}
                            onClick={() => send(place.osmRef)}
                          >
                            {suggest.isPending ? "Checking roads, rail and water — up to a minute…" : "Check and suggest"}
                          </Button>
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
            </>
          )}

          {mine.data && mine.data.length > 0 && (
            <div>
              <h3 className="mb-1.5 text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
                Your suggestions
              </h3>
              <ul className="space-y-1.5">
                {mine.data.map((s) => (
                  <li key={s.id} className="rounded-md border border-border px-3 py-2">
                    <div className="flex items-center gap-2">
                      <span className="min-w-0 flex-1 truncate text-[12px] font-medium">{s.name}</span>
                      <Badge tone={RESULT_COPY[s.status].tone}>{s.status.replace("_", " ")}</Badge>
                    </div>
                    {s.summary && <p className="mt-0.5 text-[11px] text-muted-foreground">{s.summary}</p>}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function ResultCard({ result }: { result: Result }) {
  const copy = RESULT_COPY[result.status];
  const Icon =
    result.status === "auto_approved" ? CheckCircle2 : result.status === "pending" ? Clock : result.status === "rejected" ? XCircle : ShieldAlert;
  return (
    <div className="rounded-lg border border-border bg-secondary/40 p-3">
      <div className="flex items-center gap-2">
        <Icon className="size-4 shrink-0" />
        <span className="text-[13px] font-semibold">{copy.title}</span>
        <Badge tone={copy.tone} className="ml-auto">
          {result.name}
        </Badge>
      </div>
      <p className="mt-1 text-[12px] text-muted-foreground">{result.summary}</p>
      {result.checks.length > 0 && (
        <ul className="mt-2 space-y-0.5">
          {result.checks.map((c) => (
            <li key={c.name} className="flex gap-1.5 text-[11px]">
              <span className={c.ok ? "text-primary" : c.major ? "text-destructive" : "text-accent"}>
                {c.ok ? "✓" : "✗"}
              </span>
              <span className="font-medium">{c.name}</span>
              <span className="min-w-0 truncate text-muted-foreground">{c.detail}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
