import { BookOpen, Gamepad2, Terminal } from "lucide-react";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";

/** Shared top bar for the public pages (the console has its own, with session). */
export function SiteHeader({ current }: { current: "home" | "docs" | "play" }) {
  return (
    <header className="sticky top-0 z-10 border-b border-border bg-background/85 backdrop-blur">
      <div className="mx-auto flex max-w-6xl items-center gap-3 px-4 py-3 sm:px-6">
        <Link
          href="/"
          className="flex items-center gap-2 font-display text-sm font-semibold uppercase tracking-[0.18em]"
        >
          <Terminal className="size-4 text-primary" />
          AR Battle
          <span className="text-muted-foreground">Backend</span>
        </Link>
        <nav className="ml-auto flex items-center gap-2">
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
