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
  "/parent-ground": "GeoFights — Suggested Play Area",
  "/reset-password": "GeoFights — Reset Password",
  "/press": "GeoFights Press Kit — Free AR Battle Game for Parks",
};

const DESCRIPTIONS: Record<string, string> = {
  "/press":
    "Press kit for GeoFights, the free outdoor AR battle game: fact sheet, screenshots, logo, trailer and contact.",
};

/** Routes search engines may list. Everything else is the game shell, the console or a private link. */
const INDEXABLE = new Set(["/", "/press"]);

/** Title, canonical and robots for whichever route is showing. Only `/` and `/press` are indexable. */
export function RouteMeta() {
  const [path] = useLocation();
  const known = path in TITLES ? path : "/";
  usePageMeta({
    title: TITLES[known] ?? TITLES["/"]!,
    path: known,
    index: INDEXABLE.has(path),
    description: DESCRIPTIONS[known],
  });
  return null;
}
