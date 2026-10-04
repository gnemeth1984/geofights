import * as React from "react";
import { Link } from "wouter";
import {
  Activity,
  BookOpen,
  Clock,
  Coins,
  Flag,
  FlaskConical,
  LogOut,
  MapPin,
  Megaphone,
  ShieldAlert,
  Sparkles,
  Store,
  Swords,
  Terminal,
  Users,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Panel, PanelBody, PanelHeader, PanelTitle } from "@/components/ui/panel";
import { ContentTab } from "@/components/admin/content-tab";
import { EconomyTab } from "@/components/admin/economy-tab";
import { JobsTab } from "@/components/admin/jobs-tab";
import { LaunchTab } from "@/components/admin/launch-tab";
import { LoginCard } from "@/components/admin/login";
import { MarketTab } from "@/components/admin/market-tab";
import { MatchesTab } from "@/components/admin/matches-tab";
import { OverviewTab } from "@/components/admin/overview-tab";
import { PlayersTab } from "@/components/admin/players-tab";
import { SafetyTab } from "@/components/admin/safety-tab";
import { ModerationTab } from "@/components/admin/moderation-tab";
import { ZonesTab } from "@/components/admin/zones-tab";
import { Loading } from "@/components/admin/state";
import { useMe, useSession, useSignOut } from "@/queries/session";
import { cn } from "@/lib/utils";
import { coins } from "@/lib/format";

const TABS = [
  { id: "overview", label: "Overview", icon: Activity, render: () => <OverviewTab /> },
  { id: "players", label: "Players", icon: Users, render: () => <PlayersTab /> },
  { id: "zones", label: "Zones & spawns", icon: MapPin, render: () => <ZonesTab /> },
  { id: "safety", label: "Safety", icon: ShieldAlert, render: () => <SafetyTab /> },
  { id: "moderation", label: "Moderation", icon: Flag, render: () => <ModerationTab /> },
  { id: "matches", label: "Matches", icon: Swords, render: () => <MatchesTab /> },
  { id: "market", label: "Marketplace", icon: Store, render: () => <MarketTab /> },
  { id: "economy", label: "Economy", icon: Coins, render: () => <EconomyTab /> },
  { id: "jobs", label: "Jobs", icon: Clock, render: () => <JobsTab /> },
  { id: "content", label: "AI content", icon: Sparkles, render: () => <ContentTab /> },
  { id: "launch", label: "Launch", icon: Megaphone, render: () => <LaunchTab /> },
] as const;

type TabId = (typeof TABS)[number]["id"];

/**
 * Operator console. Three gates, in order: a session, a game profile, and the
 * `admin` role on that profile. The role check is only cosmetic — every
 * `admin.*` procedure enforces it server-side in `adminProc`.
 */
