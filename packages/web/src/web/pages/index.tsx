import {
  ArrowRight,
  BookOpen,
  Bot,
  Coins,
  Database,
  MapPin,
  Radio,
  Shield,
  Sparkles,
  Store,
  Swords,
  Zap,
} from "lucide-react";
import { Link } from "wouter";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { CodeBlock, Mono } from "@/components/ui/code";
import { Panel, PanelBody, PanelHeader, PanelTitle } from "@/components/ui/panel";
import { SiteHeader } from "@/components/site-header";
import { usePing } from "@/queries/ping";

/**
 * Landing page for the backend itself: what exists, where it lives, and the
 * two doors out of here — the operator console and the integration docs.
 */
function Index() {
  const ping = usePing();

  return (
    <div className="min-h-dvh">
      <SiteHeader current="home" />

      <div className="mx-auto max-w-6xl px-4 py-12 sm:px-6">
        <section className="max-w-3xl">
          <div className="flex items-center gap-2">
            <Badge tone={ping.isError ? "bad" : ping.data ? "live" : "neutral"}>
              {ping.isLoading ? "checking" : ping.isError ? "servers down" : "servers online"}
            </Badge>
            <Badge>install to play</Badge>
          </div>
          <h1 className="mt-4 font-display text-4xl font-semibold leading-tight sm:text-5xl">
            The map around you is <span className="text-primary">the arena</span>.
          </h1>
          <p className="mt-4 text-base leading-relaxed text-muted-foreground">
            Walk your city to claim zones, hunt boosters where they spawn, and duel other players
            in realtime AR battles with an AI-generated fighter of your own. Runs in the browser —
            install it to your home screen and it opens straight into the arena, full screen.
          </p>
          <div className="mt-6 flex flex-wrap gap-3">
            <Link href="/play">
              <Button>
                Enter the arena
                <ArrowRight className="size-4" />
              </Button>
            </Link>
            <Link href="/docs">
              <Button variant="outline">
                <BookOpen className="size-4" />
                Developer docs
              </Button>
            </Link>
          </div>
        </section>

        <section className="mt-14">
          <h2 className="font-display text-xl font-semibold">Modules</h2>
          <p className="mb-5 mt-1 text-sm text-muted-foreground">
            One oRPC namespace per module, one service file behind it. Extend by adding a file,
            not by editing the core.
          </p>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {MODULES.map((module) => {
              const Icon = module.icon;
              return (
                <Panel key={module.title}>
                  <PanelHeader className="items-center justify-start gap-2">
                    <Icon className="size-4 text-primary" />
                    <PanelTitle>{module.title}</PanelTitle>
                  </PanelHeader>
                  <PanelBody className="space-y-3">
                    <p className="text-sm leading-relaxed text-muted-foreground">
                      {module.blurb}
                    </p>
                    <div className="flex flex-wrap gap-1">
                      {module.tags.map((tag) => (
                        <span
                          key={tag}
                          className="rounded border border-border bg-secondary/60 px-1.5 py-0.5 font-mono text-[11px] text-muted-foreground"
                        >
                          {tag}
                        </span>
                      ))}
                    </div>
                  </PanelBody>
                </Panel>
              );
            })}
          </div>
        </section>

        <section className="mt-14 grid gap-6 lg:grid-cols-[1.15fr_1fr]">
          <div>
            <h2 className="font-display text-xl font-semibold">Server-authoritative by design</h2>
            <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
              The client never decides an outcome. It reports intent — a pose, an attack, an
              ability — and the engine validates range, cooldown and state before anything is
              written or broadcast. Rewards, loot rolls, prices and GPS proximity are resolved the
              same way.
            </p>
            <ul className="mt-4 space-y-2 text-sm text-muted-foreground">
              <li className="flex gap-2">
                <Shield className="mt-0.5 size-4 shrink-0 text-primary" />
                Every mutation flows through <Mono>playerProc</Mono>; the console adds{" "}
                <Mono>adminProc</Mono> on top.
              </li>
              <li className="flex gap-2">
                <Radio className="mt-0.5 size-4 shrink-0 text-primary" />
                Durable events carry a monotonic <Mono>seq</Mono>, so a reconnect replays exactly
                what was missed.
              </li>
              <li className="flex gap-2">
                <Sparkles className="mt-0.5 size-4 shrink-0 text-primary" />
                AI content stays inside server-side rarity budgets — generated items cannot break
                balance.
              </li>
              <li className="flex gap-2">
                <Database className="mt-0.5 size-4 shrink-0 text-primary" />
                Drizzle schema on Turso (SQLite); named tables for players, avatars, boosters,
                zones, spawns, matches, listings, transactions and cron runs.
              </li>
            </ul>
          </div>
          <CodeBlock
            label="quick match"
            code={`const avatar = await game.avatars.generate({
  theme: "scrapyard sentinel",
});

const match = await game.matches.quick({
  avatarId: avatar.id, lat, lng,
});

const stream = new EventSource(
  \`/api/realtime/match/\${match.id}\`,
);

await game.battle.attack({
  matchId: match.id, targetPlayerId,
});`}
          />
        </section>

        <section className="mt-14">
          <h2 className="font-display text-xl font-semibold">Where things live</h2>
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <CodeBlock
              label="api"
              code={`packages/web/src/api/
  routes/      one file per namespace
  services/    game logic (players, avatars,
               boosters, nature, marketplace,
               matchmaking, cron)
  battle/      authoritative engine
  realtime/    bus.ts + stream.ts (SSE)
  ai/          gateway + content generators
  database/    schema.ts (Drizzle)`}
            />
            <CodeBlock
              label="web"
              code={`packages/web/src/web/
  pages/       index, admin, docs
  components/  admin/* console tabs
               ui/* primitives
  queries/     typed oRPC hooks
  lib/         api client, formatters`}
            />
          </div>
        </section>
      </div>
    </div>
  );
}

