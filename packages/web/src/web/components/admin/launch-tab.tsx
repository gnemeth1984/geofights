import { useEffect, useMemo, useState } from "react";
import { Check, CheckCircle2, Circle, Copy, ExternalLink, Megaphone, XCircle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Panel, PanelBody, PanelHeader, PanelTitle } from "@/components/ui/panel";
import { Empty, Table, TBody, THead } from "@/components/ui/table";
import { ErrorNote, Loading } from "@/components/admin/state";
import { PostCard, useCopy, type LaunchItemRow } from "@/components/admin/launch-posts";
import {
  CHANNELS,
  LAUNCH_POSTS,
  LAUNCH_TASKS,
  PRESS_ASSETS,
  SCREENSHOTS,
  refLink,
  type ChannelRef,
} from "@/lib/launch-kit";
import { relative } from "@/lib/format";
import { useLaunchItems, useLaunchStats, useSetLaunchItem } from "@/queries/launch";

/**
 * Launch control: where every promo item stands, which channels bring people
 * in, and whether the press kit's files are all reachable. Copy lives in
 * lib/launch-kit.ts; progress in the launch_item table.
 */
export function LaunchTab() {
  const stats = useLaunchStats();
  const items = useLaunchItems();
  const byKey = useMemo(
    () => new Map((items.data ?? []).map((i) => [i.key, i as unknown as LaunchItemRow])),
    [items.data],
  );

  const posted = LAUNCH_POSTS.filter((p) => byKey.get(p.key)?.status === "posted").length;
  const done = LAUNCH_TASKS.filter((t) => byKey.get(t.key)?.status === "posted").length;
  const visits7 = stats.data?.channels.reduce((s, c) => s + c.visits7, 0) ?? 0;
  const signups7 = stats.data?.channels.reduce((s, c) => s + c.signups7, 0) ?? 0;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Posts live" value={`${posted}/${LAUNCH_POSTS.length}`} />
        <Stat label="Launch chores done" value={`${done}/${LAUNCH_TASKS.length}`} />
        <Stat label="Tagged visits · 7d" value={visits7} />
        <Stat label="Tagged sign-ups · 7d" value={signups7} sub={`${stats.data?.totalPlayers ?? "—"} players total`} />
      </div>

      <div className="grid gap-4 xl:grid-cols-5">
        <div className="xl:col-span-3">
          <ChannelsPanel stats={stats} />
        </div>
        <div className="xl:col-span-2">
          <TrendPanel days={stats.data?.days ?? []} loading={stats.isLoading} />
        </div>
      </div>

      <Panel>
        <PanelHeader>
          <PanelTitle>
            <span className="inline-flex items-center gap-2">
              <Megaphone className="size-4" /> Social posts
            </span>
          </PanelTitle>
          <Badge tone={posted === LAUNCH_POSTS.length ? "live" : "neutral"}>
            {posted}/{LAUNCH_POSTS.length} posted
          </Badge>
        </PanelHeader>
        <PanelBody className="space-y-3">
          <ErrorNote error={items.error} />
          <p className="text-xs text-muted-foreground">
            Copy the caption, download the asset, post it from your own account, then paste the post&apos;s link here and
            mark it posted. Instagram and TikTok don&apos;t allow links in captions, so put the ref link in your bio.
          </p>
          {(["ig", "tt", "x"] as ChannelRef[]).map((ch) => (
            <div key={ch}>
              <p className="mb-2 font-mono text-[11px] uppercase tracking-[0.16em] text-muted-foreground">{CHANNELS[ch]}</p>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
                {LAUNCH_POSTS.filter((p) => p.channel === ch).map((p) => (
                  <PostCard key={p.key} post={p} item={byKey.get(p.key)} />
                ))}
              </div>
            </div>
          ))}
        </PanelBody>
      </Panel>

      <div className="grid gap-4 xl:grid-cols-2">
        <ChoresPanel byKey={byKey} />
        <PressKitPanel />
      </div>
    </div>
  );
}

