import { Loader2, PackageOpen, X } from "lucide-react";
import { Badge, RarityBadge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { metres } from "@/lib/geo";

/**
 * Booster pickup. The client shows the distance the server reported and only
 * enables the button when the server said `inRange` — and even then the server
 * re-checks proximity and safety on collect, so this is a courtesy, not a gate.
 */

export type SpawnTarget = {
  id: string;
  zoneName: string | null;
  rarity: string;
  description: string | null;
  distanceM: number;
  collectRadiusM: number;
  inRange: boolean;
  booster: { name: string; rarity: string; tier: number; description: string };
};

export function CollectSheet({
  spawn,
  onCollect,
  onDismiss,
  pending,
  error,
  signedIn,
}: {
  spawn: SpawnTarget;
  onCollect: () => void;
  onDismiss: () => void;
  pending: boolean;
  error: string | null;
  signedIn: boolean;
}) {
  return (
    <div className="rounded-lg border border-primary/40 bg-background/92 p-3 backdrop-blur">
      <div className="flex items-start gap-2">
        <div className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-md border border-primary/40 bg-primary/10">
          <PackageOpen className="size-4 text-primary" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <span className="truncate text-sm font-medium">{spawn.booster.name}</span>
            <RarityBadge rarity={spawn.booster.rarity} />
            {spawn.booster.tier > 1 && <Badge tone="info">t{spawn.booster.tier}</Badge>}
          </div>
          <div className="mt-0.5 text-[11px] leading-relaxed text-muted-foreground">
            {spawn.booster.description}
          </div>
          <div className="mt-1 font-mono text-[11px] text-muted-foreground">
            {metres(spawn.distanceM)} away · reach within {spawn.collectRadiusM} m
            {spawn.zoneName ? ` · ${spawn.zoneName}` : ""}
          </div>
        </div>
        <Button size="icon-sm" variant="ghost" onClick={onDismiss} aria-label="Dismiss">
          <X className="size-4" />
        </Button>
      </div>
      {error && <div className="mt-2 text-[11px] text-destructive">{error}</div>}
      <Button
        size="sm"
        className="mt-2 w-full"
        disabled={pending || !spawn.inRange || !signedIn}
        onClick={onCollect}
      >
        {pending && <Loader2 className="size-4 animate-spin" />}
        {!signedIn
          ? "Sign in to collect"
          : spawn.inRange
            ? pending
              ? "Collecting…"
              : "Collect booster"
            : "Walk closer to collect"}
      </Button>
    </div>
  );
}
