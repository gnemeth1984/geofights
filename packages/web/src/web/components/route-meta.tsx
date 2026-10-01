import { useLocation } from "wouter";
import { usePageMeta } from "@/lib/page-meta";

const TITLES: Record<string, string> = {
  "/": "GeoFights — Free AR Battle Game in the Parks Near You",
  "/play": "Play GeoFights",
  "/admin": "GeoFights Console",
  "/dev": "GeoFights — Developer Overview",
  "/docs": "GeoFights — Integration Docs",
  "/character-lab": "GeoFights — Character Lab",
  "/parent-consent": "GeoFights — Parent Permission",
  "/add-friend": "GeoFights — Add a Friend",
};

/** Title, canonical and robots for whichever route is showing. Only `/` is indexable. */
export function RouteMeta() {
  const [path] = useLocation();
  const known = path in TITLES ? path : "/";
  usePageMeta({ title: TITLES[known] ?? TITLES["/"]!, path: known, index: path === "/" });
  return null;
}
