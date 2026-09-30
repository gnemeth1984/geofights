# AR Battle Backend — Design

Backend foundation for a multiplayer AR battle game. Ships on **web only** (operator console +
integration docs); the game client (WebXR/mobile AR) is a separate future consumer of this API.

Visual direction: **mission-control terminal**. Dark, dense, instrument-panel feel — hairline
borders, monospaced numbers, acid-lime telemetry accents on deep slate. It should read like an
internal ops tool, not a marketing site.

## Brand & Colors

Single dark theme, defined as CSS variables in `packages/web/src/web/styles.css` (desktop would
load the same UI). No light mode — a console is always dark.

| Token | Value | Use |
|-------|-------|-----|
| background | `oklch(0.17 0.015 255)` | Page background |
| card | `oklch(0.22 0.017 255)` | Panels, tables, cards |
| foreground | `oklch(0.96 0.005 255)` | Primary text |
| muted-foreground | `oklch(0.68 0.015 255)` | Labels, metadata |
| border | `oklch(1 0 0 / 12%)` | Hairlines, panel edges |
| primary | `oklch(0.85 0.19 124)` | Acid lime — CTAs, live telemetry |
| accent | `oklch(0.79 0.16 72)` | Amber — warnings, "due" jobs, fees |
| destructive | `oklch(0.66 0.21 25)` | Cancel / takedown / delete |
| chart-1..5 | lime → cyan → amber → violet → rose | Rarity + status coding |

Rarity coding is consistent everywhere: common = muted, uncommon = cyan, rare = blue/violet,
epic = violet, legendary = amber.

## Typography

- **Display**: Chakra Petch (600/700) — page titles, stat numbers, nav.
- **Body**: IBM Plex Sans (400/500) — prose, table cells, forms.
- **Mono**: IBM Plex Mono (400/500) — ids, JSON, code samples, event log.

Loaded from Google Fonts in `styles.css`; exposed as `font-display`, `font-sans`, `font-mono`.

## Pages

- **Landing** (`src/web/pages/index.tsx`, `/`) — the public, indexable front door. Account form
  in the first screen, signed-in players redirect to `/play`. Hero art is real creature renders
  from the character builder over an SVG street map (`components/landing/`). No developer links.
  SEO: static fallback copy + JSON-LD (WebSite, VideoGame, FAQPage) in `index.html`,
  `public/robots.txt`, `public/sitemap.xml`, per-route title/canonical/robots in
  `components/route-meta.tsx` — only `/` is indexable.
- **Developer overview** (`src/web/pages/dev.tsx`, `/dev`) — what this backend is, the module
  map, live health and stat readout. Unlinked from the public site, noindex.
- **Console** (`src/web/pages/admin.tsx`) — email/password gate, then the admin panel: Overview,
  Players, Zones & Spawns, Matches, Marketplace, Economy, Jobs. Each tab is a component in
  `src/web/components/admin/`.
- **Integration docs** (`src/web/pages/docs.tsx`) — auth flow, the full RPC surface, copy-paste
  examples (curl + TypeScript) and the realtime event contract for the future WebXR client.

## Key Flows

1. **Operator signs in** → `authClient.signIn.email` → `admin.overview` gates on `player.role`
   (`ADMIN_EMAILS` allowlists operators) → console renders.
2. **Operator inspects live state** → tab queries (`admin.*`) auto-refresh on a 10s interval →
   actions (grant currency, run job, spawn booster, cancel match, take down listing) mutate and
   invalidate the tab's queries.
3. **Game client integrates** → docs page → auth → `avatars.generate` → `matches.quick` →
   `battle.*` → `EventSource /api/realtime/match/:id`.

## Architecture

- **API**: oRPC procedures in `packages/web/src/api/routes/`, Drizzle + Turso, Better Auth
  (email/password) at `/api/auth/*`, SSE at `/api/realtime/match/:matchId`, cron at
  `POST /api/cron/:job`.
- **Frontend**: React 19 + Wouter + Tailwind 4, typed oRPC client, hooks in `src/web/queries/`.
- **State**: TanStack Query with short `staleTime` and polling for live panels.
