import { Suspense, lazy, useMemo, useState } from "react";
import { Loader2, LocateFixed, MapPin, Search, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import { Panel, PanelBody, PanelHeader, PanelTitle } from "@/components/ui/panel";
import { Badge } from "@/components/ui/badge";
import { ErrorNote } from "@/components/admin/state";
import type { MapZone } from "@/components/admin/zone-map";
import { useCreateZone, useMapHazards, usePlaygroundsNear, useSignupAreas } from "@/queries/admin";
import { num } from "@/lib/format";

const ZoneMap = lazy(() => import("@/components/admin/zone-map"));

/**
 * New zone, placed on a map. The operator can click the map, or pick one of
 * the OpenStreetMap playgrounds and parks around a sign-up area — which fills
 * the form and links the zone to that feature. Roads, rail and water around
 * it are imported before the zone is created, and anything that already
 * reaches into the circle is reported back, because a manual zone is live the
 * moment it is created.
 */

const EMPTY = {
  name: "",
  centerLat: "",
  centerLng: "",
  radiusM: "150",
  spawnWeight: "1",
  terrain: "",
  description: "",
};
const DUBLIN = { lat: 53.3382, lng: -6.2591 };

export function NewZonePanel({ zones }: { zones: MapZone[] }) {
  const createZone = useCreateZone();
  const areas = useSignupAreas();
  const [form, setForm] = useState(EMPTY);
  const [osmRef, setOsmRef] = useState<string | null>(null);
  const [scout, setScout] = useState<{ lat: number; lng: number } | null>(null);
  const [view, setView] = useState<{ lat: number; lng: number } | null>(null);
  const [focus, setFocus] = useState<{ lat: number; lng: number; zoom: number; key: string } | null>(null);

  // First paint: centre on where most players signed up.
  const top = areas.data?.[0];
  const start = focus ?? (areas.isFetched ? { ...(top ?? DUBLIN), zoom: 14, key: "start" } : null);
  const playgrounds = usePlaygroundsNear(scout, 1_500);
  const hazards = useMapHazards(view ?? start, 2_000);

  const data = playgrounds.data;
  const candidates = useMemo(() => data?.candidates ?? [], [data]);
  const mapCandidates = useMemo(
    () =>
      candidates.map((c) => ({
        osmRef: c.osmRef,
        name: c.name,
        lat: c.lat,
        lng: c.lng,
        suggestedRadiusM: c.suggestedRadiusM,
        existing: Boolean(c.existingZone),
      })),
    [candidates],
  );

  const lat = Number(form.centerLat);
  const lng = Number(form.centerLng);
  const selection =
    form.centerLat && form.centerLng && Number.isFinite(lat) && Number.isFinite(lng)
      ? { lat, lng, radiusM: Number(form.radiusM) || 150 }
      : null;

  const goTo = (p: { lat: number; lng: number }, zoom = 15) =>
    setFocus({ ...p, zoom, key: `${p.lat},${p.lng},${Date.now()}` });

  const pickCandidate = (ref: string) => {
    const c = candidates.find((x) => x.osmRef === ref);
    if (!c) return;
    setOsmRef(c.existingZone ? null : c.osmRef);
    setForm((f) => ({
      ...f,
      name: c.name,
      centerLat: c.lat.toFixed(6),
      centerLng: c.lng.toFixed(6),
      radiusM: String(c.suggestedRadiusM),
      terrain: c.kind,
    }));
  };

  function submit(event: React.FormEvent) {
    event.preventDefault();
    createZone.mutate(
      {
        name: form.name,
        centerLat: lat,
        centerLng: lng,
        radiusM: Number(form.radiusM) || 150,
        spawnWeight: Number(form.spawnWeight) || 1,
        terrain: form.terrain || undefined,
        description: form.description || undefined,
        osmRef: osmRef ?? undefined,
      },
      {
        onSuccess: () => {
          setForm(EMPTY);
          setOsmRef(null);
        },
      },
    );
  }

  const result = createZone.data;
  const overlapKinds = result ? Object.entries(result.hazardScan.overlapKinds) : [];

  return (
    <Panel>
      <PanelHeader>
        <PanelTitle className="flex items-center gap-2">
          <MapPin className="size-4 text-primary" />
          New zone
        </PanelTitle>
        <span className="text-xs text-muted-foreground">
          Click the map or pick a playground. Manual zones go live immediately.
        </span>
      </PanelHeader>
      <PanelBody className="space-y-4">
        <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
          <div className="space-y-2">
            {start ? (
              <Suspense fallback={<MapPlaceholder label="Loading map" />}>
                <ZoneMap
                  focus={start}
                  selection={selection}
                  zones={zones}
                  hazards={hazards.data ?? []}
                  candidates={mapCandidates}
                  onPick={(pLat, pLng) => {
                    setOsmRef(null);
                    setForm((f) => ({ ...f, centerLat: pLat.toFixed(6), centerLng: pLng.toFixed(6) }));
                  }}
                  onPickCandidate={pickCandidate}
                  onViewChange={setView}
                />
              </Suspense>
            ) : (
              <MapPlaceholder label="Finding sign-up areas" />
            )}
            <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              <Button
                size="sm"
                variant="outline"
                disabled={playgrounds.isFetching}
                onClick={() => setScout(view ?? start ?? DUBLIN)}
              >
                {playgrounds.isFetching ? <Loader2 className="size-4 animate-spin" /> : <Search className="size-4" />}
                Find playgrounds here
              </Button>
              <Legend color="#22c55e" label="approved" />
              <Legend color="#f59e0b" label="pending" />
              <Legend color="#38bdf8" label="OSM playground" />
              <Legend color="#ef4444" label="hazard" />
            </div>
          </div>

          <div className="space-y-4">
            <div>
              <Label className="mb-1.5 flex items-center gap-1.5">
                <Users className="size-3.5" /> Near sign-up areas
              </Label>
              {areas.isLoading ? (
                <p className="text-xs text-muted-foreground">Loading…</p>
              ) : (areas.data ?? []).length === 0 ? (
                <p className="text-xs text-muted-foreground">No players with a home area yet.</p>
              ) : (
                <ul className="max-h-40 space-y-1 overflow-y-auto">
                  {(areas.data ?? []).slice(0, 12).map((a) => (
                    <li key={`${a.lat},${a.lng}`}>
                      <button
                        type="button"
                        className="flex w-full items-center gap-2 rounded px-2 py-1 text-left text-xs hover:bg-secondary"
                        onClick={() => {
                          goTo(a, 15);
                          setScout(a);
                        }}
                      >
                        <LocateFixed className="size-3.5 shrink-0 text-primary" />
                        <span className="tabular font-mono">
                          {a.lat.toFixed(2)}, {a.lng.toFixed(2)}
                        </span>
                        <span className="ml-auto text-muted-foreground">
                          {num(a.players)} players{a.minors ? ` · ${num(a.minors)} minors` : ""}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div>
              <Label className="mb-1.5 block">Playgrounds &amp; parks</Label>
              {!scout ? (
                <p className="text-xs text-muted-foreground">Pick a sign-up area or press “Find playgrounds here”.</p>
              ) : playgrounds.isLoading ? (
                <p className="text-xs text-muted-foreground">Asking OpenStreetMap…</p>
              ) : playgrounds.isError ? (
                <ErrorNote error={playgrounds.error} />
              ) : candidates.length === 0 ? (
                <p className="text-xs text-muted-foreground">None mapped within 1.5 km.</p>
              ) : (
                <ul className="max-h-72 divide-y divide-border overflow-y-auto rounded border border-border">
                  {candidates.map((c) => {
                    const hazardKinds = Object.keys(c.hazardsInside);
                    return (
                      <li key={c.osmRef}>
                        <button
                          type="button"
                          className={`w-full px-2 py-1.5 text-left text-xs hover:bg-secondary ${osmRef === c.osmRef ? "bg-secondary" : ""}`}
                          onClick={() => {
                            pickCandidate(c.osmRef);
                            goTo(c, 17);
                          }}
                        >
                          <div className="flex items-center gap-1.5">
                            <span className="min-w-0 flex-1 truncate font-medium">{c.name}</span>
                            {c.existingZone ? (
                              <Badge>{c.existingZone.review}</Badge>
                            ) : hazardKinds.length ? (
                              <Badge tone="warn">{hazardKinds.join(", ")}</Badge>
                            ) : (
                              <Badge tone="live">clear</Badge>
                            )}
                          </div>
                          <div className="text-muted-foreground">
                            {c.kind} · {num(c.distanceM)} m away · r {num(c.suggestedRadiusM)} m
                            {c.hazardsScanned ? "" : " · hazards not scanned yet"}
                          </div>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          </div>
        </div>

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
              onChange={(e) => {
                setOsmRef(null);
                setForm({ ...form, centerLat: e.target.value });
              }}
              placeholder="53.3382"
            />
          </Field>
          <Field label="Center longitude">
            <Input
              required
              type="number"
              step="any"
              value={form.centerLng}
              onChange={(e) => {
                setOsmRef(null);
                setForm({ ...form, centerLng: e.target.value });
              }}
              placeholder="-6.2591"
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
              placeholder="playground / park / waterfront"
            />
          </Field>
          <Field label="Description" className="md:col-span-2">
            <Input
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
              placeholder="Flavour text shown to players near the zone"
            />
          </Field>
          <div className="flex flex-col justify-end gap-1">
            {osmRef && <span className="font-mono text-[11px] text-muted-foreground">linked: {osmRef}</span>}
            <Button type="submit" disabled={createZone.isPending} className="w-full">
              {createZone.isPending ? <Loader2 className="size-4 animate-spin" /> : null}
              {createZone.isPending ? "Scanning hazards…" : "Create zone"}
            </Button>
          </div>
        </form>

        <ErrorNote error={createZone.error} />
        {result && (
          <div
            className={`rounded-md border p-3 text-xs ${overlapKinds.length ? "border-accent/50 bg-accent/10" : "border-primary/40 bg-primary/10"}`}
          >
            <p className="font-medium">
              Created “{result.name}” ({result.review}). Hazard scan: {num(result.hazardScan.waysFound)} features
              within {num(result.hazardScan.scanRadiusM)} m, {num(result.hazardScan.hazardsAdded)} new
              {result.hazardScan.partial ? " — scan was partial, re-check this area" : ""}.
            </p>
            {overlapKinds.length > 0 ? (
              <p className="mt-1">
                Warning: {num(result.hazardScan.overlapping)} hazard points reach into the circle (
                {overlapKinds.map(([k, n]) => `${k} ×${n}`).join(", ")}). Play is blocked on those spots at runtime;
                shrink or move the zone if they cover much of it.
              </p>
            ) : (
              <p className="mt-1 text-muted-foreground">No hazards reach into the circle.</p>
            )}
          </div>
        )}
      </PanelBody>
    </Panel>
  );
}

function MapPlaceholder({ label }: { label: string }) {
  return (
    <div className="flex h-[420px] items-center justify-center rounded-md border border-border text-xs text-muted-foreground sm:h-[520px]">
      <Loader2 className="mr-2 size-4 animate-spin" />
      {label}
    </div>
  );
}

function Legend({ color, label }: { color: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1">
      <span className="inline-block size-2.5 rounded-full" style={{ background: color }} />
      {label}
    </span>
  );
}

function Field({ label, children, className }: { label: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={className}>
      <Label className="mb-1.5 block">{label}</Label>
      {children}
    </div>
  );
}
