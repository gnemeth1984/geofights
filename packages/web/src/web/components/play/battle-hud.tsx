import { Crosshair, Heart, LogOut, Pause, Play, Sparkles, Users } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { metres } from "@/lib/geo";

/**
 * Combat HUD.
 *
 * Every number shown is the server's. Cooldowns are rendered from
 * `attackReadyInMs` / `abilityReadyInMs` as the server last reported them, and
 * the attack button is disabled on the same conditions the engine enforces —
 * out of range, on cooldown, target down, or movement/safety pause. A player
 * should never press a button that the server is going to refuse.
 */

export type HudAbility = { id: string; name: string; effect: string; damage: number; cooldownSeconds: number };

export type HudPlayer = {
  playerId: string;
  username: string;
  avatarName: string;
  health: number;
  maxHealth: number;
  alive: boolean;
  kills: number;
};

export type HudMovement = { moving: boolean; settling: boolean; paused: boolean; resumeInMs: number };

/**
 * Who has joined, before the match starts. Battle stats do not exist yet at
 * this point — `players` is empty until the host hits Start — so the lobby is
 * the only roster there is to show.
 */
export type HudLobbyEntry = {
  playerId: string;
  username: string;
  avatarName: string | null;
  isHost: boolean;
};

export function BattleHud({
  status,
  isHost,
  me,
  players,
  lobby,
  distances,
  pausedRemote,
  movement,
  attackRangeM,
  abilities,
  attackReadyInMs,
  abilityReadyInMs,
  onStart,
  onAttack,
  onAbility,
  onLeave,
  pending,
  note,
}: {
  status: string;
  isHost: boolean;
  me: HudPlayer | null;
  players: HudPlayer[];
  lobby: HudLobbyEntry[];
  distances: Record<string, number | null>;
  pausedRemote: Record<string, boolean>;
  movement: HudMovement | null;
  attackRangeM: number;
  abilities: HudAbility[];
  attackReadyInMs: number;
  abilityReadyInMs: number;
  onStart: () => void;
  onAttack: (targetPlayerId: string) => void;
  onAbility: (abilityId: string, targetPlayerId?: string) => void;
  onLeave: () => void;
  pending: boolean;
  note: string | null;
}) {
  const opponents = players.filter((player) => player.playerId !== me?.playerId);
  const combatBlocked = !me?.alive || Boolean(movement?.paused);
  const ability = abilities[0] ?? null;
  const waiting = status === "waiting";
  const roster = waiting ? lobby : [];

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone={status === "active" ? "live" : status === "waiting" ? "warn" : "neutral"}>
          {status}
        </Badge>
        <Badge tone="neutral">
          <Users className="size-3" />
          {waiting ? `${lobby.length} in lobby` : `${players.length} in match`}
        </Badge>
        {movement?.paused && (
          <Badge tone="warn">
            <Pause className="size-3" />
            combat paused · {Math.ceil(movement.resumeInMs / 1000)}s
          </Badge>
        )}
        <div className="ml-auto flex gap-2">
          {status === "waiting" && isHost && (
            <Button size="sm" onClick={onStart} disabled={pending}>
              <Play className="size-4" />
              Start
            </Button>
          )}
          <Button size="sm" variant="ghost" onClick={onLeave} disabled={pending}>
            <LogOut className="size-4" />
            Leave
          </Button>
        </div>
      </div>

      {me && (
        <div>
          <div className="flex items-center justify-between text-[11px] uppercase tracking-[0.14em] text-muted-foreground">
            <span className="inline-flex items-center gap-1">
              <Heart className="size-3 text-destructive" />
              {me.avatarName}
            </span>
            <span className="font-mono">
              {me.health}/{me.maxHealth}
            </span>
          </div>
          <div className="mt-1 h-2 overflow-hidden rounded-full bg-secondary">
            <div
              className={cn(
                "h-full rounded-full transition-[width] duration-300",
                me.health / me.maxHealth > 0.5
                  ? "bg-primary"
                  : me.health / me.maxHealth > 0.25
                    ? "bg-accent"
                    : "bg-destructive",
              )}
              style={{ width: `${Math.max(0, (me.health / me.maxHealth) * 100)}%` }}
            />
          </div>
        </div>
      )}

      {movement?.paused && (
        <div className="rounded-md border border-accent/50 bg-accent/10 px-3 py-2 text-[11px] leading-relaxed text-accent">
          Come to a stop to battle. You can walk around while exploring.
        </div>
      )}

      {waiting && (
        <div className="space-y-1.5">
          {roster.map((entry) => (
            <div
              key={entry.playerId}
              className="flex items-center gap-2 rounded-md border border-border bg-background/60 px-2.5 py-2 text-sm"
            >
              <span className="truncate font-medium">{entry.avatarName ?? entry.username}</span>
              {entry.isHost && <Badge tone="neutral">host</Badge>}
              <span className="ml-auto truncate font-mono text-[11px] text-muted-foreground">
                {entry.username}
              </span>
            </div>
          ))}
          <div className="text-xs text-muted-foreground">
            {roster.length < 2
              ? "Waiting for another player to join this lobby."
              : isHost
                ? "Everyone is here — hit Start when you are ready."
                : "Waiting for the host to start the match."}
          </div>
        </div>
      )}

      <div className="space-y-2">
        {!waiting && opponents.length === 0 && (
          <div className="text-xs text-muted-foreground">No opponents left in this match.</div>
        )}
        {opponents.map((opponent) => {
          const distance = distances[opponent.playerId] ?? null;
          const inRange = distance != null && distance <= attackRangeM;
          const cooling = attackReadyInMs > 0;
          return (
            <div
              key={opponent.playerId}
              className="flex items-center gap-2 rounded-md border border-border bg-background/60 px-2.5 py-2"
            >
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5">
                  <span className="truncate text-sm font-medium">{opponent.avatarName}</span>
                  {!opponent.alive && <Badge tone="bad">down</Badge>}
                  {pausedRemote[opponent.playerId] && <Badge tone="warn">paused</Badge>}
                </div>
                <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-secondary">
                  <div
                    className="h-full rounded-full bg-destructive/80"
                    style={{ width: `${Math.max(0, (opponent.health / opponent.maxHealth) * 100)}%` }}
                  />
                </div>
                <div className="mt-1 font-mono text-[11px] text-muted-foreground">
                  {opponent.username} · {distance == null ? "range unknown" : metres(distance)}
                  {distance != null && !inRange ? ` · out of range (${attackRangeM} m)` : ""}
                </div>
              </div>
              <Button
                size="sm"
                variant={inRange && !combatBlocked ? "default" : "outline"}
                disabled={
                  pending ||
                  status !== "active" ||
                  combatBlocked ||
                  !opponent.alive ||
                  !inRange ||
                  cooling
                }
                onClick={() => onAttack(opponent.playerId)}
              >
                <Crosshair className="size-4" />
                {cooling ? `${Math.ceil(attackReadyInMs / 1000)}s` : "Attack"}
              </Button>
            </div>
          );
        })}
      </div>

      {ability && (
        <Button
          size="sm"
          variant="secondary"
          className="w-full"
          disabled={pending || status !== "active" || combatBlocked || abilityReadyInMs > 0}
          onClick={() => onAbility(ability.id, opponents.find((o) => o.alive)?.playerId)}
        >
          <Sparkles className="size-4" />
          {abilityReadyInMs > 0
            ? `${ability.name} · ${Math.ceil(abilityReadyInMs / 1000)}s`
            : `${ability.name} · ${ability.effect}`}
        </Button>
      )}

      {note && <div className="text-[11px] text-destructive">{note}</div>}
    </div>
  );
}
