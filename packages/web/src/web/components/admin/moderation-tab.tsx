import { useState } from "react";
import { Copy, Mail } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Panel, PanelBody, PanelHeader, PanelTitle } from "@/components/ui/panel";
import { Empty, Table, TBody, THead } from "@/components/ui/table";
import { ErrorNote, Loading } from "@/components/admin/state";
import { Stat } from "@/components/admin/stat";
import { PasswordResetsPanel } from "@/components/admin/password-resets-panel";
import {
  useModerationStats,
  usePendingConsents,
  useReportQueue,
  useResolveReport,
  useSetModerationState,
} from "@/queries/community";
import { relative, titleCase } from "@/lib/format";

type Status = "open" | "actioned" | "dismissed";

/**
 * The human half of report → auto-hide. Three distinct reporters in a week
 * hide an account on their own; this is where someone confirms, reverses or
 * escalates that, and where under-13 consent links wait when no email
 * provider is configured.
 */
export function ModerationTab() {
  const stats = useModerationStats(true);
  const [status, setStatus] = useState<Status>("open");
  const queue = useReportQueue(status, true);
  const resolve = useResolveReport();
  const setState = useSetModerationState();

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Open reports" value={stats.data?.openReports ?? "—"} />
        <Stat label="Hidden accounts" value={stats.data?.hidden ?? "—"} />
        <Stat label="Suspended" value={stats.data?.suspended ?? "—"} />
        <Stat
          label="Auto-hide rule"
          value={stats.data ? `${stats.data.autoHideReporters} in ${stats.data.autoHideWindowDays}d` : "—"}
        />
      </div>

      <Panel>
        <PanelHeader>
          <PanelTitle>Reports</PanelTitle>
          <div className="flex gap-1">
            {(["open", "actioned", "dismissed"] as const).map((s) => (
              <Button key={s} size="sm" variant={status === s ? "secondary" : "ghost"} onClick={() => setStatus(s)}>
                {titleCase(s)}
              </Button>
            ))}
          </div>
        </PanelHeader>
        <PanelBody className="space-y-3">
          <ErrorNote error={queue.error ?? resolve.error ?? setState.error} />
          {queue.isLoading ? (
            <Loading />
          ) : (
            <Table>
              <THead>
                <tr>
                  <th>When</th>
                  <th>Subject</th>
                  <th>Reason</th>
                  <th>Detail</th>
                  <th>Reporter</th>
                  {status === "open" && <th>Decision</th>}
                </tr>
              </THead>
              <TBody>
                {queue.data?.length === 0 && <Empty colSpan={6}>No {status} reports.</Empty>}
                {queue.data?.map((r) => (
                  <tr key={r.id}>
                    <td className="whitespace-nowrap font-mono text-xs">{relative(r.createdAt)}</td>
                    <td>
                      <div className="font-medium">{r.subject?.username ?? r.subjectId}</div>
                      <div className="flex flex-wrap gap-1 pt-0.5">
                        {r.subject?.ageBand && <Badge>{r.subject.ageBand}</Badge>}
                        {r.subject && r.subject.moderationState !== "active" && (
                          <Badge tone="bad">{r.subject.moderationState}</Badge>
                        )}
                      </div>
                    </td>
                    <td>
                      <Badge tone="warn">{r.reason.replace(/_/g, " ")}</Badge>
                      {r.context && <div className="pt-0.5 text-[11px] text-muted-foreground">in {r.context}</div>}
                    </td>
                    <td className="max-w-72 text-xs">
                      {r.message && <div className="rounded bg-secondary px-1.5 py-1">“{r.message.body}”</div>}
                      {r.note && <div className="pt-1 text-muted-foreground">{r.note}</div>}
                    </td>
                    <td className="text-xs">{r.reporter?.username ?? r.reporterId}</td>
                    {status === "open" && (
                      <td>
                        <div className="flex flex-wrap gap-1">
                          {(["dismiss", "hide", "suspend", "clear"] as const).map((decision) => (
                            <Button
                              key={decision}
                              size="sm"
                              variant={decision === "suspend" ? "destructive" : "outline"}
                              disabled={resolve.isPending}
                              onClick={() => resolve.mutate({ reportId: r.id, decision })}
                            >
                              {titleCase(decision)}
                            </Button>
                          ))}
                        </div>
                      </td>
                    )}
                  </tr>
                ))}
              </TBody>
            </Table>
          )}
          <p className="text-[11px] text-muted-foreground">
            Dismiss closes the report. Hide takes the account out of matches and community until cleared. Suspend
            locks it. Clear restores an account the auto-hide caught.
          </p>
        </PanelBody>
      </Panel>

      <PendingConsents />
      <PasswordResetsPanel />
    </div>
  );
}

function PendingConsents() {
  const pending = usePendingConsents(true);
  const [copied, setCopied] = useState<string | null>(null);

  return (
    <Panel>
      <PanelHeader>
        <PanelTitle>
          <span className="inline-flex items-center gap-2">
            <Mail className="size-4" /> Waiting on a parent
          </span>
        </PanelTitle>
        <Badge>{pending.data?.length ?? 0}</Badge>
      </PanelHeader>
      <PanelBody className="space-y-3">
        <ErrorNote error={pending.error} />
        <p className="text-xs text-muted-foreground">
          Under-13 accounts stay out of friends, chat and matches until a parent opens their link. When no email
          provider is set (RESEND_API_KEY), nothing is sent — copy the link and send it to the parent's address
          yourself. Never give it to the child.
        </p>
        {pending.isLoading ? (
          <Loading />
        ) : (
          <Table>
            <THead>
              <tr>
                <th>Requested</th>
                <th>Player</th>
                <th>Parent email</th>
                <th>Delivery</th>
                <th>Link</th>
              </tr>
            </THead>
            <TBody>
              {pending.data?.length === 0 && <Empty colSpan={5}>Nobody waiting.</Empty>}
              {pending.data?.map((p) => (
                <tr key={p.id}>
                  <td className="whitespace-nowrap font-mono text-xs">{relative(p.requestedAt)}</td>
                  <td className="font-medium">{p.username}</td>
                  <td className="text-xs">{p.parentEmail}</td>
                  <td>
                    <Badge tone={p.deliveredVia === "manual" ? "warn" : "live"}>{p.deliveredVia ?? "—"}</Badge>
                    {p.deliveryError && <div className="pt-0.5 text-[11px] text-destructive">{p.deliveryError}</div>}
                  </td>
                  <td>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() =>
                        void navigator.clipboard.writeText(p.link).then(() => {
                          setCopied(p.id);
                          window.setTimeout(() => setCopied(null), 1_500);
                        })
                      }
                    >
                      <Copy className="size-3.5" /> {copied === p.id ? "Copied" : "Copy link"}
                    </Button>
                  </td>
                </tr>
              ))}
            </TBody>
          </Table>
        )}
      </PanelBody>
    </Panel>
  );
}
