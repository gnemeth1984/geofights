import { cn } from "@/lib/utils";

/** Instrument readout: small caps label over a big tabular number. */
export function Stat({
  label,
  value,
  hint,
  tone = "default",
  className,
}: {
  label: string;
  value: string | number;
  hint?: string;
  tone?: "default" | "live" | "warn";
  className?: string;
}) {
  return (
    <div
      className={cn(
        "rounded-lg border border-border bg-card/70 px-4 py-3",
        tone === "live" && "border-primary/35 bg-primary/8",
        tone === "warn" && "border-accent/35 bg-accent/8",
        className,
      )}
    >
      <div className="text-[10px] font-medium uppercase tracking-[0.16em] text-muted-foreground">
        {label}
      </div>
      <div
        className={cn(
          "tabular mt-1 font-display text-2xl font-semibold leading-none",
          tone === "live" && "text-primary",
          tone === "warn" && "text-accent",
        )}
      >
        {value}
      </div>
      {hint ? <div className="mt-1 text-xs text-muted-foreground">{hint}</div> : null}
    </div>
  );
}
