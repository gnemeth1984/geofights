import { Gift, Swords } from "lucide-react";

/**
 * The landing's picture: a street map with one park lit up, a player walking to
 * a drop that is theirs alone, and two fighters already squaring up on the grass.
 * The creatures are real renders from the character builder, not concept art,
 * so what a visitor sees here is what the game puts on their phone.
 */
export function HeroArt() {
  return (
    <div className="relative aspect-[5/4] w-full select-none lg:scale-[1.18]" aria-hidden="true">
      {/* The map fades out at its edges so it reads as a window onto a bigger city, not a box. */}
      <svg
        viewBox="0 0 500 400"
        className="absolute inset-0 size-full [mask-image:radial-gradient(ellipse_at_55%_55%,black_50%,transparent_82%)]"
        role="presentation"
      >
        <defs>
          <radialGradient id="lf-glow" cx="55%" cy="52%" r="55%">
            <stop offset="0%" stopColor="oklch(0.85 0.19 124)" stopOpacity="0.22" />
            <stop offset="100%" stopColor="oklch(0.85 0.19 124)" stopOpacity="0" />
          </radialGradient>
          <pattern id="lf-grid" width="20" height="20" patternUnits="userSpaceOnUse">
            <path d="M20 0H0V20" fill="none" stroke="oklch(1 0 0 / 5%)" strokeWidth="1" />
          </pattern>
        </defs>
        <rect width="500" height="400" fill="url(#lf-grid)" />
        <rect width="500" height="400" fill="url(#lf-glow)" />
        {/* streets */}
        <g fill="none" stroke="oklch(1 0 0 / 13%)" strokeLinecap="round">
          <path d="M-10 92 C120 80 260 110 510 70" strokeWidth="7" />
          <path d="M-10 332 C140 318 300 350 510 300" strokeWidth="7" />
          <path d="M82 -10 C96 120 70 260 110 410" strokeWidth="6" />
          <path d="M430 -10 C410 130 450 250 420 410" strokeWidth="6" />
          <path d="M-10 210 L70 205" strokeWidth="3" />
          <path d="M440 190 L510 196" strokeWidth="3" />
          <path d="M230 -10 L240 80" strokeWidth="3" />
          <path d="M260 340 L250 410" strokeWidth="3" />
        </g>
        {/* the park — an approved play area */}
        <path
          d="M128 128 C170 108 330 104 392 132 C420 168 414 262 386 290 C320 312 180 312 136 288 C112 246 110 168 128 128Z"
          fill="oklch(0.85 0.19 124 / 9%)"
          stroke="oklch(0.85 0.19 124 / 55%)"
          strokeWidth="1.5"
          strokeDasharray="5 5"
        />
        <g fill="oklch(0.85 0.19 124 / 16%)">
          <circle cx="156" cy="156" r="10" />
          <circle cx="172" cy="148" r="7" />
          <circle cx="372" cy="270" r="9" />
          <circle cx="356" cy="278" r="6" />
          <circle cx="380" cy="150" r="8" />
        </g>
        {/* walking route from the player to their drop */}
        <path
          d="M112 350 C128 340 146 332 164 322 C182 310 192 292 196 266"
          fill="none"
          stroke="oklch(0.85 0.19 124)"
          strokeWidth="2"
          strokeDasharray="2 7"
          strokeLinecap="round"
          className="lf-route"
        />
        <circle cx="112" cy="350" r="7" fill="oklch(0.96 0.005 255)" />
        <circle cx="112" cy="350" r="7" fill="none" stroke="oklch(0.96 0.005 255)" className="lf-ping" />
        {/* the drop */}
        <circle cx="196" cy="262" r="14" fill="none" stroke="oklch(0.79 0.16 72)" strokeWidth="1.5" className="lf-ping lf-ping-slow" />
        <rect x="188" y="254" width="16" height="16" rx="3" transform="rotate(45 196 262)" fill="oklch(0.79 0.16 72)" />
        {/* the fight ring */}
        <ellipse cx="288" cy="240" rx="96" ry="30" fill="none" stroke="oklch(0.85 0.19 124 / 45%)" strokeWidth="1.5" />
        <ellipse cx="288" cy="240" rx="60" ry="18" fill="none" stroke="oklch(0.85 0.19 124 / 25%)" strokeWidth="1" />
      </svg>

      <img
        src="/images/creature-drake.png"
        alt=""
        width={754}
        height={439}
        className="lf-float absolute left-[17%] top-[30%] w-[44%] drop-shadow-[0_18px_24px_rgba(0,0,0,0.55)]"
      />
      <img
        src="/images/creature-orb.png"
        alt=""
        width={280}
        height={437}
        className="lf-float lf-float-late absolute left-[65%] top-[36%] w-[13%] -scale-x-100 drop-shadow-[0_18px_24px_rgba(0,0,0,0.55)]"
      />

      <div className="absolute left-[8%] top-[74%] flex items-center gap-2 rounded-md border border-accent/50 bg-background/90 px-2.5 py-1.5 font-mono text-[11px] text-accent shadow-lg backdrop-blur">
        <Gift className="size-3.5" />
        free drop · yours · 140 m
      </div>
      <div className="absolute right-[6%] top-[14%] flex items-center gap-2 rounded-md border border-primary/50 bg-background/90 px-2.5 py-1.5 font-mono text-[11px] text-primary shadow-lg backdrop-blur">
        <Swords className="size-3.5" />
        winner takes 1 upgrade
      </div>
    </div>
  );
}
