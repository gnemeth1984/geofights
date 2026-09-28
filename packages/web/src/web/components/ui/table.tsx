import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * Dense data table for the console. Wrapped in its own scroll container so a
 * wide row set never blows out the panel width.
 */
function Table({ className, ...props }: React.ComponentProps<"table">) {
  return (
    <div className="w-full overflow-x-auto">
      <table
        data-slot="table"
        className={cn("w-full caption-bottom border-collapse text-sm", className)}
        {...props}
      />
    </div>
  );
}

function THead({ className, ...props }: React.ComponentProps<"thead">) {
  return (
    <thead
      className={cn(
        "[&_th]:border-b [&_th]:border-border [&_th]:px-3 [&_th]:py-2 [&_th]:text-left",
        "[&_th]:text-[11px] [&_th]:font-semibold [&_th]:uppercase [&_th]:tracking-[0.14em]",
        "[&_th]:text-muted-foreground",
        className,
      )}
      {...props}
    />
  );
}

function TBody({ className, ...props }: React.ComponentProps<"tbody">) {
  return (
    <tbody
      className={cn(
        "[&_td]:border-b [&_td]:border-border/60 [&_td]:px-3 [&_td]:py-2 [&_td]:align-middle",
        "[&_tr:hover]:bg-secondary/40 [&_tr:last-child_td]:border-0",
        className,
      )}
      {...props}
    />
  );
}

/** Monospaced, truncated id cell — ids are long and rarely read in full. */
function IdCell({ value, className }: { value: string | null; className?: string }) {
  if (!value) return <span className="text-muted-foreground">—</span>;
  return (
    <span
      title={value}
      className={cn("font-mono text-xs text-muted-foreground", className)}
    >
      {value.length > 14 ? `${value.slice(0, 14)}…` : value}
    </span>
  );
}

function Empty({ children, colSpan }: { children: React.ReactNode; colSpan: number }) {
  return (
    <tr>
      <td colSpan={colSpan} className="py-8 text-center text-sm text-muted-foreground">
        {children}
      </td>
    </tr>
  );
}

export { Table, THead, TBody, IdCell, Empty };
