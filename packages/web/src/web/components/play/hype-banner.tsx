import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import type { HypeBanner as Banner } from "@/lib/hype";

/**
 * The arcade layer over the fight: the callout, the combo counter, and the
 * commentary line.
 *
 * All three are read-only overlays and every one of them is
 * `pointer-events-none` — the fight is a camera feed with buttons over it, and
 * a decoration that eats a tap on the attack button would be a real bug rather
 * than a cosmetic one.
 *
 * The callout takes itself away. `banner.ttl` drives both the CSS animation and
 * a timer that clears it, rather than relying on `animationend`: a player who
 * has asked the OS for reduced motion gets no animation and therefore no event,
 * and the callout would sit on screen for the rest of the match.
 */

const TONE: Record<Banner["tone"], { text: string; glow: string; edge: string }> = {
  /* My blow landing. The theme's lime, which everywhere else in the app means
   * "this went your way". */
  good: {
    text: "text-primary",
    glow: "drop-shadow-[0_0_28px_oklch(0.85_0.19_124/0.55)]",
    edge: "border-primary/40 bg-primary/10 text-primary",
  },
  /* Taking one. */
  bad: {
    text: "text-destructive",
    glow: "drop-shadow-[0_0_28px_oklch(0.66_0.21_25/0.6)]",
    edge: "border-destructive/40 bg-destructive/10 text-destructive",
  },
  /* The moments worth the amber: a critical, a finisher, a perfect. */
  hot: {
    text: "text-accent",
    glow: "drop-shadow-[0_0_30px_oklch(0.79_0.16_72/0.6)]",
    edge: "border-accent/40 bg-accent/10 text-accent",
  },
};

/** The calls big enough to shake the frame. */
const SHOCK = new Set<Banner["call"]>(["ko", "critical", "combo_big", "perfect"]);

export function HypeBanner({
  banner,
  streak,
  commentary,
  className,
}: {
  banner: Banner | null;
  /** Blows deep the current chain is. Under 2 the counter stays hidden. */
  streak: number;
  /** The server's own line about the last exchange, or null. */
  commentary: string | null;
  className?: string;
}) {
  const shown = useSelfClearing(banner);

  return (
    <div
      className={cn(
        "pointer-events-none absolute inset-x-0 top-0 z-30 flex flex-col items-center gap-2 px-4",
        className,
      )}
      // The whole layer is decoration over a fight that is already announced
      // out loud; a screen reader reading "COMBO ×4" over the top of the HUD's
      // own live health numbers would be noise on top of the real information.
      aria-hidden="true"
    >
      <ComboCounter streak={streak} />
      {shown ? <Callout banner={shown} /> : null}
      <Commentary line={commentary} />
    </div>
  );
}

/**
 * Hold a banner for its `ttl`, then drop it.
 *
 * Keyed on `id` rather than on the object, because the reducer hands back a new
 * object for every exchange and two identical criticals in a row have to
 * re-trigger the animation.
 */
function useSelfClearing(banner: Banner | null): Banner | null {
  const [shown, setShown] = useState<Banner | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!banner) return;
    setShown(banner);
    if (timer.current) clearTimeout(timer.current);
    const id = banner.id;
    timer.current = setTimeout(
      () => setShown((current) => (current?.id === id ? null : current)),
      banner.ttl * 1000,
    );
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [banner]);

  return shown;
}

function Callout({ banner }: { banner: Banner }) {
  const tone = TONE[banner.tone];
  return (
    <div
      // The id is the key, so React tears the node down and builds a new one
      // per call — which is what restarts the CSS animation. Without it, a
      // second COMBO would update the text in place and never slam.
      key={banner.id}
      className={cn("hype-slam mt-14 flex flex-col items-center", SHOCK.has(banner.call) && "hype-shock")}
      style={{ "--hype-ttl": `${banner.ttl}s` } as React.CSSProperties}
    >
      <span
        className={cn(
          "font-display text-center text-4xl leading-none font-bold tracking-[0.08em] uppercase sm:text-5xl",
          tone.text,
          tone.glow,
        )}
      >
        {banner.headline}
      </span>
      {banner.sub ? (
        <span className="mt-1.5 font-mono text-[0.7rem] tracking-[0.22em] uppercase text-foreground/70">
          {banner.sub}
        </span>
      ) : null}
    </div>
  );
}

/**
 * The chain counter.
 *
 * Sits above the callout and stays up for as long as the chain is alive, which
 * is the part the callout cannot do — "COMBO ×3" flashes and leaves, but a
 * player mid-chain wants to see the number still climbing.
 */
function ComboCounter({ streak }: { streak: number }) {
  if (streak < 2) return null;
  return (
    <div
      key={streak}
      className="hype-tick mt-3 flex items-baseline gap-1.5 rounded-full border border-accent/40 bg-background/70 px-3 py-1 backdrop-blur-sm"
    >
      <span className="font-display text-lg leading-none font-bold text-accent tabular">{streak}</span>
      <span className="font-mono text-[0.6rem] tracking-[0.2em] uppercase text-accent/80">hit chain</span>
    </div>
  );
}

/**
 * The commentary line.
 *
 * This is `message` off the `avatar_damage` event — a line the server has been
 * writing for every hit in every match and which, until now, only the admin
 * console ever rendered. It is the closest thing the app has to a colour
 * commentator, so it belongs on the player's screen.
 */
function Commentary({ line }: { line: string | null }) {
  if (!line) return null;
  return (
    <div
      key={line}
      className="animate-in fade-in slide-in-from-top-1 mt-1 max-w-[36ch] rounded-md border border-border bg-background/75 px-2.5 py-1 text-center font-mono text-[0.65rem] leading-snug text-foreground/80 backdrop-blur-sm duration-300"
    >
      {line}
    </div>
  );
}
