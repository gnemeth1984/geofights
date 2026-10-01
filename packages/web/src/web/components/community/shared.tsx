import type * as React from "react";
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
