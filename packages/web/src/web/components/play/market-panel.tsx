import * as React from "react";
import { ChevronDown, Loader2, ShoppingCart, Store, Tag, X } from "lucide-react";
import { RarityBadge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  useMarketBrowse,
  useMarketBuy,
  useMarketCancel,
  useMarketConfig,
  useMarketSell,
  useMarketSellable,
  useMyListings,
} from "@/queries/market";

/**
 * The market, from the player's side.
 *
 * Fights and park drops both hand out boosters, and a winner walks away with a
 * copy of whatever the loser had equipped — this is where the ones they do not
 * want become currency. Fixed prices, a house fee on every sale, and a listed
 * booster is held off the avatar until it sells or is pulled.
 *
 * Self-contained on purpose: its queries only run while it is open, so a camera
 * screen never polls the market in the background.
 */

type Tab = "buy" | "sell" | "mine";

function errorText(error: unknown) {
  return error instanceof Error ? error.message : error ? "Something went wrong" : null;
}

export function MarketPanel({ myPlayerId, currency }: { myPlayerId: string | null; currency: number | null }) {
  const [open, setOpen] = React.useState(false);
  const [tab, setTab] = React.useState<Tab>("buy");

  return (
    <div className="rounded-lg border border-border bg-background/60">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2 px-3 py-2 text-left"
      >
        <Store className="size-4 text-primary" />
        <span className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">
          Market
        </span>
        <span className="font-mono text-[11px] text-muted-foreground">buy · sell spoils</span>
        <ChevronDown
          className={cn("ml-auto size-4 text-muted-foreground transition-transform", open && "rotate-180")}
        />
      </button>

      {open && (
        <div className="space-y-3 border-t border-border p-3">
          <div className="flex items-center gap-1">
            {(["buy", "sell", "mine"] as const).map((key) => (
              <Button
                key={key}
                size="sm"
                variant={tab === key ? "default" : "ghost"}
                className="h-7 px-2.5 text-[11px]"
                onClick={() => setTab(key)}
              >
                {key === "buy" ? "Buy" : key === "sell" ? "Sell" : "My listings"}
              </Button>
            ))}
            {typeof currency === "number" && (
              <span className="ml-auto font-mono text-[11px] text-muted-foreground">{currency} cr</span>
            )}
          </div>
          {tab === "buy" && <BuyTab myPlayerId={myPlayerId} currency={currency} />}
          {tab === "sell" && <SellTab />}
          {tab === "mine" && <MineTab />}
        </div>
      )}
    </div>
  );
}

function BuyTab({ myPlayerId, currency }: { myPlayerId: string | null; currency: number | null }) {
  const listings = useMarketBrowse(true);
  const buy = useMarketBuy();
  const rows = (listings.data ?? []).filter((row) => row.sellerId !== myPlayerId);

  if (listings.isLoading) return <Loading />;
  if (rows.length === 0) {
    return <Empty>Nothing for sale right now. Win a fight and be the first to list.</Empty>;
  }
  return (
    <div className="space-y-1.5">
      {rows.map((row) => {
        const busy = buy.isPending && buy.variables?.listingId === row.id;
        const affordable = typeof currency !== "number" || currency >= row.price;
        return (
          <div key={row.id} className="flex items-center gap-2 rounded-md border border-border px-2 py-1.5">
            <RarityBadge rarity={row.itemRarity} />
            <div className="min-w-0 flex-1">
              <div className="truncate text-xs font-medium">{row.itemName}</div>
              <div className="truncate text-[10px] text-muted-foreground">from {row.sellerName ?? "someone"}</div>
            </div>
            <Button
              size="sm"
              variant="outline"
              className="h-7 px-2 text-[11px]"
              disabled={busy || !affordable}
              onClick={() => buy.mutate({ listingId: row.id })}
            >
              {busy ? <Loader2 className="size-3.5 animate-spin" /> : <ShoppingCart className="size-3.5" />}
              {row.price} cr
            </Button>
          </div>
        );
      })}
      <ErrorLine error={buy.error} />
    </div>
  );
}

