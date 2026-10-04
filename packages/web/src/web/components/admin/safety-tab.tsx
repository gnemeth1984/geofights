import { useState } from "react";
import { Check, Loader2, ShieldAlert, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input, Label, Select } from "@/components/ui/input";
import { Panel, PanelBody, PanelHeader, PanelTitle } from "@/components/ui/panel";
import { Badge } from "@/components/ui/badge";
import { Empty, IdCell, Table, TBody, THead } from "@/components/ui/table";
import { ErrorNote, Loading } from "@/components/admin/state";
import { SuggestionsPanel } from "@/components/admin/suggestions-panel";
import {
  useCreateHazard,
  useDeleteHazard,
  useHazards,
  useImportOsm,
  usePendingZones,
  useReviewZone,
  useSafetyEvents,
} from "@/queries/admin";
import { num, relative } from "@/lib/format";

const HAZARD_KINDS = ["road", "rail", "water", "private", "cliff", "other"] as const;
type HazardKind = (typeof HAZARD_KINDS)[number];

/**
 * Safety review. OpenStreetMap proposes play areas; nothing here is playable
 * until an operator approves it, and a hazard blocks play the moment it lands.
 */
export function SafetyTab() {
  const pending = usePendingZones();
  const hazards = useHazards();
  const events = useSafetyEvents();
  const importOsm = useImportOsm();
  const review = useReviewZone();
  const createHazard = useCreateHazard();
  const deleteHazard = useDeleteHazard();

  const [scan, setScan] = useState({ lat: "", lng: "", radiusM: "1500" });
  const [hazard, setHazard] = useState({
    name: "",
    kind: "road" as HazardKind,
    lat: "",
    lng: "",
    radiusM: "20",
  });

  return (
    <div className="space-y-6">
      <Panel>
        <PanelHeader>
          <PanelTitle>Scan OpenStreetMap</PanelTitle>
        </PanelHeader>
        <PanelBody>
          <form
            className="grid gap-4 md:grid-cols-4"
            onSubmit={(event) => {
              event.preventDefault();
              importOsm.mutate({
                lat: Number(scan.lat),
                lng: Number(scan.lng),
                radiusM: Number(scan.radiusM) || 1500,
              });
            }}
          >
            <Field label="Latitude">
              <Input
                required
                type="number"
                step="any"
                value={scan.lat}
                onChange={(e) => setScan({ ...scan, lat: e.target.value })}
                placeholder="52.3702"
              />
            </Field>
            <Field label="Longitude">
              <Input
                required
                type="number"
                step="any"
                value={scan.lng}
                onChange={(e) => setScan({ ...scan, lng: e.target.value })}
                placeholder="4.8952"
              />
            </Field>
            <Field label="Radius (m)">
              <Input
                type="number"
                min={200}
                max={10000}
                value={scan.radiusM}
                onChange={(e) => setScan({ ...scan, radiusM: e.target.value })}
              />
            </Field>
            <div className="flex items-end">
              <Button type="submit" disabled={importOsm.isPending} className="w-full">
                {importOsm.isPending ? <Loader2 className="size-4 animate-spin" /> : null}
                Scan area
              </Button>
            </div>
          </form>
          <div className="mt-4 space-y-2">
            <ErrorNote error={importOsm.error} />
            {importOsm.data ? (
              <p className="text-xs text-primary">
                {num(importOsm.data.proposed.length)} play areas proposed (awaiting your review),{" "}
                {num(importOsm.data.hazards.length)} hazards added and live.
              </p>
            ) : (
              <p className="text-xs text-muted-foreground">
                Parks, playgrounds and fields arrive as proposals. Roads, railways, water and
                restricted land are inserted as live hazards straight away — a false hazard only
                costs playable ground, a missed one costs more.
              </p>
            )}
          </div>
        </PanelBody>
      </Panel>

      <Panel>
        <PanelHeader>
          <PanelTitle>Play areas awaiting review</PanelTitle>
          <Badge tone={(pending.data?.length ?? 0) > 0 ? "warn" : undefined}>
            {num(pending.data?.length ?? 0)} pending
          </Badge>
        </PanelHeader>
        {pending.isLoading ? (
          <PanelBody>
            <Loading label="Loading proposals" />
          </PanelBody>
        ) : pending.isError ? (
          <PanelBody>
            <ErrorNote error={pending.error} />
          </PanelBody>
        ) : (
          <Table>
            <THead>
              <tr>
                <th>Proposed area</th>
                <th>Center</th>
                <th>Radius</th>
                <th>Source</th>
                <th className="text-right">Decision</th>
              </tr>
            </THead>
            <TBody>
              {(pending.data ?? []).length === 0 ? (
                <Empty colSpan={6}>
                  Nothing waiting. Scan an area above to propose play areas around it.
                </Empty>
              ) : (
                (pending.data ?? []).map((zone) => (
                  <tr key={zone.id}>
                    <td>
                      <div className="font-medium">{zone.name}</div>
                      <div className="text-xs text-muted-foreground">
                        {zone.terrain ?? "unclassified"} · <IdCell value={zone.id} />
                      </div>
                    </td>
                    <td className="tabular font-mono text-xs text-muted-foreground">
                      {zone.centerLat.toFixed(5)}, {zone.centerLng.toFixed(5)}
                      <a
                        className="ml-2 text-primary underline"
                        href={`https://www.openstreetmap.org/?mlat=${zone.centerLat}&mlon=${zone.centerLng}#map=17/${zone.centerLat}/${zone.centerLng}`}
                        target="_blank"
                        rel="noreferrer"
                      >
                        map
                      </a>
                    </td>
                    <td className="tabular">{num(zone.radiusM)} m</td>
                    <td className="font-mono text-xs text-muted-foreground">
                      {zone.osmRef ?? zone.source}
                    </td>
                    <td aria-label="Row actions">
                      <div className="flex justify-end gap-1.5">
                        <Button
                          size="sm"
                          disabled={review.isPending}
                          onClick={() => review.mutate({ zoneId: zone.id, review: "approved" })}
                          title="Make this area playable"
                        >
                          <Check className="size-4" />
                          Approve
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          className="text-destructive"
                          disabled={review.isPending}
                          onClick={() => review.mutate({ zoneId: zone.id, review: "rejected" })}
                        >
                          <X className="size-4" />
                          Reject
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

      <SuggestionsPanel />

      <Panel>
        <PanelHeader>
          <PanelTitle className="flex items-center gap-2">
            <ShieldAlert className="size-4 text-destructive" />
            Live hazards
          </PanelTitle>
          <Badge>
            {num(hazards.data?.length ?? 0)} features ·{" "}
            {num((hazards.data ?? []).reduce((sum, h) => sum + h.points, 0))} points
          </Badge>
        </PanelHeader>
        {hazards.isLoading ? (
          <PanelBody>
            <Loading label="Loading hazards" />
          </PanelBody>
        ) : hazards.isError ? (
          <PanelBody>
            <ErrorNote error={hazards.error} />
          </PanelBody>
        ) : (
          <Table>
            <THead>
              <tr>
                <th>Hazard</th>
                <th>Kind</th>
                <th>Traced</th>
                <th>Center</th>
                <th>Buffer</th>
                <th className="text-right">Actions</th>
              </tr>
            </THead>
            <TBody>
              {(hazards.data ?? []).length === 0 ? (
                <Empty colSpan={5}>
                  No hazards mapped yet. Until one exists, only zone containment is stopping
                  anyone.
                </Empty>
              ) : (
                (hazards.data ?? []).map((row) => (
                  <tr key={row.id}>
                    <td>
                      <div className="font-medium">{row.name}</div>
                      <div className="text-xs text-muted-foreground">
                        {row.source} · <IdCell value={row.id} />
                      </div>
                    </td>
                    <td>
                      <Badge tone="warn">{row.kind}</Badge>
                    </td>
                    <td className="tabular text-xs text-muted-foreground">
                      {row.points > 1 ? `${num(row.points)} points` : "single point"}
                    </td>
                    <td className="tabular font-mono text-xs text-muted-foreground">
                      {row.centerLat.toFixed(5)}, {row.centerLng.toFixed(5)}
                    </td>
                    <td className="tabular">{num(row.radiusM)} m</td>
                    <td aria-label="Row actions">
                      <div className="flex justify-end">
                        <Button
                          size="sm"
                          variant="ghost"
                          className="text-destructive"
                          disabled={deleteHazard.isPending}
                          onClick={() => deleteHazard.mutate({ hazardId: row.id })}
                          title={
                            row.points > 1
                              ? `Remove all ${row.points} points of this hazard`
                              : "Remove this hazard"
                          }
                        >
                          <Trash2 className="size-4" />
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </TBody>
          </Table>
        )}
        <PanelBody>
          <form
            className="grid gap-4 md:grid-cols-5"
            onSubmit={(event) => {
              event.preventDefault();
              createHazard.mutate(
                {
                  name: hazard.name,
                  kind: hazard.kind,
                  lat: Number(hazard.lat),
                  lng: Number(hazard.lng),
                  radiusM: Number(hazard.radiusM) || 20,
                },
                {
                  onSuccess: () =>
                    setHazard({ name: "", kind: "road", lat: "", lng: "", radiusM: "20" }),
                },
              );
            }}
          >
            <Field label="Name">
              <Input
                required
                value={hazard.name}
                onChange={(e) => setHazard({ ...hazard, name: e.target.value })}
                placeholder="Main road crossing"
              />
            </Field>
            <Field label="Kind">
              <Select
                value={hazard.kind}
                onChange={(e) => setHazard({ ...hazard, kind: e.target.value as HazardKind })}
              >
                {HAZARD_KINDS.map((kind) => (
                  <option key={kind} value={kind}>
                    {kind}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Latitude">
              <Input
                required
                type="number"
                step="any"
                value={hazard.lat}
                onChange={(e) => setHazard({ ...hazard, lat: e.target.value })}
              />
            </Field>
            <Field label="Longitude">
              <Input
                required
                type="number"
                step="any"
                value={hazard.lng}
                onChange={(e) => setHazard({ ...hazard, lng: e.target.value })}
              />
            </Field>
            <div className="flex items-end gap-2">
              <Field label="Buffer (m)" className="flex-1">
                <Input
                  type="number"
                  min={5}
                  max={2000}
                  value={hazard.radiusM}
                  onChange={(e) => setHazard({ ...hazard, radiusM: e.target.value })}
                />
              </Field>
              <Button type="submit" disabled={createHazard.isPending}>
                Add
              </Button>
            </div>
          </form>
          <div className="mt-4">
            <ErrorNote error={createHazard.error} />
            <ErrorNote error={deleteHazard.error} />
            <ErrorNote error={review.error} />
          </div>
        </PanelBody>
      </Panel>

      <Panel>
        <PanelHeader>
          <PanelTitle>Recent safety stops</PanelTitle>
        </PanelHeader>
        {events.isLoading ? (
          <PanelBody>
            <Loading label="Loading events" />
          </PanelBody>
        ) : events.isError ? (
          <PanelBody>
            <ErrorNote error={events.error} />
          </PanelBody>
        ) : (
          <Table>
            <THead>
              <tr>
                <th>When</th>
                <th>Player</th>
                <th>Action</th>
                <th>Verdict</th>
                <th>Where</th>
                <th>Speed</th>
              </tr>
            </THead>
            <TBody>
              {(events.data ?? []).length === 0 ? (
                <Empty colSpan={6}>No safety stops recorded.</Empty>
              ) : (
                (events.data ?? []).map((row) => (
                  <tr key={row.event.id}>
                    <td className="text-xs text-muted-foreground">
                      {relative(row.event.createdAt)}
                    </td>
                    <td>{row.username ?? <IdCell value={row.event.playerId} />}</td>
                    <td className="font-mono text-xs">{row.event.kind}</td>
                    <td>
                      <Badge tone={row.event.verdict === "ok" ? "live" : "warn"}>
                        {row.event.verdict}
                      </Badge>
                      {row.event.detail ? (
                        <div className="text-xs text-muted-foreground">{row.event.detail}</div>
                      ) : null}
                    </td>
                    <td className="tabular font-mono text-xs text-muted-foreground">
                      {row.event.lat != null && row.event.lng != null
                        ? `${row.event.lat.toFixed(5)}, ${row.event.lng.toFixed(5)}`
                        : "—"}
                    </td>
                    <td className="tabular">
                      {row.event.speedMps != null ? `${row.event.speedMps.toFixed(1)} m/s` : "—"}
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

function Field({
  label,
  children,
  className,
}: {
  label: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={className}>
      <Label className="mb-1.5 block">{label}</Label>
      {children}
    </div>
  );
}
