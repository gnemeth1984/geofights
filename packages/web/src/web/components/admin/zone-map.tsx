import { useEffect, useRef } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";

/**
 * Operator map for placing zones. OpenStreetMap tiles, drawn with vector
 * circles only — no default marker images, so nothing is imported as an asset.
 *
 * - click anywhere: sets the new zone's centre
 * - green / amber / red rings: existing zones (approved / pending / rejected)
 * - small red dots: hazard points (roads, rail, water, restricted land)
 * - blue dots: playgrounds and parks from OpenStreetMap — click to prefill
 * - dashed ring: the zone about to be created
 *
 * Default export so the zones tab can lazy-load it: Leaflet stays out of the
 * main bundle and the play screen never pays for it.
 */

export type MapZone = {
  id: string;
  name: string;
  centerLat: number;
  centerLng: number;
  radiusM: number;
  review: string;
  isActive: boolean;
};
export type MapHazard = { centerLat: number; centerLng: number; radiusM: number; kind: string; name: string | null };
export type MapCandidate = {
  osmRef: string;
  name: string;
  lat: number;
  lng: number;
  suggestedRadiusM: number;
  existing: boolean;
};

const ZONE_COLOR: Record<string, string> = { approved: "#22c55e", pending: "#f59e0b", rejected: "#ef4444" };
const HAZARD_COLOR: Record<string, string> = {
  road: "#ef4444",
  rail: "#a855f7",
  water: "#3b82f6",
  private: "#f97316",
  cliff: "#eab308",
};

export default function ZoneMap({
  focus,
  selection,
  zones,
  hazards,
  candidates,
  onPick,
  onPickCandidate,
  onViewChange,
}: {
  /** Recentres the map when its `key` changes. */
  focus: { lat: number; lng: number; zoom: number; key: string };
  selection: { lat: number; lng: number; radiusM: number } | null;
  zones: MapZone[];
  hazards: MapHazard[];
  candidates: MapCandidate[];
  onPick: (lat: number, lng: number) => void;
  onPickCandidate: (osmRef: string) => void;
  onViewChange: (center: { lat: number; lng: number }) => void;
}) {
  const el = useRef<HTMLDivElement>(null);
  const map = useRef<L.Map | null>(null);
  const layers = useRef<Record<"zones" | "hazards" | "candidates" | "selection", L.LayerGroup> | null>(null);
  // Handlers change every render; the map binds once and reads them from here.
  const handlers = useRef({ onPick, onPickCandidate, onViewChange });
  handlers.current = { onPick, onPickCandidate, onViewChange };

  useEffect(() => {
    if (!el.current || map.current) return;
    const m = L.map(el.current, { zoomControl: true, attributionControl: true }).setView(
      [focus.lat, focus.lng],
      focus.zoom,
    );
    L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    }).addTo(m);
    layers.current = {
      zones: L.layerGroup().addTo(m),
      hazards: L.layerGroup().addTo(m),
      candidates: L.layerGroup().addTo(m),
      selection: L.layerGroup().addTo(m),
    };
    m.on("click", (e: L.LeafletMouseEvent) => handlers.current.onPick(e.latlng.lat, e.latlng.lng));
    m.on("moveend", () => {
      const c = m.getCenter();
      handlers.current.onViewChange({ lat: c.lat, lng: c.lng });
    });
    map.current = m;
    return () => {
      m.remove();
      map.current = null;
      layers.current = null;
    };
    // The map is created once; `focus` changes are handled below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    map.current?.setView([focus.lat, focus.lng], focus.zoom);
  }, [focus.key]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const g = layers.current?.hazards;
    if (!g) return;
    g.clearLayers();
    for (const h of hazards) {
      const color = HAZARD_COLOR[h.kind] ?? "#ef4444";
      L.circle([h.centerLat, h.centerLng], {
        radius: h.radiusM,
        color,
        weight: 0,
        fillColor: color,
        fillOpacity: 0.18,
        interactive: false,
      }).addTo(g);
    }
  }, [hazards]);

  useEffect(() => {
    const g = layers.current?.zones;
    if (!g) return;
    g.clearLayers();
    for (const z of zones) {
      const color = ZONE_COLOR[z.review] ?? "#94a3b8";
      L.circle([z.centerLat, z.centerLng], {
        radius: z.radiusM,
        color,
        weight: 2,
        dashArray: z.isActive ? undefined : "4 4",
        fillOpacity: 0.08,
      })
        .bindTooltip(`${z.name} · ${z.review}${z.isActive ? "" : " · paused"}`)
        .addTo(g);
    }
  }, [zones]);

  useEffect(() => {
    const g = layers.current?.candidates;
    if (!g) return;
    g.clearLayers();
    for (const c of candidates) {
      L.circleMarker([c.lat, c.lng], {
        radius: 6,
        color: c.existing ? "#64748b" : "#0ea5e9",
        weight: 2,
        fillColor: c.existing ? "#64748b" : "#38bdf8",
        fillOpacity: 0.85,
      })
        .bindTooltip(c.existing ? `${c.name} (already a zone)` : c.name)
        .on("click", (e: L.LeafletMouseEvent) => {
          L.DomEvent.stopPropagation(e);
          handlers.current.onPickCandidate(c.osmRef);
        })
        .addTo(g);
    }
  }, [candidates]);

  useEffect(() => {
    const g = layers.current?.selection;
    if (!g) return;
    g.clearLayers();
    if (!selection) return;
    L.circle([selection.lat, selection.lng], {
      radius: selection.radiusM,
      color: "#f8fafc",
      weight: 2,
      dashArray: "6 6",
      fillColor: "#f8fafc",
      fillOpacity: 0.1,
      interactive: false,
    }).addTo(g);
    L.circleMarker([selection.lat, selection.lng], {
      radius: 4,
      color: "#f8fafc",
      fillColor: "#f8fafc",
      fillOpacity: 1,
      interactive: false,
    }).addTo(g);
  }, [selection?.lat, selection?.lng, selection?.radiusM]); // eslint-disable-line react-hooks/exhaustive-deps

  return <div ref={el} className="h-[420px] w-full overflow-hidden rounded-md border border-border sm:h-[520px]" />;
}