const MODULES = [
  {
    title: "Players",
    icon: Shield,
    blurb:
      "Email/password accounts via Better Auth, with a game profile created on first authenticated call. XP, level, currency, GPS heartbeat, roles.",
    tags: ["players.*", "better-auth", "progression"],
  },
  {
    title: "AI avatars",
    icon: Bot,
    blurb:
      "Battle characters generated by the AI engine: name, backstory, look, stat block and a signature ability, rolled inside rarity budgets. Three slots per player.",
    tags: ["avatars.*", "rarity budgets", "3 slots"],
  },
  {
    title: "Boosters",
    icon: Zap,
    blurb:
      "Stat modifiers that can unlock abilities. Bought in the rotating shop, found in the wild, won in battle, or resold — and upgradable to higher tiers.",
    tags: ["boosters.*", "tiers", "equip 3"],
  },
  {
    title: "Nature exploration",
    icon: MapPin,
    blurb:
      "GPS zones seeded with booster spawns by a daily cron. Pickups are proximity-gated on the server, so location cannot be faked past the radius check.",
    tags: ["nature.*", "haversine", "daily spawn"],
  },
  {
    title: "Marketplace",
    icon: Store,
    blurb:
      "Fixed-price player-to-player trading in in-game currency only. The house takes 10% on every sale; operators can take a listing down without paying out.",
    tags: ["marketplace.*", "10% fee", "ledger"],
  },
  {
    title: "Matchmaking",
    icon: Swords,
    blurb:
      "Lobbies of 2–4 players with a one-call quick-match that joins the nearest open lobby or opens one. Stale lobbies and abandoned matches are reaped.",
    tags: ["matches.*", "2–4 players", "quick"],
  },
  {
    title: "Battle engine",
    icon: Radio,
    blurb:
      "Authoritative combat: validated attacks and abilities, cooldowns, damage resolution, death and settlement — with an AI-written recap at the end.",
    tags: ["battle.*", "cooldowns", "battle_event"],
  },
  {
    title: "Realtime",
    icon: Radio,
    blurb:
      "One channel per match carrying eight event types. SSE on this runtime, with a WebSocket-equivalent contract isolated in a single module.",
    tags: ["/api/realtime", "seq replay", "heartbeat"],
  },
  {
    title: "Economy & cron",
    icon: Coins,
    blurb:
      "Every coin movement is a ledger row. Four idempotent jobs handle spawns, zone reweighting, the weekly leaderboard and the weekly AI drop.",
    tags: ["transactions", "cron_run", "POST /api/cron"],
  },
] as const;

export default Index;