function SellTab() {
  const sellable = useMarketSellable(true);
  const config = useMarketConfig(true);
  const sell = useMarketSell();
  const [prices, setPrices] = React.useState<Record<string, string>>({});
  const boosters = sellable.data?.boosters ?? [];
  const feeRate = config.data?.feeRate ?? 0.1;
  const min = config.data?.minPrice ?? 1;
  const max = config.data?.maxPrice ?? 1_000_000;

  if (sellable.isLoading) return <Loading />;
  if (boosters.length === 0) {
    return <Empty>No boosters to sell. Collect them in parks or take them off opponents.</Empty>;
  }
  return (
    <div className="space-y-1.5">
      <div className="text-[11px] text-muted-foreground">
        Listing an equipped booster takes it off your character until it sells or you pull it.
        House fee {Math.round(feeRate * 100)}%.
      </div>
      {boosters.map((row) => {
        const raw = prices[row.itemId] ?? String(row.suggestedPrice);
        const price = Math.round(Number(raw));
        const valid = Number.isFinite(price) && price >= min && price <= max;
        const busy = sell.isPending && sell.variables?.itemId === row.itemId;
        return (
          <div key={row.itemId} className="flex items-center gap-2 rounded-md border border-border px-2 py-1.5">
            <RarityBadge rarity={row.rarity} />
            <div className="min-w-0 flex-1">
              <div className="truncate text-xs font-medium">{row.name}</div>
              <div className="text-[10px] text-muted-foreground">
                {row.equippedAvatarId ? "equipped" : "spare"}
                {valid ? ` · you get ${price - Math.round(price * feeRate)} cr` : ""}
              </div>
            </div>
            <input
              inputMode="numeric"
              aria-label={`Price for ${row.name}`}
              className="h-7 w-16 rounded-md border border-border bg-background px-1.5 text-right font-mono text-[11px]"
              value={raw}
              onChange={(e) => setPrices((p) => ({ ...p, [row.itemId]: e.target.value.replace(/[^0-9]/g, "") }))}
            />
            <Button
              size="sm"
              className="h-7 px-2 text-[11px]"
              disabled={!valid || busy}
              onClick={() => sell.mutate({ itemType: "booster", itemId: row.itemId, price })}
            >
              {busy ? <Loader2 className="size-3.5 animate-spin" /> : <Tag className="size-3.5" />}
              List
            </Button>
          </div>
        );
      })}
      <ErrorLine error={sell.error} />
    </div>
  );
}

function MineTab() {
  const mine = useMyListings(true);
  const cancel = useMarketCancel();
  const rows = (mine.data ?? []).filter((row) => row.status === "active");

  if (mine.isLoading) return <Loading />;
  if (rows.length === 0) return <Empty>Nothing listed.</Empty>;
  return (
    <div className="space-y-1.5">
      {rows.map((row) => {
        const busy = cancel.isPending && cancel.variables?.listingId === row.id;
        return (
          <div key={row.id} className="flex items-center gap-2 rounded-md border border-border px-2 py-1.5">
            <RarityBadge rarity={row.itemRarity} />
            <div className="min-w-0 flex-1">
              <div className="truncate text-xs font-medium">{row.itemName}</div>
              <div className="font-mono text-[10px] text-muted-foreground">
                {row.price} cr · you get {row.sellerReceives}
              </div>
            </div>
            <Button
              size="sm"
              variant="ghost"
              className="h-7 px-2 text-[11px]"
              disabled={busy}
              onClick={() => cancel.mutate({ listingId: row.id })}
            >
              {busy ? <Loader2 className="size-3.5 animate-spin" /> : <X className="size-3.5" />}
              Pull
            </Button>
          </div>
        );
      })}
      <ErrorLine error={cancel.error} />
    </div>
  );
}

function Loading() {
  return (
    <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
      <Loader2 className="size-3.5 animate-spin" /> Loading…
    </div>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <div className="text-[11px] text-muted-foreground">{children}</div>;
}

function ErrorLine({ error }: { error: unknown }) {
  const text = errorText(error);
  return text ? <div className="text-[11px] text-destructive">{text}</div> : null;
}
