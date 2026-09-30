import { Radio } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { CodeBlock, Mono } from "@/components/ui/code";
import { Panel, PanelBody, PanelHeader, PanelTitle } from "@/components/ui/panel";
import { Table, TBody, THead } from "@/components/ui/table";
import { SiteHeader } from "@/components/site-header";

/**
 * Integration docs for the future game client (WebXR / mobile AR). Everything
 * here is the contract this backend actually serves — procedure names come
 * from `src/api/routes/*`, events from `src/api/realtime/bus.ts`.
 */
function Docs() {
  return (
    <div className="min-h-dvh">
      <SiteHeader current="docs" />
      <div className="mx-auto max-w-6xl px-4 py-10 sm:px-6">
        <header className="mb-10 max-w-3xl">
          <Badge tone="live">Integration docs</Badge>
          <h1 className="mt-3 font-display text-3xl font-semibold sm:text-4xl">
            Talking to the battle server
          </h1>
          <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
            One typed RPC surface plus one realtime channel. The client renders and sends intent;
            every rule — cooldowns, ranges, damage, loot, prices, GPS proximity — is decided
            server-side, so a tampered client can only lose.
          </p>
        </header>

        <div className="space-y-10">
          <Section
            id="transport"
            title="Transport"
            blurb="Three surfaces, all same-origin on this deployment."
          >
            <Table>
              <THead>
                <tr>
                  <th>Surface</th>
                  <th>Endpoint</th>
                  <th>Shape</th>
                </tr>
              </THead>
              <TBody>
                <tr>
                  <td className="font-medium">Game API</td>
                  <td className="font-mono text-xs">POST /api/rpc/*</td>
                  <td className="text-muted-foreground">
                    oRPC — call it typed with <Mono>@orpc/client</Mono>, or as plain JSON
                  </td>
                </tr>
                <tr>
                  <td className="font-medium">Auth</td>
                  <td className="font-mono text-xs">/api/auth/*</td>
                  <td className="text-muted-foreground">
                    Better Auth: email/password, cookie sessions, bearer for native clients
                  </td>
                </tr>
                <tr>
                  <td className="font-medium">Realtime</td>
                  <td className="font-mono text-xs">GET /api/realtime/match/:matchId</td>
                  <td className="text-muted-foreground">
                    SSE, WebSocket-equivalent event contract with replay by <Mono>seq</Mono>
                  </td>
                </tr>
              </TBody>
            </Table>
          </Section>

          <Section
            id="auth"
            title="1 · Authenticate"
            blurb="Sign up or sign in, then keep the cookie (web) or the bearer token (native). The game profile is created lazily on the first authenticated call — no bootstrap step."
          >
            <div className="grid gap-4 lg:grid-cols-2">
              <CodeBlock
                label="curl"
                code={`# Sign up (auto signs in) — keep the cookie jar
curl -sc jar.txt http://localhost:4200/api/auth/sign-up/email \\
  -H 'content-type: application/json' \\
  -d '{"email":"pilot@arbattle.test","password":"battlepass1","name":"Pilot"}'

# Who am I? (creates the player profile on first touch)
curl -sb jar.txt http://localhost:4200/api/rpc/players/me -X POST \\
  -H 'content-type: application/json' -d '{}'`}
              />
              <CodeBlock
                label="typescript"
                code={`import { createORPCClient } from "@orpc/client";
import { RPCLink } from "@orpc/client/fetch";
import type { AppRouterClient } from "./api-types";

const link = new RPCLink({
  url: "https://your-host/api/rpc",
  // Native clients: send the Better Auth bearer token instead of cookies.
  headers: () => ({ authorization: \`Bearer \${token}\` }),
  fetch: (url, init) => fetch(url, { ...init, credentials: "include" }),
});

export const game: AppRouterClient = createORPCClient(link);
const me = await game.players.me();`}
              />
            </div>
          </Section>

          <Section
            id="surface"
            title="2 · The RPC surface"
            blurb="Nine namespaces. Anything that mutates game state requires a session; admin.* additionally requires the admin role."
          >
            <div className="grid gap-4 md:grid-cols-2">
              {NAMESPACES.map((namespace) => (
                <Panel key={namespace.name}>
                  <PanelHeader className="items-center justify-between">
                    <PanelTitle className="font-mono lowercase tracking-normal">
                      {namespace.name}
                    </PanelTitle>
                    <Badge tone={namespace.auth === "admin" ? "bad" : namespace.auth === "player" ? "warn" : "neutral"}>
                      {namespace.auth}
                    </Badge>
                  </PanelHeader>
                  <PanelBody className="space-y-2">
                    <p className="text-xs leading-relaxed text-muted-foreground">
                      {namespace.blurb}
                    </p>
                    <div className="flex flex-wrap gap-1">
                      {namespace.procedures.map((procedure) => (
                        <span
                          key={procedure}
                          className="rounded border border-border bg-secondary/60 px-1.5 py-0.5 font-mono text-[11px] text-muted-foreground"
                        >
                          {procedure}
                        </span>
                      ))}
                    </div>
                  </PanelBody>
                </Panel>
              ))}
            </div>
          </Section>

          <Section
            id="flow"
            title="3 · A full match, end to end"
            blurb="The sequence an AR client runs: mint an avatar, find a match, open the stream, act."
          >
            <CodeBlock
              label="typescript"
              code={`// 1. Roster — AI generates the character's name, look, stats and ability.
const avatar = await game.avatars.generate({ theme: "scrapyard sentinel" });

// 2. Nature exploration: what's findable around the player right now.
await game.players.ping({ lat, lng });
const nearby = await game.nature.nearby({ lat, lng, radiusM: 400 });
if (nearby[0]?.inRange) await game.nature.collect({ spawnId: nearby[0].id });

// 3. Boosters modify stats and can unlock abilities. Three equipped, max.
const inventory = await game.boosters.inventory();
await game.boosters.equip({ avatarId: avatar.id, instanceId: inventory[0].id });

// 4. Matchmaking: join the nearest open lobby (2-4 players) or open one.
const match = await game.matches.quick({ avatarId: avatar.id, lat, lng });

// 5. Open the realtime channel before starting, so nothing is missed.
const stream = new EventSource(\`/api/realtime/match/\${match.id}\`);

// 6. Host starts it; the engine becomes authoritative from here.
await game.matches.start({ matchId: match.id });

// 7. Per-frame pose (broadcast only, never persisted) + gated actions.
await game.battle.updatePosition({ matchId: match.id, x, y, z, yaw });
await game.battle.attack({ matchId: match.id, targetPlayerId });
await game.battle.useAbility({ matchId: match.id, ability: "overclock", targetPlayerId });

// 8. Rewards, XP and an AI-written recap land with match_finished.`}
            />
          </Section>

          <Section
            id="realtime"
            title="4 · Realtime event contract"
            blurb="Eight event types on one channel per match. Everything except avatar_position is written to battle_event with a monotonic seq, so a reconnect replays exactly what was missed."
          >
            <div className="grid gap-4 lg:grid-cols-[1.1fr_1fr]">
              <Table>
                <THead>
                  <tr>
                    <th>Event</th>
                    <th>Payload</th>
                    <th>Log</th>
                  </tr>
                </THead>
                <TBody>
                  {EVENTS.map((event) => (
                    <tr key={event.name}>
                      <td className="font-mono text-xs">{event.name}</td>
                      <td className="text-xs text-muted-foreground">{event.payload}</td>
                      <td>
                        {event.durable ? (
                          <Badge tone="live">durable</Badge>
                        ) : (
                          <Badge tone="warn">ephemeral</Badge>
                        )}
                      </td>
                    </tr>
                  ))}
                </TBody>
              </Table>
              <div className="space-y-4">
                <CodeBlock
                  label="wire format"
                  code={`id: 42
event: avatar_damage
data: {"seq":42,"matchId":"mtc_…","type":"avatar_damage",
       "payload":{"actorPlayerId":"ply_…","targetPlayerId":"ply_…",
       "damage":18,"healthLeft":54},"message":"Sentinel lands a hit",
       "at":"2026-09-18T10:12:03.441Z"}

: ping 1758189123441   ← heartbeat every 20s`}
                />
                <CodeBlock
                  label="client"
                  code={`const stream = new EventSource(
  \`/api/realtime/match/\${matchId}?afterSeq=\${lastSeq}\`,
);

stream.addEventListener("avatar_damage", (e) => {
  const event = JSON.parse(e.data);
  lastSeq = Math.max(lastSeq, event.seq);   // ephemeral seq is negative
  applyDamage(event.payload);
});

stream.addEventListener("match_finished", (e) => {
  showRecap(JSON.parse(e.data).payload);
  stream.close();
});`}
                />
              </div>
            </div>
            <Panel className="mt-4">
              <PanelHeader>
                <PanelTitle className="flex items-center gap-2">
                  <Radio className="size-4 text-primary" />
                  Swapping SSE for WebSockets
                </PanelTitle>
              </PanelHeader>
              <PanelBody className="text-sm leading-relaxed text-muted-foreground">
                The managed runtime serves this API through a fetch handler, so the shipped
                transport is SSE. Event names, payloads and ordering are the ones a WS client
                expects, and all transport code is confined to{" "}
                <Mono>src/api/realtime/bus.ts</Mono> — moving to <Mono>ws</Mono> means
                reimplementing <Mono>publish()</Mono> against a socket registry. No route,
                service or engine code changes, and <Mono>eventsSince()</Mono> keeps working as
                the reconnect path.
              </PanelBody>
            </Panel>
          </Section>

          <Section
            id="cron"
            title="5 · Scheduled work"
            blurb="The scheduler runs in-process and is idempotent — 'due' is derived from the cron_run table, so a duplicate trigger is a no-op. Set DISABLE_CRON=1 to drive it externally."
          >
            <div className="grid gap-4 lg:grid-cols-[1fr_1fr]">
              <Table>
                <THead>
                  <tr>
                    <th>Job</th>
                    <th>Every</th>
                    <th>Does</th>
                  </tr>
                </THead>
                <TBody>
                  {JOBS.map((job) => (
                    <tr key={job.name}>
                      <td className="font-mono text-xs">{job.name}</td>
                      <td className="tabular text-muted-foreground">{job.interval}</td>
                      <td className="text-xs text-muted-foreground">{job.does}</td>
                    </tr>
                  ))}
                </TBody>
              </Table>
              <CodeBlock
                label="curl"
                code={`# Run everything that is due
curl -X POST http://localhost:4200/api/cron/due \\
  -H "x-cron-secret: $CRON_SECRET"

# Force one job
curl -X POST http://localhost:4200/api/cron/daily-booster-spawn \\
  -H "x-cron-secret: $CRON_SECRET"`}
              />
            </div>
          </Section>

          <Section
            id="env"
            title="6 · Configuration"
            blurb="Platform variables are provisioned already; these are the ones this backend adds."
          >
            <Table>
              <THead>
                <tr>
                  <th>Variable</th>
                  <th>Effect</th>
                </tr>
              </THead>
              <TBody>
                <tr>
                  <td className="font-mono text-xs">ADMIN_EMAILS</td>
                  <td className="text-sm text-muted-foreground">
                    Comma-separated allowlist promoted to the admin role on sign-in. The first
                    account on a fresh install is promoted regardless.
                  </td>
                </tr>
                <tr>
                  <td className="font-mono text-xs">AI_GATEWAY_API_KEY</td>
                  <td className="text-sm text-muted-foreground">
                    Enables the AI content engine (names, abilities, taunts, recaps). Without it
                    every generator falls back to deterministic templates and the API stays
                    fully functional.
                  </td>
                </tr>
                <tr>
                  <td className="font-mono text-xs">CRON_SECRET</td>
                  <td className="text-sm text-muted-foreground">
                    When set, <Mono>POST /api/cron/:job</Mono> requires the matching{" "}
                    <Mono>x-cron-secret</Mono> header.
                  </td>
                </tr>
                <tr>
                  <td className="font-mono text-xs">DISABLE_CRON</td>
                  <td className="text-sm text-muted-foreground">
                    Skips the in-process scheduler, for when an external scheduler owns the
                    cadence.
                  </td>
                </tr>
              </TBody>
            </Table>
          </Section>
        </div>
      </div>
    </div>
  );
}

function Section({
  id,
  title,
  blurb,
  children,
}: {
  id: string;
  title: string;
  blurb: string;
  children: React.ReactNode;
}) {
  return (
    <section id={id} className="scroll-mt-20">
      <h2 className="font-display text-xl font-semibold">{title}</h2>
      <p className="mb-4 mt-1 max-w-3xl text-sm leading-relaxed text-muted-foreground">
        {blurb}
      </p>
      {children}
    </section>
  );
}

const NAMESPACES = [
  {
    name: "players",
    auth: "mixed",
    blurb: "Accounts, progression, GPS heartbeat, leaderboards and the currency ledger.",
    procedures: [
      "session",
      "me",
      "updateProfile",
      "ping",
      "stats",
      "profile",
      "leaderboard",
      "weeklyLeaderboard",
      "transactions",
      "collectionLog",
      "suggestUsername",
    ],
  },
  {
    name: "avatars",
    auth: "player",
    blurb: "AI-generated battle characters, three slots per player.",
    procedures: ["list", "limits", "get", "generate", "rename", "release"],
  },
  {
    name: "boosters",
    auth: "mixed",
    blurb: "Stat modifiers and ability unlocks: shop stock, inventory, equip, tier upgrades.",
    procedures: ["inventory", "limits", "get", "shop", "buy", "equip", "unequip", "upgrade"],
  },
  {
    name: "nature",
    auth: "mixed",
    blurb: "GPS exploration — zones, nearby spawns and proximity-gated pickups.",
    procedures: ["zones", "zone", "nearestZone", "nearby", "collect"],
  },
  {
    name: "safety",
    auth: "mixed",
    blurb:
      "The child-safety layer every location call funnels through: hazard veto, zone " +
      "containment, the speed gate, plus OSM scanning and the operator review queue.",
    procedures: [
      "config",
      "check",
      "hazards",
      "importOsm",
      "pending",
      "review",
      "hazardList",
      "hazardCreate",
      "hazardDelete",
      "events",
    ],
  },
  {
    name: "marketplace",
    auth: "mixed",
    blurb: "Fixed-price player trading in in-game currency, 10% house fee on every sale.",
    procedures: [
      "config",
      "browse",
      "listing",
      "sellable",
      "myListings",
      "quote",
      "sell",
      "cancel",
      "buy",
      "history",
    ],
  },
  {
    name: "matches",
    auth: "mixed",
    blurb: "Lobbies and matchmaking for 2–4 players, with a one-call quick-match.",
    procedures: [
      "config",
      "eligibleAvatars",
      "open",
      "mine",
      "get",
      "create",
      "join",
      "quick",
      "leave",
      "start",
      "finish",
    ],
  },
  {
    name: "battle",
    auth: "mixed",
    blurb: "The authoritative engine: poses, attacks, abilities and the event log.",
    procedures: ["config", "state", "myState", "updatePosition", "attack", "useAbility", "events"],
  },
  {
    name: "admin",
    auth: "admin",
    blurb: "Everything the console runs on — inspection, moderation and content generation.",
    procedures: [
      "overview",
      "players",
      "setRole",
      "grantCurrency",
      "generateBooster",
      "generateAvatar",
      "boosterDefinitions",
      "zones",
      "createZone",
      "updateZone",
      "deleteZone",
      "spawnBooster",
      "refreshSpawns",
      "matches",
      "cancelMatch",
      "battleLog",
      "listings",
      "takedownListing",
      "economy",
      "jobs",
      "runJob",
      "cronHistory",
      "leaderboardSnapshots",
    ],
  },
  {
    name: "ping",
    auth: "public",
    blurb: "Liveness probe, also served as GET /api/health.",
    procedures: ["ping"],
  },
] as const;

const EVENTS = [
  {
    name: "player_joined",
    payload: "playerId, username, avatar summary",
    durable: true,
  },
  { name: "player_left", payload: "playerId, reason", durable: true },
  {
    name: "avatar_position",
    payload: "playerId, x, y, z, yaw — device pose, high frequency",
    durable: false,
  },
  {
    name: "avatar_action",
    payload: "actorPlayerId, ability, targetPlayerId, effects",
    durable: true,
  },
  {
    name: "avatar_damage",
    payload: "actorPlayerId, targetPlayerId, damage, healthLeft",
    durable: true,
  },
  { name: "avatar_death", payload: "playerId, killerPlayerId", durable: true },
  { name: "match_started", payload: "startedAt, participants", durable: true },
  {
    name: "match_finished",
    payload:
      "reason, winnerPlayerId, rewards, forfeits (spoils | bounty | skipped — the booster each loser gave up), AI-written summary",
    durable: true,
  },
] as const;

const JOBS = [
  {
    name: "daily-booster-spawn",
    interval: "24h",
    does: "Scatters fresh GPS booster spawns across every active zone.",
  },
  {
    name: "daily-zone-refresh",
    interval: "24h",
    does: "Reweights zones by recent activity and retires stale spawns.",
  },
  {
    name: "weekly-leaderboard-reset",
    interval: "7d",
    does: "Snapshots the weekly top 25 and starts a new competitive week.",
  },
  {
    name: "weekly-ai-avatars",
    interval: "7d",
    does: "Generates the weekly AI avatar drop and rotates the booster pool.",
  },
] as const;

export default Docs;
