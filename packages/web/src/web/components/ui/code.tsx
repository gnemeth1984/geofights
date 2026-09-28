import * as React from "react";
import { Check, Copy } from "lucide-react";
import { cn } from "@/lib/utils";

/** Copy-paste code sample. Plain <pre> — no highlighter, no runtime cost. */
export function CodeBlock({
  code,
  label,
  className,
}: {
  code: string;
  label?: string;
  className?: string;
}) {
  const [copied, setCopied] = React.useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard blocked — the text is selectable anyway */
    }
  }

  return (
    <div
      className={cn(
        "overflow-hidden rounded-lg border border-border bg-[oklch(0.14_0.015_255)]",
        className,
      )}
    >
      <div className="flex items-center justify-between gap-2 border-b border-border px-3 py-1.5">
        <span className="font-mono text-[11px] uppercase tracking-[0.14em] text-muted-foreground">
          {label ?? "shell"}
        </span>
        <button
          type="button"
          onClick={copy}
          className="flex items-center gap-1 text-[11px] text-muted-foreground transition-colors hover:text-primary"
        >
          {copied ? <Check className="size-3 text-primary" /> : <Copy className="size-3" />}
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
      <pre className="overflow-x-auto px-3 py-3 font-mono text-xs leading-relaxed text-foreground/90">
        <code>{code}</code>
      </pre>
    </div>
  );
}

/** Inline code — ids, field names, env vars. */
export function Mono({ children }: { children: React.ReactNode }) {
  return (
    <span className="rounded bg-secondary px-1 py-0.5 font-mono text-[0.85em] text-foreground">
      {children}
    </span>
  );
}
