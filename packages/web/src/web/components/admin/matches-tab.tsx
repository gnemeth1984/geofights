import { useState } from "react";
import { Ban, Radio } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/input";
import { Panel, PanelBody, PanelHeader, PanelTitle } from "@/components/ui/panel";
import { Badge, StatusBadge } from "@/components/ui/badge";
import { Empty, IdCell, Table, TBody, THead } from "@/components/ui/table";
import { ErrorNote, Loading } from "@/components/admin/state";
import { useBattleLog, useCancelMatch, useMatches } from "@/queries/admin";
import { compactJson, dateTime, relative } from "@/lib/format";

type Status = "waiting" | "active" | "finished" | "cancelled";

/**
 * Match oversight: lobbies and battles with live subscriber counts, plus the
 * authoritative event log for any one match — the same ordered stream clients
 * receive over SSE, read straight from `battle_event`.
 */
export function MatchesTab() {
  const [status, setStatus] = useState<Status | "">("");
  const [selected, setSelected] = useState<string | null>(null);
  const matches = useMatches(status || undefined);
  const cancel = useCancelMatch();
  const log = useBattleLog(selected);

  const rows = matches.data ?? [];

  return (
    <div className="space-y-6">
      <Panel>
        <PanelHeader>
          <PanelTitle>Matches</PanelTitle>
          <Select value={status} onChange={(e) => setStatus(e.target.value as Status | "")}>
            <option value="">all statuses</option>
            <option value="waiting">waiting</option>
            <option value="active">active</option>
            <option value="finished">finished</option>
            <option value="cancelled">cancelled</option>
          </Select>
        </PanelHeader>
        {matches.isLoading ? (
          <PanelBody>
            <Loading label="Loading matches" />
          </PanelBody>
        ) : matches.isError ? (
          <PanelBody>
            <ErrorNote error={matches.error} />
          </PanelBody>
        ) : (
          <Table>
            <THead>
              <tr>
                <th>Match</th>
                <th>Status</th>
                <th>Host</th>
                <th>Players</th>
                <th>Live</th>
                <th>Started</th>
                <th className="text-right">Actions</th>
              </tr>
            </THead>
            <TBody>
              {rows.length === 0 ? (
                <Empty colSpan={7}>No matches recorded yet.</Empty>
              ) : (
                rows.map((match) => (
                  <tr
                    key={match.id}
                    className={selected === match.id ? "bg-primary/10" : undefined}
                  >
                    <td>
                      <IdCell value={match.id} />
                    </td>
                    <td>
                      <StatusBadge status={match.status} />
                    </td>
                    <td>{match.hostUsername ?? "—"}</td>
                    <td className="tabular">
                      {match.players} / {match.maxPlayers}
                    </td>
                    <td>
                      {match.subscribers > 0 ? (
                        <Badge tone="live">
                          <Radio className="size-3" />
                          {match.subscribers}
                        </Badge>
                      ) : (
                        <span className="text-xs text-muted-foreground">—</span>
                      )}
                    </td>
                    <td className="text-muted-foreground">
                      {match.startTime ? dateTime(match.startTime) : relative(match.createdAt)}
                    </td>
                    <td aria-label="Row actions">
                      <div className="flex justify-end gap-1.5">
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => setSelected(match.id)}
                        >
                          Event log
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="text-destructive"
                          disabled={
                            cancel.isPending ||
                            match.status === "finished" ||
                            match.status === "cancelled"
                          }
                          onClick={() => cancel.mutate({ matchId: match.id })}
                          title="Force-close without paying rewards"
                        >
                          <Ban className="size-4" />
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </TBody>
          </Table>
        )}
      </Panel>

      <Panel>
        <PanelHeader>
          <PanelTitle>Battle event log</PanelTitle>
          <span className="font-mono text-xs text-muted-foreground">
            {selected ?? "no match selected"}
          </span>
        </PanelHeader>
        {!selected ? (
          <PanelBody>
            <p className="text-sm text-muted-foreground">
              Pick a match to replay its server-authoritative events in order.
            </p>
          </PanelBody>
        ) : log.isLoading ? (
          <PanelBody>
            <Loading label="Loading events" />
          </PanelBody>
        ) : log.isError ? (
          <PanelBody>
            <ErrorNote error={log.error} />
          </PanelBody>
        ) : (
          <Table>
            <THead>
              <tr>
                <th>Seq</th>
                <th>Event</th>
                <th>Message</th>
                <th>Payload</th>
                <th>At</th>
              </tr>
            </THead>
            <TBody>
              {(log.data ?? []).length === 0 ? (
                <Empty colSpan={5}>No durable events for this match.</Empty>
              ) : (
                (log.data ?? []).map((event) => (
                  <tr key={event.id}>
                    <td className="tabular font-mono text-xs">{event.seq}</td>
                    <td>
                      <Badge tone={event.type === "match_finished" ? "warn" : "info"}>
                        {event.type}
                      </Badge>
                    </td>
                    <td className="max-w-[36ch] text-xs">{event.message ?? "—"}</td>
                    <td className="max-w-[40ch] truncate font-mono text-xs text-muted-foreground">
                      {compactJson(event.payload, 120)}
                    </td>
                    <td className="text-xs text-muted-foreground">{dateTime(event.createdAt)}</td>
                  </tr>
                ))
              )}
            </TBody>
          </Table>
        )}
        <PanelBody className="border-t border-border pt-3">
          <ErrorNote error={cancel.error} />
        </PanelBody>
      </Panel>
    </div>
  );
}