function Admin() {
  const [tab, setTab] = React.useState<TabId>("overview");
  const session = useSession();
  const signedIn = Boolean(session.data?.user);
  const me = useMe(signedIn);
  const signOut = useSignOut();

  const active = TABS.find((entry) => entry.id === tab) ?? TABS[0];

  return (
    <div className="min-h-dvh">
      <header className="sticky top-0 z-10 border-b border-border bg-background/85 backdrop-blur">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-3 px-4 py-3 sm:px-6">
          <Link
            href="/"
            className="flex items-center gap-2 font-display text-sm font-semibold uppercase tracking-[0.18em]"
          >
            <Terminal className="size-4 text-primary" />
            GeoFights
            <span className="text-muted-foreground">Admin</span>
          </Link>
          <div className="ml-auto flex items-center gap-2">
            <Link href="/docs">
              <Button variant="ghost" size="sm">
                <BookOpen className="size-4" />
                Docs
              </Button>
            </Link>
            {/*
              The character lab is a local render harness — it talks to nothing and
              saves nothing, so the only gate it needs is staying out of a player's
              way. Showing it to operators only keeps it that way.
            */}
            {me.data?.role === "admin" ? (
              <Link href="/character-lab">
                <Button variant="ghost" size="sm">
                  <FlaskConical className="size-4" />
                  Character lab
                </Button>
              </Link>
            ) : null}
            {me.data ? (
              <>
                <Badge tone="live" className="hidden sm:inline-flex">
                  {me.data.username}
                </Badge>
                <span className="tabular hidden font-mono text-xs text-accent sm:inline">
                  {coins(me.data.currency)}
                </span>
              </>
            ) : null}
            {signedIn ? (
              <Button
                variant="outline"
                size="sm"
                disabled={signOut.isPending}
                onClick={() => signOut.mutate()}
              >
                <LogOut className="size-4" />
                Sign out
              </Button>
            ) : null}
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-4 py-8 sm:px-6">
        {session.isPending ? (
          <Loading label="Checking session" />
        ) : !signedIn ? (
          <LoginCard />
        ) : me.isPending ? (
          <Loading label="Resolving operator profile" />
        ) : me.data && me.data.role !== "admin" ? (
          <NotOperator />
        ) : (
          <div className="space-y-6">
            <nav className="flex flex-wrap gap-1.5 border-b border-border pb-3">
              {TABS.map((entry) => {
                const Icon = entry.icon;
                const isActive = entry.id === tab;
                return (
                  <button
                    key={entry.id}
                    type="button"
                    onClick={() => setTab(entry.id)}
                    className={cn(
                      "flex items-center gap-2 rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
                      isActive
                        ? "bg-primary/15 text-primary"
                        : "text-muted-foreground hover:bg-secondary hover:text-foreground",
                    )}
                  >
                    <Icon className="size-4" />
                    {entry.label}
                  </button>
                );
              })}
            </nav>
            <div>
              <h1 className="mb-1 font-display text-2xl font-semibold">{active.label}</h1>
              <p className="mb-6 text-sm text-muted-foreground">{BLURBS[active.id]}</p>
              {active.render()}
            </div>
          </div>
        )}
      </main>
    </div>
  );
}

const BLURBS: Record<TabId, string> = {
  launch: "Promotion: social posts and where they stand, visits and sign-ups per channel, and press-kit health.",
  overview: "Live system state — table counts, AI engine status, realtime subscribers, cron health.",
  players: "Accounts, balances and roles. Grant currency, promote operators, mint avatars.",
  zones: "GPS zones for Nature Exploration and the boosters currently findable in them.",
  safety:
    "Play areas proposed from OpenStreetMap or suggested by players, the hazard map that overrides them, and every stop the safety layer made.",
  moderation: "Player reports, chat flags and account states — hide or suspend, and review what was flagged.",
  matches: "Matchmaking and the server-authoritative battle engine, with the raw event log.",
  market: "Player-to-player listings. Fixed price, in-game currency only, 10% house fee.",
  economy: "Currency in circulation, marketplace volume, fees collected and the ledger.",
  jobs: "Scheduled work: daily spawn refresh, booster rotation, match reaping, leaderboards.",
  content: "Boosters minted by the AI content engine, and weekly leaderboard snapshots.",
};

function NotOperator() {
  const signOut = useSignOut();
  return (
    <div className="mx-auto w-full max-w-md">
      <Panel>
        <PanelHeader>
          <PanelTitle>Not an operator</PanelTitle>
        </PanelHeader>
        <PanelBody className="space-y-4 text-sm text-muted-foreground">
          <p>
            This account is signed in but it is a player account, not an operator. Add its email
            to <span className="font-mono text-foreground">ADMIN_EMAILS</span> and sign in again,
            or have an existing operator promote it from the Players tab.
          </p>
          <Button variant="outline" onClick={() => signOut.mutate()}>
            <LogOut className="size-4" />
            Sign out
          </Button>
        </PanelBody>
      </Panel>
    </div>
  );
}

export default Admin;
