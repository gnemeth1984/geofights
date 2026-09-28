import { Activity, Cpu, Radio, Sparkles } from "lucide-react";
import { Panel, PanelBody, PanelHeader, PanelTitle } from "@/components/ui/panel";
import { Badge, StatusBadge } from "@/components/ui/badge";
import { Table, TBody, THead } from "@/components/ui/table";
import { Stat } from "@/components/admin/stat";
import { ErrorNote, Loading } from "@/components/admin/state";
import { useOverview } from "@/queries/admin";
import { compactJson, duration, num, relative, titleCase } from "@/lib/format";

/** System-wide readout: table counts, live activity, AI status, cron health. */
export function OverviewTab() {
  const overview = useOverview();

  if (overview.isLoading) return <Loading label="Reading system state" />;
  if (overview.isError) return <ErrorNote error={overview.error} />;

  const data = overview.data;
  if (!data) return null;
  const stats = data.stats as Record<string, number>;

  return (
    <div className="space-y-6">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Players" value={num(stats.players)} hint="Game profiles" />
        <Stat
          label="Active matches"
          value={num(stats.activeMatches)}
          tone={stats.activeMatches ? "live" : "default"}
          hint={`${num(stats.matches)} total`}
        />
        <Stat
          label="Live spawns"
          value={num(stats.liveSpawns)}
          hint={`${num(stats.zones)} zones`}
        />
        <Stat
          label="Stream subscribers"
          value={num(data.liveSubscribers)}
          tone={data.liveSubscribers ? "live" : "default"}
          hint="SSE clients attached"
        />
        <Stat label="Avatars" value={num(stats.avatars)} hint="AI-generated characters" />
        <Stat
          label="Boosters"
          value={num(stats.boosterInstances)}
          hint={`${num(stats.boosterDefinitions)} definitions`}
        />
        <Stat label="Listings" value={num(stats.listings)} hint="All-time marketplace" />
        <Stat label="Transactions" value={num(stats.transactions)} hint="Currency ledger rows" />
      </div>

      <div className="grid gap-6 lg:grid-cols-[1fr_1.4fr]">
        <Panel>
          <PanelHeader>
            <PanelTitle className="flex items-center gap-2">
              <Cpu className="size-4 text-primary" />
              Services
            </PanelTitle>
          </PanelHeader>
          <PanelBody className="space-y-3 text-sm">
            <Row
              icon={<Sparkles className="size-4" />}
              label="AI content engine"
              value={
                data.aiConfigured ? (
                  <Badge tone="live">connected</Badge>
                ) : (
                  <Badge tone="warn">fallback templates</Badge>
                )
              }
              note={
                data.aiConfigured
                  ? "Names, abilities, taunts and match summaries are model-generated."
                  : "AI_GATEWAY_API_KEY missing — deterministic fallback content is served."
              }
            />
            <Row
              icon={<Radio className="size-4" />}
              label="Realtime bus"
              value={<Badge tone="live">/api/realtime/match/:id</Badge>}
              note="SSE transport, WS-equivalent event contract, durable replay by seq."
            />
            <Row
              icon={<Activity className="size-4" />}
              label="Scheduler"
              value={<Badge tone="live">in-process</Badge>}
              note="Idempotent: due jobs resolve from cron_run, also callable via POST /api/cron/:job."
            />
          </PanelBody>
        </Panel>

        <Panel>
          <PanelHeader>
            <PanelTitle>Scheduled jobs</PanelTitle>
          </PanelHeader>
          <Table>
            <THead>
              <tr>
                <th>Job</th>
                <th>Every</th>
                <th>Last run</th>
                <th>Status</th>
                <th>Detail</th>
              </tr>
            </THead>
            <TBody>
              {data.cron.jobs.map((job) => (
                <tr key={job.job}>
                  <td className="font-medium">
                    {titleCase(job.job)}
                    {job.due ? <Badge tone="warn" className="ml-2">due</Badge> : null}
                  </td>
                  <td className="tabular text-muted-foreground">{duration(job.intervalMs)}</td>
                  <td className="text-muted-foreground">{relative(job.lastRunAt)}</td>
                  <td>
                    <StatusBadge status={job.lastStatus} />
                  </td>
                  <td className="max-w-[22ch] truncate font-mono text-xs text-muted-foreground">
                    {compactJson(job.lastDetail, 60)}
                  </td>
                </tr>
              ))}
            </TBody>
          </Table>
        </Panel>
      </div>
    </div>
  );
}

function Row({
  icon,
  label,
  value,
  note,
}: {
  icon: React.ReactNode;
  label: string;
  value: React.ReactNode;
  note: string;
}) {
  return (
    <div className="border-b border-border/60 pb-3 last:border-0 last:pb-0">
      <div className="flex items-center justify-between gap-3">
        <span className="flex items-center gap-2 font-medium text-muted-foreground">
          {icon}
          {label}
        </span>
        {value}
      </div>
      <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{note}</p>
    </div>
  );
}
