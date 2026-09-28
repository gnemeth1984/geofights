import { Clock, Play } from "lucide-react";
import { Badge, StatusBadge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Panel, PanelBody, PanelHeader, PanelTitle } from "@/components/ui/panel";
import { Empty, Table, TBody, THead } from "@/components/ui/table";
import { ErrorNote, Loading } from "@/components/admin/state";
import { useCronHistory, useJobs, useRunJob } from "@/queries/admin";
import { compactJson, dateTime, duration, relative, titleCase } from "@/lib/format";

/**
 * Scheduler control. Jobs are idempotent and derive "due" from the last
 * `cron_run` row, so a manual trigger here is safe and behaves exactly like
 * the scheduled tick (or an external `POST /api/cron/:job`).
 */
export function JobsTab() {
  const jobs = useJobs();
  const history = useCronHistory();
  const run = useRunJob();

  if (jobs.isLoading) return <Loading label="Reading scheduler state" />;
  if (jobs.isError) return <ErrorNote error={jobs.error} />;

  const data = jobs.data;
  if (!data) return null;

  return (
    <div className="space-y-6">
      <Panel>
        <PanelHeader className="flex-wrap items-center justify-between gap-3">
          <PanelTitle className="flex items-center gap-2">
            <Clock className="size-4 text-primary" />
            Jobs
          </PanelTitle>
          <span className="text-xs text-muted-foreground">
            In-process scheduler · also reachable at POST /api/cron/:job with CRON_SECRET
          </span>
        </PanelHeader>
        <Table>
          <THead>
            <tr>
              <th>Job</th>
              <th>What it does</th>
              <th>Every</th>
              <th>Last run</th>
              <th>Status</th>
              <th className="text-right">Trigger</th>
            </tr>
          </THead>
          <TBody>
            {data.jobs.map((job) => (
              <tr key={job.job}>
                <td className="font-medium">
                  {titleCase(job.job)}
                  {job.due ? (
                    <Badge tone="warn" className="ml-2">
                      due
                    </Badge>
                  ) : null}
                </td>
                <td className="max-w-[34ch] text-xs leading-relaxed text-muted-foreground">
                  {job.description}
                </td>
                <td className="tabular text-muted-foreground">{duration(job.intervalMs)}</td>
                <td className="text-muted-foreground">{relative(job.lastRunAt)}</td>
                <td>
                  <StatusBadge status={job.lastStatus} />
                </td>
                <td aria-label="Row actions">
                  <div className="flex justify-end">
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={run.isPending}
                      onClick={() => run.mutate({ job: job.job })}
                      title="Run this job now"
                    >
                      <Play className="size-4" />
                      Run now
                    </Button>
                  </div>
                </td>
              </tr>
            ))}
          </TBody>
        </Table>
        {run.isError ? (
          <PanelBody className="pt-0">
            <ErrorNote error={run.error} />
          </PanelBody>
        ) : null}
      </Panel>

      <Panel>
        <PanelHeader>
          <PanelTitle>Run history</PanelTitle>
        </PanelHeader>
        {history.isLoading ? (
          <PanelBody>
            <Loading label="Reading cron_run" />
          </PanelBody>
        ) : (
          <Table>
            <THead>
              <tr>
                <th>Job</th>
                <th>Trigger</th>
                <th>Status</th>
                <th>Started</th>
                <th>Took</th>
                <th>Detail</th>
              </tr>
            </THead>
            <TBody>
              {(history.data ?? []).length === 0 ? (
                <Empty colSpan={6}>Nothing has run yet.</Empty>
              ) : (
                (history.data ?? []).map((row) => (
                  <tr key={row.id}>
                    <td className="font-medium">{titleCase(row.job)}</td>
                    <td>
                      <Badge tone={row.trigger === "manual" ? "info" : "neutral"}>
                        {row.trigger}
                      </Badge>
                    </td>
                    <td>
                      <StatusBadge status={row.status} />
                    </td>
                    <td className="text-muted-foreground">{dateTime(row.startedAt)}</td>
                    <td className="tabular text-muted-foreground">
                      {row.finishedAt
                        ? duration(
                            new Date(row.finishedAt).getTime() -
                              new Date(row.startedAt).getTime(),
                          )
                        : "—"}
                    </td>
                    <td className="max-w-[32ch] truncate font-mono text-xs text-muted-foreground">
                      {compactJson(row.detail, 70)}
                    </td>
                  </tr>
                ))
              )}
            </TBody>
          </Table>
        )}
      </Panel>
    </div>
  );
}
