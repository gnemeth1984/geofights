import { useState } from "react";
import { Coins, Loader2, Search, ShieldHalf, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/input";
import { Panel, PanelBody, PanelHeader, PanelTitle } from "@/components/ui/panel";
import { Badge } from "@/components/ui/badge";
import { Empty, IdCell, Table, TBody, THead } from "@/components/ui/table";
import { ErrorNote, Loading } from "@/components/admin/state";
import {
  useGenerateAvatar,
  useGrantCurrency,
  usePlayers,
  useSetRole,
} from "@/queries/admin";
import { RARITIES, type Rarity, coins, num, relative } from "@/lib/format";

/**
 * Player administration: search, role changes, currency adjustments and
 * minting an avatar into someone's roster (useful for support cases and for
 * seeding a device before a field test).
 */
export function PlayersTab() {
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const players = usePlayers(search);
  const setRole = useSetRole();
  const grant = useGrantCurrency();
  const generateAvatar = useGenerateAvatar();

  const [amount, setAmount] = useState("500");
  const [rarity, setRarity] = useState("");
  const [theme, setTheme] = useState("");

  const rows = players.data ?? [];
  const active = rows.find((row) => row.id === selected) ?? null;

  return (
    <div className="space-y-6">
      <Panel>
        <PanelHeader>
          <PanelTitle>Players</PanelTitle>
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search username"
              className="w-56 pl-8"
            />
          </div>
        </PanelHeader>
        {players.isLoading ? (
          <PanelBody>
            <Loading label="Loading players" />
          </PanelBody>
        ) : players.isError ? (
          <PanelBody>
            <ErrorNote error={players.error} />
          </PanelBody>
        ) : (
          <Table>
            <THead>
              <tr>
                <th>Player</th>
                <th>Role</th>
                <th>Level</th>
                <th>W / L</th>
                <th>Currency</th>
                <th>Last seen</th>
                <th>Id</th>
              </tr>
            </THead>
            <TBody>
              {rows.length === 0 ? (
                <Empty colSpan={7}>No players match.</Empty>
              ) : (
                rows.map((player) => (
                  <tr
                    key={player.id}
                    onClick={() => setSelected(player.id)}
                    className={
                      selected === player.id
                        ? "cursor-pointer bg-primary/10"
                        : "cursor-pointer"
                    }
                  >
                    <td className="font-medium">{player.username}</td>
                    <td>
                      {player.role === "admin" ? (
                        <Badge tone="live">admin</Badge>
                      ) : (
                        <Badge>player</Badge>
                      )}
                    </td>
                    <td className="tabular">
                      {player.level}
                      <span className="ml-1 text-xs text-muted-foreground">
                        {num(player.xp)} xp
                      </span>
                    </td>
                    <td className="tabular">
                      {player.wins} / {player.losses}
                    </td>
                    <td className="tabular">{coins(player.currency)}</td>
                    <td className="text-muted-foreground">{relative(player.lastSeenAt)}</td>
                    <td>
                      <IdCell value={player.id} />
                    </td>
                  </tr>
                ))
              )}
            </TBody>
          </Table>
        )}
      </Panel>

      <Panel>
        <PanelHeader>
          <PanelTitle>Actions</PanelTitle>
          <span className="text-xs text-muted-foreground">
            {active ? `Selected: ${active.username}` : "Select a player above"}
          </span>
        </PanelHeader>
        <PanelBody className="grid gap-6 md:grid-cols-3">
          <div className="space-y-2">
            <p className="flex items-center gap-2 text-sm font-medium">
              <Coins className="size-4 text-accent" />
              Adjust currency
            </p>
            <div className="flex gap-2">
              <Input
                type="number"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                className="w-28"
              />
              <Button
                variant="outline"
                disabled={!active || grant.isPending}
                onClick={() =>
                  active &&
                  grant.mutate({ playerId: active.id, amount: Number(amount) || 0 })
                }
              >
                {grant.isPending ? <Loader2 className="size-4 animate-spin" /> : null}
                Apply
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              Writes an <span className="font-mono">admin_grant</span> row to the ledger.
              Negative values claw currency back.
            </p>
            <ErrorNote error={grant.error} />
          </div>

          <div className="space-y-2">
            <p className="flex items-center gap-2 text-sm font-medium">
              <ShieldHalf className="size-4 text-primary" />
              Role
            </p>
            <div className="flex gap-2">
              <Button
                variant="outline"
                disabled={!active || setRole.isPending}
                onClick={() => active && setRole.mutate({ playerId: active.id, role: "admin" })}
              >
                Promote
              </Button>
              <Button
                variant="outline"
                disabled={!active || setRole.isPending}
                onClick={() => active && setRole.mutate({ playerId: active.id, role: "player" })}
              >
                Demote
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              Console access is gated on this role server-side.
            </p>
            <ErrorNote error={setRole.error} />
          </div>

          <div className="space-y-2">
            <p className="flex items-center gap-2 text-sm font-medium">
              <Sparkles className="size-4 text-chart-4" />
              Mint avatar
            </p>
            <div className="flex flex-wrap gap-2">
              <Select value={rarity} onChange={(e) => setRarity(e.target.value)}>
                <option value="">roll rarity</option>
                {RARITIES.map((value) => (
                  <option key={value} value={value}>
                    {value}
                  </option>
                ))}
              </Select>
              <Input
                value={theme}
                onChange={(e) => setTheme(e.target.value)}
                placeholder="theme (optional)"
                className="w-40"
              />
              <Button
                variant="outline"
                disabled={!active || generateAvatar.isPending}
                onClick={() =>
                  active &&
                  generateAvatar.mutate({
                    playerId: active.id,
                    rarity: rarity ? (rarity as Rarity) : undefined,
                    theme: theme || undefined,
                  })
                }
              >
                {generateAvatar.isPending ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : null}
                Generate
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              Respects the 3-slot roster cap; calls the AI engine for name, lore and ability.
            </p>
            <ErrorNote error={generateAvatar.error} />
            {generateAvatar.data ? (
              <p className="text-xs text-primary">
                Minted “{generateAvatar.data.name}” ({generateAvatar.data.rarity}).
              </p>
            ) : null}
          </div>
        </PanelBody>
      </Panel>
    </div>
  );
}
