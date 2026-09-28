import * as React from "react";
import { ChevronDown, Gift, Loader2, PackageOpen, Sparkles } from "lucide-react";
import { Badge, RarityBadge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * Booster packs and the loadout they feed.
 *
 * The marketplace sells packs, never single boosters: a pack tier rolls its
 * contents from a weighted rarity table server-side, so the client only shows
 * the odds and the reveal. Instances then level from 1 to 5 by battling and
 * exploring — that level is what the XP bars here track, and it is the same
 * number that scales ability power and animation intensity in the AR scene.
 */

export type PackOffer = {
  tier: string;
  name: string;
  price: number;
  size: number;
  guarantee: string;
  blurb: string;
  odds: Record<string, number>;
};

export type InventoryBooster = {
  id: string;
  level: number;
  xp: number;
  equippedAvatarId: string | null;
  acquiredVia: string;
  supersededAt: string | Date | null;
  booster: { name: string; rarity: string; tier: number; description: string };
};

export type PackReveal = {
  pack: { name: string };
  spent: number;
  contents: { instance: { id: string }; booster: { name: string; rarity: string } }[];
};

export function BoosterPanel({
  packs,
  inventory,
  currency,
  maxLevel,
  xpCurve,
  selectedAvatarId,
  maxEquipped,
  reveal,
  onBuyPack,
  buyingTier,
  onEquip,
  onUnequip,
  busyInstanceId,
  error,
}: {
  packs: PackOffer[];
  inventory: InventoryBooster[];
  currency: number | null;
  maxLevel: number;
  xpCurve: number[];
  selectedAvatarId: string | null;
  maxEquipped: number;
  reveal: PackReveal | null;
  onBuyPack: (tier: string) => void;
  buyingTier: string | null;
  onEquip: (instanceId: string) => void;
  onUnequip: (instanceId: string) => void;
  busyInstanceId: string | null;
  error: string | null;
}) {
  const [open, setOpen] = React.useState(false);

  const live = inventory.filter((row) => !row.supersededAt);
  const equipped = live.filter((row) => row.equippedAvatarId === selectedAvatarId && selectedAvatarId);
  const spare = live.filter((row) => row.equippedAvatarId !== selectedAvatarId || !selectedAvatarId);
  const loadoutLevel = equipped.reduce((max, row) => Math.max(max, row.level), 1);

  return (
    <div className="rounded-lg border border-border bg-background/60">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2 px-3 py-2 text-left"
      >
        <PackageOpen className="size-4 text-primary" />
        <span className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">
          Packs & loadout
        </span>
        <span className="font-mono text-[11px] text-muted-foreground">
          {live.length} owned
          {equipped.length > 0 ? ` · lv${loadoutLevel} equipped` : ""}
        </span>
        <ChevronDown
          className={cn("ml-auto size-4 text-muted-foreground transition-transform", open && "rotate-180")}
        />
      </button>

      {open && (
        <div className="space-y-3 border-t border-border p-3">
          {/* ---------------------------------------------------------- packs */}
          <div className="flex items-center justify-between gap-2">
            <div className="text-[11px] uppercase tracking-[0.14em] text-muted-foreground">
              Booster packs
            </div>
            {typeof currency === "number" && (
              <div className="font-mono text-[11px] text-muted-foreground">{currency} cr</div>
            )}
          </div>

          <div className="grid grid-cols-2 gap-2">
            {packs.map((pack) => {
              const affordable = typeof currency !== "number" || currency >= pack.price;
              const busy = buyingTier === pack.tier;
              return (
                <div
                  key={pack.tier}
                  className="flex flex-col rounded-md border border-border bg-secondary/30 p-2.5"
                >
                  <div className="flex items-center gap-1.5">
                    <span className="truncate text-sm font-medium">{pack.name}</span>
                    <RarityBadge rarity={pack.tier === "mythic" ? "legendary" : pack.tier} />
                  </div>
                  <div className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
                    {pack.blurb}
                  </div>
                  <div className="mt-1 font-mono text-[11px] text-muted-foreground">
                    {pack.size} boosters · {pack.guarantee}+ floor
                  </div>
                  <div className="mt-1 flex flex-wrap gap-1">
                    {Object.entries(pack.odds)
                      .filter(([, pct]) => pct > 0)
                      .map(([rarity, pct]) => (
                        <span
                          key={rarity}
                          className="font-mono text-[10px] text-muted-foreground"
                          title={`${pct}% per booster`}
                        >
                          {rarity.slice(0, 3)} {pct}%
                        </span>
                      ))}
                  </div>
                  <Button
                    size="sm"
                    className="mt-2 w-full"
                    variant={pack.tier === "mythic" ? "default" : "outline"}
                    disabled={busy || !affordable}
                    onClick={() => onBuyPack(pack.tier)}
                  >
                    {busy ? <Loader2 className="size-4 animate-spin" /> : <Gift className="size-4" />}
                    {busy ? "Opening…" : affordable ? `${pack.price} cr` : "Too pricey"}
                  </Button>
                </div>
              );
            })}
          </div>

          {error && <div className="text-[11px] text-destructive">{error}</div>}

          {reveal && (
            <div className="rounded-md border border-primary/40 bg-primary/5 p-2.5">
              <div className="flex items-center gap-1.5 text-xs font-medium">
                <Sparkles className="size-3.5 text-primary" />
                {reveal.pack.name} opened · {reveal.spent} cr
              </div>
              <div className="mt-1.5 space-y-1">
                {reveal.contents.map((entry) => (
                  <div key={entry.instance.id} className="flex items-center gap-1.5">
                    <RarityBadge rarity={entry.booster.rarity} />
                    <span className="truncate text-[11px]">{entry.booster.name}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* ------------------------------------------------------- loadout */}
          <div className="border-t border-border pt-2">
            <div className="text-[11px] uppercase tracking-[0.14em] text-muted-foreground">
              Equipped {selectedAvatarId ? `${equipped.length}/${maxEquipped}` : ""}
            </div>
            {!selectedAvatarId ? (
              <div className="mt-1 text-[11px] text-muted-foreground">
                Pick a character to manage its loadout.
              </div>
            ) : equipped.length === 0 ? (
              <div className="mt-1 text-[11px] text-muted-foreground">
                Nothing equipped — boosters only earn XP while they are bolted on.
              </div>
            ) : (
              <div className="mt-1.5 space-y-1.5">
                {equipped.map((row) => (
                  <BoosterRow
                    key={row.id}
                    row={row}
                    maxLevel={maxLevel}
                    xpCurve={xpCurve}
                    action="unequip"
                    busy={busyInstanceId === row.id}
                    onAction={() => onUnequip(row.id)}
                  />
                ))}
              </div>
            )}
          </div>

          {spare.length > 0 && (
            <div className="border-t border-border pt-2">
              <div className="text-[11px] uppercase tracking-[0.14em] text-muted-foreground">
                Inventory
              </div>
              <div className="mt-1.5 max-h-48 space-y-1.5 overflow-y-auto pr-1">
                {spare.map((row) => (
                  <BoosterRow
                    key={row.id}
                    row={row}
                    maxLevel={maxLevel}
                    xpCurve={xpCurve}
                    action="equip"
                    busy={busyInstanceId === row.id}
                    disabled={!selectedAvatarId || equipped.length >= maxEquipped}
                    onAction={() => onEquip(row.id)}
                  />
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function BoosterRow({
  row,
  maxLevel,
  xpCurve,
  action,
  onAction,
  busy,
  disabled,
}: {
  row: InventoryBooster;
  maxLevel: number;
  xpCurve: number[];
  action: "equip" | "unequip";
  onAction: () => void;
  busy: boolean;
  disabled?: boolean;
}) {
  const maxed = row.level >= maxLevel;
  const need = maxed ? null : (xpCurve[Math.max(0, row.level - 1)] ?? null);
  const pct = need ? Math.min(100, Math.round((row.xp / need) * 100)) : 100;

  return (
    <div className="rounded-md border border-border bg-background/60 p-2">
      <div className="flex items-center gap-1.5">
        <span className="truncate text-[12px] font-medium">{row.booster.name}</span>
        <RarityBadge rarity={row.booster.rarity} />
        {row.booster.tier > 1 && <Badge tone="info">t{row.booster.tier}</Badge>}
        <Badge tone={maxed ? "warn" : "live"}>lv{row.level}</Badge>
        <Button
          size="sm"
          variant="ghost"
          className="ml-auto shrink-0"
          disabled={busy || disabled}
          onClick={onAction}
        >
          {busy && <Loader2 className="size-4 animate-spin" />}
          {action === "equip" ? "Equip" : "Unequip"}
        </Button>
      </div>
      <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-secondary">
        <div
          className={cn("h-full rounded-full", maxed ? "bg-accent" : "bg-primary")}
          style={{ width: `${pct}%` }}
        />
      </div>
      <div className="mt-1 font-mono text-[10px] text-muted-foreground">
        {maxed ? "max level" : `${row.xp}/${need} xp to lv${row.level + 1}`}
      </div>
    </div>
  );
}
