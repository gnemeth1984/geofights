import * as React from "react";
import { Button } from "@/components/ui/button";
import { Loader2 } from "lucide-react";

export function errorText(error: unknown) {
  if (!error) return null;
  return error instanceof Error ? error.message : "Something went wrong";
}

/** Where `/add-friend` parks a scanned code until the player is signed in. */
export const PENDING_INVITE_KEY = "gf.pendingInvite";

export function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">{children}</div>
  );
}

export function Muted({ children }: { children: React.ReactNode }) {
  return <p className="text-[11px] leading-relaxed text-muted-foreground">{children}</p>;
}

export function ErrorLine({ error }: { error: unknown }) {
  const text = errorText(error);
  return text ? <p className="text-xs text-destructive">{text}</p> : null;
}

export function Spinner() {
  return <Loader2 className="size-4 animate-spin text-muted-foreground" />;
}

export function Row({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2 rounded-md border border-border bg-background/50 px-2 py-1.5 text-xs">
      {children}
    </div>
  );
}

/**
 * Two-tap destructive action: the first tap arms it ("Sure?"), the second
 * within 3 s does it. No modal — the panel lives over a camera view.
 */
export function ConfirmButton({
  onConfirm,
  disabled,
  label,
  confirmLabel = "Sure?",
  icon,
  ariaLabel,
}: {
  onConfirm: () => void;
  disabled?: boolean;
  label?: string;
  confirmLabel?: string;
  icon: React.ReactNode;
  ariaLabel: string;
}) {
  const [armed, setArmed] = React.useState(false);
  React.useEffect(() => {
    if (!armed) return;
    const id = window.setTimeout(() => setArmed(false), 3_000);
    return () => window.clearTimeout(id);
  }, [armed]);

  return (
    <Button
      type="button"
      size={label || armed ? "sm" : "icon-sm"}
      variant={armed ? "destructive" : label ? "outline" : "ghost"}
      aria-label={armed ? `Confirm: ${ariaLabel}` : ariaLabel}
      disabled={disabled}
      onClick={() => {
        if (armed) {
          setArmed(false);
          onConfirm();
        } else {
          setArmed(true);
        }
      }}
    >
      {icon}
      {armed ? confirmLabel : label}
    </Button>
  );
}

/** "now", "5m", "3h", "2d" — chat-sized. */
export function shortAgo(value: string | Date | null | undefined) {
  if (!value) return "";
  const ms = Date.now() - new Date(value).getTime();
  if (ms < 60_000) return "now";
  if (ms < 3_600_000) return `${Math.floor(ms / 60_000)}m`;
  if (ms < 86_400_000) return `${Math.floor(ms / 3_600_000)}h`;
  return `${Math.floor(ms / 86_400_000)}d`;
}

export function CountDot({ count }: { count: number }) {
  if (count <= 0) return null;
  return (
    <span className="inline-flex min-w-4 items-center justify-center rounded-full bg-primary px-1 font-mono text-[10px] leading-4 font-semibold text-primary-foreground">
      {count > 9 ? "9+" : count}
    </span>
  );
}
