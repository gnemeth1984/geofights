import { ExternalLink, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { envIssue, topLevelUrl } from "@/lib/env-checks";

/**
 * Names the real reason location is unavailable when the page is framed or not
 * on a secure origin, instead of leaving the player with the browser's
 * "User denied Geolocation" — which they cannot act on, having never been
 * asked. For the framed case it offers the one fix that works: open the app as
 * a top-level page.
 */
export function EnvNotice({ geoDenied = false }: { geoDenied?: boolean }) {
  const issue = envIssue({ geoDenied });
  if (!issue) return null;

  return (
    <div className="rounded-md border border-accent/50 bg-accent/10 px-3 py-2 text-[11px] leading-relaxed text-accent">
      <div className="flex items-start gap-2">
        <TriangleAlert className="mt-0.5 size-3.5 shrink-0" />
        <div className="space-y-2">
          <div>
            <span className="font-semibold">{issue.message}</span> {issue.action}
          </div>
          {issue.kind === "framed" && (
            <Button
              size="sm"
              variant="outline"
              className="h-7 text-[11px]"
              onClick={() => window.open(topLevelUrl(), "_blank", "noopener,noreferrer")}
            >
              <ExternalLink className="size-3.5" />
              Open in a new tab
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
