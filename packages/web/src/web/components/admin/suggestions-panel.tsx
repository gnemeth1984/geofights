import { useState } from "react";
import { Check, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Panel, PanelBody, PanelHeader, PanelTitle } from "@/components/ui/panel";
import { Badge } from "@/components/ui/badge";
import { ErrorNote, Loading } from "@/components/admin/state";
import { useReviewZone } from "@/queries/admin";
import { useSuggestionAudit } from "@/queries/grounds";
import { num, relative } from "@/lib/format";

/**
 * Audit trail for player-suggested grounds. Auto-approved zones go live with
 * no person in the loop, so every one is listed here with the checks that let
 * it through, and the operator can revoke it (or approve a pending one) from
 * the same row.
 */

const STATUS_TONE = {
  auto_approved: "live",
  pending: "warn",
  rejected: "bad",
  duplicate: "neutral",
} as const;

export function SuggestionsPanel() {
  const audit = useSuggestionAudit(true);
  const review = useReviewZone();
  const [open, setOpen] = useState<string | null>(null);
  const rows = audit.data ?? [];
  const live = rows.filter((r) => r.status === "auto_approved" && r.zoneReview === "approved").length;

  return (
    <Panel>
      <PanelHeader>
        <PanelTitle>Player suggestions</PanelTitle>
        <div className="flex gap-1.5">
          <Badge tone={live > 0 ? "live" : undefined}>{num(live)} auto-approved live</Badge>
          <Badge>{num(rows.length)} total</Badge>
        </div>
      </PanelHeader>
      <PanelBody>
        {audit.isLoading ? (
          <Loading label="Loading suggestions" />
        ) : audit.isError ? (
          <ErrorNote error={audit.error} />
        ) : rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No suggestions yet. Players 13 and over can suggest a playground or park from the training area.
          </p>
        ) : (
          <ul className="divide-y divide-border">
            {rows.map((s) => (
              <li key={s.id} className="py-3">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge tone={STATUS_TONE[s.status]}>{s.status.replace("_", " ")}</Badge>
                  <span className="font-medium">{s.name}</span>
                  <span className="text-xs text-muted-foreground">
                    {s.playerName ?? "unknown"} · {s.ageBand ?? "?"} · {relative(s.createdAt)} · {num(s.radiusM)} m
                  </span>
                  <a
                    className="text-xs text-primary underline"
                    href={`https://www.openstreetmap.org/${s.osmRef}`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    {s.osmRef}
                  </a>
                  {s.zoneId && s.zoneReview && s.status !== "duplicate" && (
                    <div className="ml-auto flex items-center gap-1.5">
                      <span className="text-xs text-muted-foreground">zone: {s.zoneReview}</span>
                      {s.zoneReview !== "approved" && (
                        <Button
                          size="sm"
                          disabled={review.isPending}
                          onClick={() => review.mutate({ zoneId: s.zoneId!, review: "approved" })}
                        >
                          <Check className="size-4" />
                          Approve
                        </Button>
                      )}
                      {s.zoneReview !== "rejected" && (
                        <Button
                          size="sm"
                          variant="outline"
                          className="text-destructive"
                          disabled={review.isPending}
                          onClick={() =>
                            review.mutate({
                              zoneId: s.zoneId!,
                              review: "rejected",
                              note: s.status === "auto_approved" ? "Auto-approval revoked by operator." : undefined,
                            })
                          }
                        >
                          <X className="size-4" />
                          {s.zoneReview === "approved" ? "Revoke" : "Reject"}
                        </Button>
                      )}
                    </div>
                  )}
                </div>
                {s.summary && <p className="mt-1 text-xs text-muted-foreground">{s.summary}</p>}
                {s.note && <p className="mt-1 text-xs italic">Note: “{s.note}”</p>}
                {s.checks.length > 0 && (
                  <button
                    type="button"
                    className="mt-1 text-xs text-primary underline"
                    onClick={() => setOpen(open === s.id ? null : s.id)}
                  >
                    {open === s.id ? "hide checks" : `${s.checks.length} checks`}
                  </button>
                )}
                {open === s.id && (
                  <ul className="mt-1 space-y-0.5">
                    {s.checks.map((c) => (
                      <li key={c.name} className="flex gap-1.5 text-xs">
                        <span className={c.ok ? "text-primary" : c.major ? "text-destructive" : "text-accent"}>
                          {c.ok ? "✓" : "✗"}
                        </span>
                        <span className="font-medium">{c.name}</span>
                        <span className="text-muted-foreground">{c.detail}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            ))}
          </ul>
        )}
      </PanelBody>
    </Panel>
  );
}
