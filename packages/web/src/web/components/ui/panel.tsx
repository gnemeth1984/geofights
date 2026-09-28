import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * Console surfaces. `Panel` is the instrument-panel card used across the admin
 * tabs and the public overview page: hairline border, flat fill, no shadow.
 */
function Panel({ className, ...props }: React.ComponentProps<"section">) {
  return (
    <section
      data-slot="panel"
      className={cn("rounded-lg border border-border bg-card/70 backdrop-blur-sm", className)}
      {...props}
    />
  );
}

function PanelHeader({ className, ...props }: React.ComponentProps<"header">) {
  return (
    <header
      data-slot="panel-header"
      className={cn(
        "flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-3",
        className,
      )}
      {...props}
    />
  );
}

function PanelTitle({ className, children, ...props }: React.ComponentProps<"h3">) {
  return (
    <h3
      data-slot="panel-title"
      className={cn("text-sm font-semibold uppercase tracking-[0.14em]", className)}
      {...props}
    >
      {children}
    </h3>
  );
}

function PanelBody({ className, ...props }: React.ComponentProps<"div">) {
  return <div data-slot="panel-body" className={cn("p-4", className)} {...props} />;
}

export { Panel, PanelHeader, PanelTitle, PanelBody };
