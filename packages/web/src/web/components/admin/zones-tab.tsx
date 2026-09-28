import { useState } from "react";
import { Loader2, MapPin, RefreshCw, Trash2, Zap } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input, Label, Select } from "@/components/ui/input";
import { Panel, PanelBody, PanelHeader, PanelTitle } from "@/components/ui/panel";
import { Badge } from "@/components/ui/badge";
import { Empty, IdCell, Table, TBody, THead } from "@/components/ui/table";
import { ErrorNote, Loading } from "@/components/admin/state";
import {
  useCreateZone,
  useDeleteZone,
  useRefreshSpawns,
  useSpawnBooster,
  useUpdateZone,
  useZones,
} from "@/queries/admin";
import { RARITIES, type Rarity, num } from "@/lib/format";

/**
 * Nature Exploration control: the GPS zones the daily spawn cron scatters
 * boosters across, plus manual spawning for on-device testing.
 */
export function ZonesTab() {
  const zones = useZones();
  const createZone = useCreateZone();
  const updateZone = useUpdateZone();
  const deleteZone = useDeleteZone();
  const spawn = useSpawnBooster();
  const refresh = useRefreshSpawns();

  const [form, setForm] = useState({
    name: "",
    centerLat: "",
    centerLng: "",
    radiusM: "500",
    spawnWeight: "1",
    terrain: "",
    description: "",
  });
  const [spawnRarity, setSpawnRarity] = useState("");

  const rows = zones.data ?? [];

  function submit(event: React.FormEvent) {
    event.preventDefault();
    createZone.mutate(
      {
        name: form.name,
        centerLat: Number(form.centerLat),
        centerLng: Number(form.centerLng),
        radiusM: Number(form.radiusM) || 500,
        spawnWeight: Number(form.spawnWeight) || 1,
        terrain: form.terrain || undefined,
        description: form.description || undefined,
      },
      {
        onSuccess: () =>
          setForm({
            name: "",
            centerLat: "",
            centerLng: "",
            radiusM: "500",
            spawnWeight: "1",
            terrain: "",
            description: "",
          }),
      },
    );
  }

  return (
    <div className="space-y-6">
      <Panel>
        <PanelHeader>
          <PanelTitle>Zones &amp; live spawns</PanelTitle>
          <div className="flex items-center gap-2">
            <Select value={spawnRarity} onChange={(e) => setSpawnRarity(e.target.value)}>
              <option value="">spawn: roll rarity</option>
              {RARITIES.map((value) => (
                <option key={value} value={value}>
                  spawn: {value}
                </option>
              ))}
            </Select>
            <Button
              variant="outline"
              disabled={refresh.isPending}
              onClick={() => refresh.mutate({})}
            >
              {refresh.isPending ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <RefreshCw className="size-4" />
              )}
              Refresh all spawns
            </Button>
          </div>
        </PanelHeader>
        {zones.isLoading ? (
          <PanelBody>
            <Loading label="Loading zones" />
          </PanelBody>
        ) : zones.isError ? (
          <PanelBody>
            <ErrorNote error={zones.error} />
          </PanelBody>
        ) : (
          <Table>
            <THead>
              <tr>
                <th>Zone</th>
                <th>Center</th>
                <th>Radius</th>
                <th>Weight</th>
                <th>Live spawns</th>
                <th>State</th>
                <th className="text-right">Actions</th>
              </tr>
            </THead>
            <TBody>
              {rows.length === 0 ? (
                <Empty colSpan={7}>
                  No zones yet — create one below, or run the daily spawn job to seed the
                  fallback zone.
                </Empty>
              ) : (
                rows.map((zone) => (
                  <tr key={zone.id}>
                    <td>
                      <div className="font-medium">{zone.name}</div>
                      <div className="text-xs text-muted-foreground">
                        {zone.terrain ?? "unclassified"} · <IdCell value={zone.id} />
                      </div>
                    </td>
                    <td className="tabular font-mono text-xs text-muted-foreground">
                      {zone.centerLat.toFixed(4)}, {zone.centerLng.toFixed(4)}
                    </td>
                    <td className="tabular">{num(zone.radiusM)} m</td>
                    <td className="tabular">×{zone.spawnWeight}</td>
                    <td className="tabular">{num(zone.liveSpawns)}</td>
                    <td>
                      {zone.isActive ? <Badge tone="live">active</Badge> : <Badge>paused</Badge>}
                    </td>
                    <td aria-label="Row actions">
                      <div className="flex justify-end gap-1.5">
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={spawn.isPending}
                          onClick={() =>
                            spawn.mutate({
                              zoneId: zone.id,
                              rarity: spawnRarity ? (spawnRarity as Rarity) : undefined,
                            })
                          }
                          title="Drop one spawn into this zone"
                        >
                          <Zap className="size-4" />
                          Spawn
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={updateZone.isPending}
                          onClick={() =>
                            updateZone.mutate({ zoneId: zone.id, isActive: !zone.isActive })
                          }
                        >
                          {zone.isActive ? "Pause" : "Resume"}
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="text-destructive"
                          disabled={deleteZone.isPending}
                          onClick={() => deleteZone.mutate({ zoneId: zone.id })}
                          title="Delete zone and its spawns"
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
      </Panel>

      <Panel>
        <PanelHeader>
          <PanelTitle className="flex items-center gap-2">
            <MapPin className="size-4 text-primary" />
            New zone
          </PanelTitle>
        </PanelHeader>
        <PanelBody>
          <form onSubmit={submit} className="grid gap-4 md:grid-cols-3">
            <Field label="Name">
              <Input
                required
                minLength={2}
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="Riverside Park"
              />
            </Field>
            <Field label="Center latitude">
              <Input
                required
                type="number"
                step="any"
                value={form.centerLat}
                onChange={(e) => setForm({ ...form, centerLat: e.target.value })}
                placeholder="52.3702"
              />
            </Field>
            <Field label="Center longitude">
              <Input
                required
                type="number"
                step="any"
                value={form.centerLng}
                onChange={(e) => setForm({ ...form, centerLng: e.target.value })}
                placeholder="4.8952"
              />
            </Field>
            <Field label="Radius (m)">
              <Input
                type="number"
                min={50}
                max={20000}
                value={form.radiusM}
                onChange={(e) => setForm({ ...form, radiusM: e.target.value })}
              />
            </Field>
            <Field label="Spawn weight (1–10)">
              <Input
                type="number"
                min={1}
                max={10}
                value={form.spawnWeight}
                onChange={(e) => setForm({ ...form, spawnWeight: e.target.value })}
              />
            </Field>
            <Field label="Terrain">
              <Input
                value={form.terrain}
                onChange={(e) => setForm({ ...form, terrain: e.target.value })}
                placeholder="forest / urban / waterfront"
              />
            </Field>
            <Field label="Description" className="md:col-span-2">
              <Input
                value={form.description}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
                placeholder="Flavour text shown to players near the zone"
              />
            </Field>
            <div className="flex items-end">
              <Button type="submit" disabled={createZone.isPending} className="w-full">
                {createZone.isPending ? <Loader2 className="size-4 animate-spin" /> : null}
                Create zone
              </Button>
            </div>
          </form>
          <div className="mt-4 space-y-2">
            <ErrorNote error={createZone.error} />
            <ErrorNote error={spawn.error} />
            <ErrorNote error={refresh.error} />
            {refresh.data ? (
              <p className="text-xs text-primary">
                Spawn refresh: {num(refresh.data.created)} created,{" "}
                {num(refresh.data.purged)} expired purged.
              </p>
            ) : null}
          </div>
        </PanelBody>
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
