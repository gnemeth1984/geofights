import * as React from "react";
import { Ban, Flag, Loader2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useBlock, useReport } from "@/queries/community";
import { errorText } from "./shared";

/**
 * Report and block, reachable next to every other player the app ever shows.
 *
 * Two taps to report: the flag, then a reason. No typing, no confirmation
 * screen — a ten-year-old who has just been sent something nasty should not
 * have to fill in a form. Block is one tap and also takes effect immediately:
 * friend links, team chat lines and matches with that player all disappear.
 */

export const REPORT_REASON_LABEL = {
  bullying: "Mean or bullying",
  sexual: "Sexual or rude",
  personal_info: "Asked for or shared personal info",
  meeting_request: "Asked to meet up privately",
  adult_contact: "I think this is an adult",
  cheating: "Cheating",
  other: "Something else",
} as const;

type Reason = keyof typeof REPORT_REASON_LABEL;
type ReportContext = "chat" | "match" | "profile" | "team" | "meetup";

export function SafetyActions({
  playerId,
  username,
  context,
  refId,
  showBlock = true,
}: {
  playerId: string;
  username: string;
  context: ReportContext;
  refId?: string;
  showBlock?: boolean;
}) {
  const [open, setOpen] = React.useState(false);
  const [done, setDone] = React.useState<string | null>(null);
  const [reported, setReported] = React.useState(false);
  const report = useReport();
  const block = useBlock();
  const error = errorText(report.error ?? block.error);

  if (done) {
    return <span className="text-[11px] text-muted-foreground">{done}</span>;
  }

  return (
    <span className="inline-flex flex-col items-end gap-1">
      <span className="inline-flex items-center gap-1">
        {reported ? (
          <span className="text-[11px] text-muted-foreground">Reported</span>
        ) : (
        <Button
          type="button"
          size="icon-sm"
          variant="ghost"
          aria-label={`Report ${username}`}
          title={`Report ${username}`}
          onClick={() => setOpen((v) => !v)}
        >
          {open ? <X className="size-3.5" /> : <Flag className="size-3.5" />}
        </Button>
        )}
        {showBlock && (
          <Button
            type="button"
            size="icon-sm"
            variant="ghost"
            aria-label={`Block ${username}`}
            title={`Block ${username}`}
            disabled={block.isPending}
            onClick={() =>
              block.mutate({ playerId }, { onSuccess: () => setDone(`${username} blocked.`) })
            }
          >
            {block.isPending ? <Loader2 className="size-3.5 animate-spin" /> : <Ban className="size-3.5" />}
          </Button>
        )}
      </span>
      {open && (
        <span className="flex max-w-64 flex-col gap-1 rounded-md border border-border bg-card p-1.5 shadow-lg">
          <span className="px-1 text-[11px] font-medium text-muted-foreground">Why are you reporting {username}?</span>
          {(Object.keys(REPORT_REASON_LABEL) as Reason[]).map((reason) => (
            <button
              key={reason}
              type="button"
              disabled={report.isPending}
              onClick={() =>
                report.mutate(
                  { subjectId: playerId, reason, context, refId },
                  {
                    onSuccess: () => {
                      setReported(true);
                      setOpen(false);
                    },
                  },
                )
              }
              className="rounded px-2 py-1 text-left text-xs hover:bg-secondary disabled:opacity-50"
            >
              {REPORT_REASON_LABEL[reason]}
            </button>
          ))}
        </span>
      )}
      {error && <span className="max-w-64 text-right text-[11px] text-destructive">{error}</span>}
    </span>
  );
}
