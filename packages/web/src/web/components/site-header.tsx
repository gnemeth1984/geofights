import { BookOpen, Gamepad2 } from "lucide-react";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";

/** Shared top bar for the public pages (the console has its own, with session). */
export function SiteHeader({ current }: { current: "home" | "docs" | "play" }) {
  return (
    <header className="sticky top-0 z-10 border-b border-border bg-background/85 backdrop-blur">
      <div className="mx-auto flex max-w-6xl items-center gap-2 px-4 py-3 sm:gap-3 sm:px-6">
        <Link
          href="/"
          // Tracking tightens on small screens: at 0.18em the wordmark ran into
          // the nav on a 390px viewport.
          className="flex shrink-0 items-center gap-2 font-display text-xs font-semibold uppercase tracking-[0.08em] sm:text-sm sm:tracking-[0.18em]"
        >
          <img
            src="/icons/icon-192.png"
            alt=""
            width={24}
            height={24}
            className="size-6 shrink-0 rounded-md border border-border"
          />
          Geo<span className="text-primary">Fights</span>
        </Link>
        <nav className="ml-auto flex shrink-0 items-center gap-1 sm:gap-2">
          <Link href="/play">
            <Button variant={current === "play" ? "outline" : "ghost"} size="sm">
              <Gamepad2 className="size-4" />
              Play
            </Button>
          </Link>
          <Link href="/docs">
            <Button variant={current === "docs" ? "outline" : "ghost"} size="sm">
              <BookOpen className="size-4" />
              Docs
            </Button>
          </Link>
          <Link href="/admin">
            <Button size="sm">Console</Button>
          </Link>
        </nav>
      </div>
    </header>
  );
}