function Stat({ label, value, sub }: { label: string; value: React.ReactNode; sub?: string }) {
  return (
    <div className="rounded-lg border border-border bg-card p-3">
      <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">{label}</p>
      <p className="mt-1 font-display text-2xl font-bold tabular-nums">{value}</p>
      {sub && <p className="text-[11px] text-muted-foreground">{sub}</p>}
    </div>
  );
}

function ChannelsPanel({ stats }: { stats: ReturnType<typeof useLaunchStats> }) {
  const { copied, copy } = useCopy();
  const rows = stats.data?.channels ?? [];
  const known = Object.keys(CHANNELS) as ChannelRef[];
  return (
    <Panel>
      <PanelHeader>
        <PanelTitle>Channels</PanelTitle>
      </PanelHeader>
      <PanelBody className="space-y-3">
        <ErrorNote error={stats.error} />
        {stats.isLoading ? (
          <Loading />
        ) : (
          <Table>
            <THead>
              <tr>
                <th>Ref</th>
                <th className="text-right">Visits 7d</th>
                <th className="text-right">30d</th>
                <th className="text-right">All</th>
                <th className="text-right">Sign-ups</th>
                <th className="text-right">Conv.</th>
                <th>Last</th>
              </tr>
            </THead>
            <TBody>
              {rows.length === 0 && <Empty colSpan={7}>No tagged visits yet. Share a ref link below.</Empty>}
              {rows.map((r) => (
                <tr key={r.ref}>
                  <td>
                    <span className="font-mono text-xs">{r.ref}</span>{" "}
                    <span className="text-xs text-muted-foreground">{CHANNELS[r.ref as ChannelRef] ?? ""}</span>
                  </td>
                  <td className="text-right tabular-nums">{r.visits7}</td>
                  <td className="text-right tabular-nums">{r.visits30}</td>
                  <td className="text-right tabular-nums">{r.visits}</td>
                  <td className="text-right tabular-nums">{r.signups}</td>
                  <td className="text-right tabular-nums">
                    {r.visits ? `${Math.round((r.signups / r.visits) * 100)}%` : "—"}
                  </td>
                  <td className="whitespace-nowrap font-mono text-xs">{r.lastAt ? relative(new Date(r.lastAt)) : "—"}</td>
                </tr>
              ))}
            </TBody>
          </Table>
        )}
        <div className="flex flex-wrap gap-1.5">
          {known.map((ref) => (
            <Button
              key={ref}
              size="sm"
              variant="outline"
              className="h-7 px-2 text-xs"
              title={refLink(ref)}
              onClick={() => copy(ref, refLink(ref))}
            >
              {copied === ref ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
              {CHANNELS[ref]} link
            </Button>
          ))}
        </div>
        <p className="text-[11px] text-muted-foreground">
          Visits are counted once per browser per day per tag. A sign-up counts when someone who arrived with a tag
          creates an account within two days. No IPs or device data are stored.
        </p>
      </PanelBody>
    </Panel>
  );
}

type Day = { day: string; visits: number; signups: number; newPlayers: number; matches: number };

function TrendPanel({ days, loading }: { days: Day[]; loading: boolean }) {
  const series = [
    { key: "visits", label: "Tagged visits", colour: "bg-chart-2" },
    { key: "newPlayers", label: "New players", colour: "bg-primary" },
    { key: "matches", label: "Matches", colour: "bg-accent" },
  ] as const;
  return (
    <Panel>
      <PanelHeader>
        <PanelTitle>Last 14 days</PanelTitle>
      </PanelHeader>
      <PanelBody className="space-y-4">
        {loading ? (
          <Loading />
        ) : (
          series.map((s) => {
            const max = Math.max(1, ...days.map((d) => d[s.key]));
            const total = days.reduce((n, d) => n + d[s.key], 0);
            return (
              <div key={s.key}>
                <div className="mb-1 flex items-baseline justify-between text-xs">
                  <span className="text-muted-foreground">{s.label}</span>
                  <span className="font-mono tabular-nums">{total}</span>
                </div>
                <div className="flex h-12 items-end gap-1">
                  {days.map((d) => (
                    <div
                      key={d.day}
                      title={`${d.day}: ${d[s.key]}`}
                      className={`flex-1 rounded-sm ${d[s.key] ? s.colour : "bg-border"}`}
                      style={{ height: `${Math.max(6, (d[s.key] / max) * 100)}%` }}
                    />
                  ))}
                </div>
              </div>
            );
          })
        )}
        {days.length > 0 && (
          <div className="flex justify-between font-mono text-[10px] text-muted-foreground">
            <span>{days[0]!.day}</span>
            <span>{days[days.length - 1]!.day}</span>
          </div>
        )}
      </PanelBody>
    </Panel>
  );
}

function ChoresPanel({ byKey }: { byKey: Map<string, LaunchItemRow> }) {
  const save = useSetLaunchItem();
  return (
    <Panel>
      <PanelHeader>
        <PanelTitle>Launch chores</PanelTitle>
      </PanelHeader>
      <PanelBody>
        <ul className="divide-y divide-border">
          {LAUNCH_TASKS.map((t) => {
            const isDone = byKey.get(t.key)?.status === "posted";
            return (
              <li key={t.key} className="flex items-start gap-3 py-2.5">
                <button
                  type="button"
                  className="mt-0.5 text-muted-foreground hover:text-primary disabled:opacity-50"
                  disabled={save.isPending}
                  onClick={() => save.mutate({ key: t.key, status: isDone ? "todo" : "posted" })}
                  title={isDone ? "Mark not done" : "Mark done"}
                >
                  {isDone ? <CheckCircle2 className="size-4 text-primary" /> : <Circle className="size-4" />}
                </button>
                <div className="min-w-0">
                  <p className={`text-sm font-medium ${isDone ? "text-muted-foreground line-through" : ""}`}>{t.title}</p>
                  <p className="break-words text-xs text-muted-foreground">{t.detail}</p>
                </div>
              </li>
            );
          })}
        </ul>
      </PanelBody>
    </Panel>
  );
}

/** Pings every press-kit file so a missing asset shows up here, not in a journalist's inbox. */
function PressKitPanel() {
  const files = useMemo(
    () => [
      "/press",
      "/press/geofights-press-kit.zip",
      ...PRESS_ASSETS.map((a) => a.href),
      ...SCREENSHOTS.map((s) => s.src),
      ...new Set(LAUNCH_POSTS.map((p) => p.asset)),
      "/og-image.png",
      "/sitemap.xml",
    ],
    [],
  );
  const [state, setState] = useState<Record<string, boolean | null>>({});
  useEffect(() => {
    let live = true;
    for (const f of new Set(files)) {
      fetch(f, { method: "HEAD" })
        .then((r) => {
          // The SPA fallback answers 200 with HTML for files that don't exist.
          const html = (r.headers.get("content-type") ?? "").includes("text/html");
          const isPage = !/\.[a-z0-9]+$/i.test(f);
          if (live) setState((s) => ({ ...s, [f]: r.ok && (isPage || !html) }));
        })
        .catch(() => live && setState((s) => ({ ...s, [f]: false })));
    }
    return () => {
      live = false;
    };
  }, [files]);
  const unique = [...new Set(files)];
  const ok = unique.filter((f) => state[f]).length;

  return (
    <Panel>
      <PanelHeader>
        <PanelTitle>Press kit files</PanelTitle>
        <Badge tone={ok === unique.length ? "live" : "warn"}>
          {ok}/{unique.length} reachable
        </Badge>
      </PanelHeader>
      <PanelBody className="space-y-2">
        <a href="/press" target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 text-sm text-primary underline">
          Open the press page <ExternalLink className="size-3.5" />
        </a>
        <ul className="max-h-72 space-y-1 overflow-y-auto font-mono text-[11px]">
          {unique.map((f) => (
            <li key={f} className="flex items-center gap-2">
              {state[f] == null ? (
                <Circle className="size-3 text-muted-foreground" />
              ) : state[f] ? (
                <CheckCircle2 className="size-3 text-primary" />
              ) : (
                <XCircle className="size-3 text-destructive" />
              )}
              <a href={f} target="_blank" rel="noreferrer" className="truncate hover:underline">
                {f}
              </a>
            </li>
          ))}
        </ul>
      </PanelBody>
    </Panel>
  );
}
