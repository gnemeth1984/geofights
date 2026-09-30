import { Download, Share, SquarePlus, X } from "lucide-react";
import { useInstall } from "@/hooks/use-install";
import { Button } from "@/components/ui/button";

/**
 * Bottom-anchored install bar. Chromium gets a one-tap install button; iOS
 * gets the Share → Add to Home Screen steps, which is the only route Safari
 * offers. Hidden entirely once the game runs from the home screen.
 *
 * Sits above the safe-area inset so it clears the iOS home indicator, and
 * out of the way of the game's own bottom controls on `/play`.
 */
export function InstallPrompt() {
  const { installed, canPrompt, needsIosInstructions, dismissed, install, dismiss } = useInstall();

  if (installed || dismissed) return null;
  if (!canPrompt && !needsIosInstructions) return null;

  return (
    <div
      // Lifted clear of the bottom-right "Made with Runable" badge, which is
      // fixed at the same corner and would otherwise sit on top of the bar.
      className="pointer-events-none fixed inset-x-0 bottom-0 z-50 flex justify-center px-3"
      style={{ paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 4.25rem)" }}
    >
      <div className="pointer-events-auto flex w-full max-w-md items-center gap-3 rounded-xl border border-border bg-card/95 p-3 shadow-lg backdrop-blur">
        <img
          src="/icons/icon-192.png"
          alt=""
          width={40}
          height={40}
          className="size-10 shrink-0 rounded-lg border border-border"
        />
        <div className="min-w-0 flex-1">
          <p className="font-display text-sm font-semibold leading-tight">Install GeoFights</p>
          {needsIosInstructions ? (
            <p className="mt-0.5 flex flex-wrap items-center gap-1 text-xs leading-snug text-muted-foreground">
              Tap
              <Share className="size-3.5 shrink-0 text-primary" />
              then
              <SquarePlus className="size-3.5 shrink-0 text-primary" />
              <span className="whitespace-nowrap">Add to Home Screen</span>
            </p>
          ) : (
            <p className="mt-0.5 text-xs leading-snug text-muted-foreground">
              Full screen, no browser bar, launches straight into the arena.
            </p>
          )}
        </div>
        {canPrompt && (
          <Button size="sm" onClick={() => void install()}>
            <Download className="size-4" />
            Install
          </Button>
        )}
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={dismiss}
          aria-label="Dismiss install prompt"
        >
          <X className="size-4" />
        </Button>
      </div>
    </div>
  );
}
