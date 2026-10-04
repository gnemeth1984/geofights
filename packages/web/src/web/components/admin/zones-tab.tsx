import { useState } from "react";
import { Loader2, RefreshCw, Trash2, Zap } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/input";
import { Panel, PanelBody, PanelHeader, PanelTitle } from "@/components/ui/panel";
import { Badge } from "@/components/ui/badge";
import { Empty, IdCell, Table, TBody, THead } from "@/components/ui/table";
import { ErrorNote, Loading } from "@/components/admin/state";
import { NewZonePanel } from "@/components/admin/new-zone-panel";
import {
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
  const updateZone = useUpdateZone();
  const deleteZone = useDeleteZone();
  const spawn = useSpawnBooster();
  const refresh = useRefreshSpawns();

  const [spawnRarity, setSpawnRarity] = useState("");

  const rows = zones.data ?? [];

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

      <NewZonePanel zones={rows} />

      {(spawn.error || refresh.error || refresh.data) && (
        <div className="space-y-2">
          <ErrorNote error={spawn.error} />
          <ErrorNote error={refresh.error} />
          {refresh.data ? (
            <p className="text-xs text-primary">
              Spawn refresh: {num(refresh.data.created)} created, {num(refresh.data.purged)} expired purged.
            </p>
          ) : null}
        </div>
      )}
    </div>
  );
}
