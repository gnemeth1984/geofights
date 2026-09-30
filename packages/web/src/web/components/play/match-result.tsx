import { Gift, LogOut, PackageMinus, PackagePlus, Skull, Swords, Trophy } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { HudPlayer } from "@/components/play/battle-hud";

/**
 * Post-match result.
 *
 * The engine already decides the winner, tallies damage and writes the match
 * summary when the last character goes down; until this existed none of that
 * reached the player — the HUD simply switched its badge to "finished" and left
 * the attack button dead, with no statement of who won. Everything here is the
 * server's own record of the match, including `summary`, which the AI writes
 * once at finish time.
 */

export type ResultPlayer = HudPlayer & { damageDealt: number; damageTaken: number };

/** What the fight cost — one row per loser, from services/stakes.ts. */
export type ResultForfeit = {
  kind: "spoils" | "bounty";
  winnerPlayerId: string;
  loserPlayerId: string;
  lostLevel: number | null;
  boosterName: string;
  rarity: string;
};

export function MatchResult({
  players,
  winnerPlayerId,
  myPlayerId,
  summary,
  forfeits = [],
  onLeave,
  pending,
}: {
  players: ResultPlayer[];
  forfeits?: ResultForfeit[];
  winnerPlayerId: string | null;
  myPlayerId: string | null;
  summary: string | null;
  onLeave: () => void;
  pending: boolean;
}) {
  const won = Boolean(winnerPlayerId && myPlayerId && winnerPlayerId === myPlayerId);
  const winner = players.find((player) => player.playerId === winnerPlayerId) ?? null;
  // Damage order, not health order: a character that went down swinging outranks
  // one that survived by hiding.
  const ranked = [...players].sort((a, b) => b.damageDealt - a.damageDealt);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone={won ? "live" : "neutral"}>{won ? "victory" : winner ? "defeat" : "match over"}</Badge>
        {winner && (
          <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground">
            <Trophy className="size-3" />
            {winner.username} · {winner.avatarName}
          </span>
        )}
      </div>

      <div
        className={cn(
          "rounded-md border px-3 py-2",
          won ? "border-primary/50 bg-primary/10" : "border-border bg-muted/40",
        )}
      >
        <div className="text-sm font-semibold">
          {won ? "You took the field." : winner ? `${winner.username} took the field.` : "The match ended."}
        </div>
        {summary && (
          <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">{summary}</p>
        )}
      </div>

      <Stakes forfeits={forfeits} myPlayerId={myPlayerId} />

      <div className="space-y-1">
        {ranked.map((player) => (
          <div
            key={player.playerId}
            className={cn(
              "flex items-center gap-2 rounded-md border border-border px-2 py-1.5 font-mono text-[11px]",
              player.playerId === myPlayerId && "border-primary/40",
            )}
          >
            <span className="truncate font-sans">
              {player.username}
              <span className="text-muted-foreground"> · {player.avatarName}</span>
            </span>
            {player.playerId === winnerPlayerId ? (
              <Trophy className="size-3 shrink-0 text-primary" />
            ) : (
              !player.alive && <Skull className="size-3 shrink-0 text-muted-foreground" />
            )}
            <span className="ml-auto inline-flex items-center gap-1 text-muted-foreground">
              <Swords className="size-3" />
              {player.damageDealt} dealt
            </span>
            <span className="text-muted-foreground">
              {player.kills} {player.kills === 1 ? "kill" : "kills"}
            </span>
          </div>
        ))}
      </div>

      <Button size="sm" variant="outline" className="w-full" onClick={onLeave} disabled={pending}>
        <LogOut className="size-4" />
        Back to base
      </Button>
    </div>
  );
}

/**
 * The stakes line. Losing costs a booster off the avatar that fought, and the
 * winner walks away with a fresh copy — so both halves of the result have to
 * say what moved, and the winner needs to know it can equip or sell it.
 */
function Stakes({ forfeits, myPlayerId }: { forfeits: ResultForfeit[]; myPlayerId: string | null }) {
  const mine = forfeits.filter((f) => f.winnerPlayerId === myPlayerId || f.loserPlayerId === myPlayerId);
  if (mine.length === 0) return null;
  return (
    <div className="space-y-1.5">
      {mine.map((f) => {
        const iWon = f.winnerPlayerId === myPlayerId;
        const Icon = iWon ? (f.kind === "bounty" ? Gift : PackagePlus) : PackageMinus;
        const line = iWon
          ? f.kind === "spoils"
            ? `You took ${f.boosterName} off them.`
            : `Bounty: ${f.boosterName}. They had nothing equipped to lose.`
          : `You lost ${f.boosterName}${f.lostLevel ? ` (lv ${f.lostLevel})` : ""}. Win it back.`;
        return (
          <div
            key={`${f.winnerPlayerId}:${f.loserPlayerId}`}
            className={cn(
              "flex items-start gap-2 rounded-md border px-3 py-2 text-xs",
              iWon ? "border-primary/50 bg-primary/10" : "border-destructive/50 bg-destructive/10",
            )}
          >
            <Icon className={cn("mt-0.5 size-4 shrink-0", iWon ? "text-primary" : "text-destructive")} />
            <div className="min-w-0">
              <div className="font-semibold">{line}</div>
              {iWon && (
                <div className="mt-0.5 text-[11px] text-muted-foreground">
                  {f.rarity} · it's in your loadout list: equip it, or sell it in the Market.
                </div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
