import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";
import type { Rarity } from "@/lib/format";

const badgeVariants = cva(
  "inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-[11px] font-medium uppercase tracking-wider whitespace-nowrap",
  {
    variants: {
      tone: {
        neutral: "border-border bg-secondary text-muted-foreground",
        live: "border-primary/40 bg-primary/15 text-primary",
        warn: "border-accent/40 bg-accent/15 text-accent",
        bad: "border-destructive/40 bg-destructive/15 text-destructive",
        info: "border-chart-2/40 bg-chart-2/15 text-chart-2",
        epic: "border-chart-4/40 bg-chart-4/15 text-chart-4",
      },
    },
    defaultVariants: { tone: "neutral" },
  },
);

type Tone = NonNullable<VariantProps<typeof badgeVariants>["tone"]>;

function Badge({
  className,
  tone,
  ...props
}: React.ComponentProps<"span"> & VariantProps<typeof badgeVariants>) {
  return (
    <span data-slot="badge" className={cn(badgeVariants({ tone, className }))} {...props} />
  );
}

const RARITY_TONE: Record<Rarity, Tone> = {
  common: "neutral",
  uncommon: "info",
  rare: "live",
  epic: "epic",
  legendary: "warn",
};

/** Rarity coding is shared by boosters, avatars, spawns and listings. */
function RarityBadge({ rarity, className }: { rarity: string; className?: string }) {
  const tone = RARITY_TONE[rarity as Rarity] ?? "neutral";
  return (
    <Badge tone={tone} className={className}>
      {rarity}
    </Badge>
  );
}

const STATUS_TONE: Record<string, Tone> = {
  ok: "live",
  active: "live",
  running: "info",
  waiting: "warn",
  due: "warn",
  sold: "info",
  finished: "neutral",
  cancelled: "neutral",
  error: "bad",
};

function StatusBadge({ status, className }: { status: string | null; className?: string }) {
  if (!status) return <Badge className={className}>—</Badge>;
  return (
    <Badge tone={STATUS_TONE[status] ?? "neutral"} className={className}>
      {status}
    </Badge>
  );
}

export { Badge, RarityBadge, StatusBadge, badgeVariants };
