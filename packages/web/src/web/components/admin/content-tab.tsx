import * as React from "react";
import { Sparkles, Trophy } from "lucide-react";
import { Badge, RarityBadge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input, Label, Select } from "@/components/ui/input";
import { Panel, PanelBody, PanelHeader, PanelTitle } from "@/components/ui/panel";
import { Empty, Table, TBody, THead } from "@/components/ui/table";
import { ErrorNote, Loading } from "@/components/admin/state";
import {
  useBoosterDefinitions,
  useGenerateBooster,
  useLeaderboardSnapshots,
} from "@/queries/admin";
import { coins, dateTime, num, RARITIES, type Rarity } from "@/lib/format";

type Origin = "any" | "shop" | "nature" | "battle";

/**
 * The AI content engine's output, and the weekly leaderboard it feeds. Minting
 * a booster here writes a definition every drop source can roll from — the
 * model names it, describes it and picks the ability; stat modifiers stay
 * inside server-side rarity budgets so generated content can't break balance.
 */
export function ContentTab() {
  const [rarity, setRarity] = React.useState("");
  const [origin, setOrigin] = React.useState<Origin>("any");
  const [tier, setTier] = React.useState("1");
  const boosters = useBoosterDefinitions();
  const snapshots = useLeaderboardSnapshots();
  const generate = useGenerateBooster();

  return (
    <div className="space-y-6">
      <Panel>
        <PanelHeader>
          <PanelTitle className="flex items-center gap-2">
            <Sparkles className="size-4 text-accent" />
            Mint a booster definition
          </PanelTitle>
        </PanelHeader>
        <PanelBody className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-4">
            <div className="space-y-1.5">
              <Label htmlFor="booster-rarity">Rarity</Label>
              <Select
                id="booster-rarity"
                value={rarity}
                onChange={(event) => setRarity(event.target.value)}
              >
                <option value="">Roll it</option>
                {RARITIES.map((value) => (
                  <option key={value} value={value}>
                    {value}
                  </option>
                ))}
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="booster-origin">Drop source</Label>
              <Select
                id="booster-origin"
                value={origin}
                onChange={(event) => setOrigin(event.target.value as Origin)}
              >
                <option value="any">Any source</option>
                <option value="shop">Shop only</option>
                <option value="nature">Nature spawns</option>
                <option value="battle">Battle rewards</option>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="booster-tier">Tier</Label>
              <Input
                id="booster-tier"
                type="number"
                min={1}
                max={5}
                value={tier}
                onChange={(event) => setTier(event.target.value)}
              />
            </div>
            <div className="flex items-end">
              <Button
                className="w-full"
                disabled={generate.isPending}
                onClick={() =>
                  generate.mutate({
                    rarity: rarity ? (rarity as Rarity) : undefined,
                    origin,
                    tier: Math.min(5, Math.max(1, Number(tier) || 1)),
                  })
                }
              >
                <Sparkles className="size-4" />
                {generate.isPending ? "Generating…" : "Generate"}
              </Button>
            </div>
          </div>
          {generate.isError ? <ErrorNote error={generate.error} /> : null}
          {generate.data ? (
            <p className="text-sm text-muted-foreground">
              Minted <span className="font-medium text-foreground">{generate.data.name}</span> —{" "}
              {generate.data.description}
            </p>
          ) : null}
        </PanelBody>
      </Panel>

      <Panel>
        <PanelHeader>
          <PanelTitle>Booster definitions</PanelTitle>
        </PanelHeader>
        {boosters.isLoading ? (
          <PanelBody>
            <Loading label="Reading definitions" />
          </PanelBody>
        ) : boosters.isError ? (
          <PanelBody>
            <ErrorNote error={boosters.error} />
          </PanelBody>
        ) : (
          <Table>
            <THead>
              <tr>
                <th>Booster</th>
                <th>Rarity</th>
                <th>Modifiers</th>
                <th>Ability</th>
                <th>Tier</th>
                <th>Price</th>
                <th>Source</th>
                <th>Owned</th>
              </tr>
            </THead>
            <TBody>
              {(boosters.data ?? []).length === 0 ? (
                <Empty colSpan={8}>
                  No definitions yet — mint one above, or run the booster rotation job.
                </Empty>
              ) : (
                (boosters.data ?? []).map((booster) => (
                  <tr key={booster.id}>
                    <td>
                      <div className="font-medium">{booster.name}</div>
                      <div className="max-w-[34ch] truncate text-xs text-muted-foreground">
                        {booster.description}
                      </div>
                    </td>
                    <td>
                      <RarityBadge rarity={booster.rarity} />
                    </td>
                    <td className="font-mono text-xs text-muted-foreground">
                      {Object.entries(booster.statModifiers)
                        .map(([stat, value]) => `${stat} ${value > 0 ? "+" : ""}${value}`)
                        .join(" · ") || "—"}
                    </td>
                    <td className="max-w-[24ch] truncate text-xs">
                      {booster.unlocksAbility ? (
                        <span title={booster.abilityDescription ?? undefined}>
                          {booster.unlocksAbility}
                        </span>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </td>
                    <td className="tabular">{booster.tier}</td>
                    <td className="tabular text-accent">
                      {booster.price ? coins(booster.price) : "—"}
                    </td>
                    <td>
                      <Badge tone={booster.origin === "shop" ? "warn" : "neutral"}>
                        {booster.origin}
                      </Badge>
                    </td>
                    <td className="tabular">{num(booster.owned)}</td>
                  </tr>
                ))
              )}
            </TBody>
          </Table>
        )}
      </Panel>

      <Panel>
        <PanelHeader>
          <PanelTitle className="flex items-center gap-2">
            <Trophy className="size-4 text-accent" />
            Weekly leaderboard snapshots
          </PanelTitle>
        </PanelHeader>
        {snapshots.isLoading ? (
          <PanelBody>
            <Loading label="Reading snapshots" />
          </PanelBody>
        ) : (
          <Table>
            <THead>
              <tr>
                <th>Week</th>
                <th>Rank</th>
                <th>Player</th>
                <th>Wins</th>
                <th>XP</th>
                <th>Captured</th>
              </tr>
            </THead>
            <TBody>
              {(snapshots.data ?? []).length === 0 ? (
                <Empty colSpan={6}>
                  No snapshot yet — the weekly leaderboard job writes one each Monday.
                </Empty>
              ) : (
                (snapshots.data ?? []).map((entry) => (
                  <tr key={entry.id}>
                    <td className="font-mono text-xs text-muted-foreground">
                      {entry.weekStart}
                    </td>
                    <td className="tabular font-medium">#{entry.rank}</td>
                    <td>{entry.username}</td>
                    <td className="tabular">{num(entry.wins)}</td>
                    <td className="tabular text-muted-foreground">{num(entry.xp)}</td>
                    <td className="text-muted-foreground">{dateTime(entry.createdAt)}</td>
                  </tr>
                ))
              )}
            </TBody>
          </Table>
        )}
      </Panel>
    </div>
  );
}
