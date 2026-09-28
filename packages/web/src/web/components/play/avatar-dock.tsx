import { Bot, Loader2, Sparkles, Swords, Trash2 } from "lucide-react";
import { useState } from "react";
import { Badge, RarityBadge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * Pre-match dock: pick the character you are bringing, then matchmake.
 *
 * Selecting an avatar is also what puts a character in the AR scene, so this runs
 * before any match exists — the player sees what they are about to fight with
 * standing on their floor.
 */

export type DockAvatar = {
  id: string;
  name: string;
  modelId: string;
  rarity: string;
  /**
   * The generated body, as the server stored it. Characters made before the
   * form column existed carry none, and the scene derives a stable one from
   * their `modelId` instead.
   */
  form?: string | null;
  attack: number;
  defense: number;
  speed: number;
  health: number;
  specialAbility: string;
};

export function AvatarDock({
  avatars,
  loading,
  selectedId,
  onSelect,
  onGenerate,
  generating,
  onRelease,
  releasingId,
  onQuickMatch,
  matching,
  blockedReason,
  maxAvatars,
}: {
  avatars: DockAvatar[];
  loading: boolean;
  selectedId: string | null;
  onSelect: (id: string) => void;
  onGenerate: () => void;
  generating: boolean;
  onRelease: (id: string) => void;
  releasingId: string | null;
  onQuickMatch: () => void;
  matching: boolean;
  blockedReason: string | null;
  maxAvatars?: number;
}) {
  // Release is destructive and the slot cap makes it a button players reach for
  // under pressure, so it arms on the first tap and fires on the second.
  const [armedId, setArmedId] = useState<string | null>(null);
  const full = typeof maxAvatars === "number" && avatars.length >= maxAvatars;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <div className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">
          Your squad
          {typeof maxAvatars === "number" && (
            <span className="ml-1.5 font-mono tracking-normal normal-case">
              {avatars.length}/{maxAvatars}
            </span>
          )}
        </div>
        <Button size="sm" variant="ghost" onClick={onGenerate} disabled={generating || full}>
          {generating ? <Loader2 className="size-4 animate-spin" /> : <Sparkles className="size-4" />}
          {generating ? "Forging…" : full ? "Squad full" : "New character"}
        </Button>
      </div>

      {loading ? (
        <div className="text-xs text-muted-foreground">Loading your characters…</div>
      ) : avatars.length === 0 ? (
        <div className="rounded-md border border-border bg-secondary/40 p-3 text-xs text-muted-foreground">
          No characters yet. Forge one — stats and a special ability are generated for you.
        </div>
      ) : (
        <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1">
          {avatars.map((avatar) => (
            <div key={avatar.id} className="relative min-w-[9.5rem] shrink-0">
              <button
                type="button"
                onClick={() => onSelect(avatar.id)}
                className={cn(
                  "w-full rounded-md border p-2.5 text-left transition-colors",
                  selectedId === avatar.id
                    ? "border-primary/60 bg-primary/10"
                    : "border-border bg-background/60 hover:bg-secondary/60",
                )}
              >
                <div className="flex items-center gap-1.5 pr-6">
                  <Bot className="size-3.5 text-primary" />
                  <span className="truncate text-sm font-medium">{avatar.name}</span>
                </div>
                <div className="mt-1.5 flex items-center gap-1">
                  <RarityBadge rarity={avatar.rarity} />
                </div>
                <div className="mt-1.5 font-mono text-[11px] text-muted-foreground">
                  {avatar.attack} atk · {avatar.defense} def · {avatar.health} hp
                </div>
                <div className="mt-0.5 truncate text-[11px] text-muted-foreground">
                  {avatar.specialAbility}
                </div>
              </button>

              <button
                type="button"
                aria-label={armedId === avatar.id ? `Confirm release of ${avatar.name}` : `Release ${avatar.name}`}
                title={armedId === avatar.id ? "Tap again to release" : "Release this character"}
                disabled={releasingId === avatar.id}
                onClick={() => {
                  if (armedId === avatar.id) {
                    setArmedId(null);
                    onRelease(avatar.id);
                    return;
                  }
                  setArmedId(avatar.id);
                }}
                onBlur={() => setArmedId((id) => (id === avatar.id ? null : id))}
                className={cn(
                  "absolute right-1 top-1 rounded p-1 text-muted-foreground transition-colors",
                  "hover:bg-destructive/15 hover:text-destructive disabled:opacity-50",
                  armedId === avatar.id && "bg-destructive/15 text-destructive",
                )}
              >
                {releasingId === avatar.id ? (
                  <Loader2 className="size-3.5 animate-spin" />
                ) : (
                  <Trash2 className="size-3.5" />
                )}
              </button>

              {armedId === avatar.id && releasingId !== avatar.id && (
                <div className="absolute inset-x-1 bottom-1 rounded bg-destructive/90 px-1.5 py-0.5 text-center text-[10px] font-medium text-destructive-foreground">
                  Tap bin again to release
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" onClick={onQuickMatch} disabled={!selectedId || matching || Boolean(blockedReason)}>
          {matching ? <Loader2 className="size-4 animate-spin" /> : <Swords className="size-4" />}
          {matching ? "Finding a match…" : "Quick match"}
        </Button>
        {blockedReason && <Badge tone="bad">{blockedReason}</Badge>}
      </div>
    </div>
  );
}
