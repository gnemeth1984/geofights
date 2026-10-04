import * as React from "react";
import { Link } from "wouter";
import { Check, Copy, Download, Mail, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PRESS, PRESS_ASSETS, PRESS_CONTACT, SCREENSHOTS } from "@/lib/launch-kit";

/**
 * Press kit: everything a journalist, creator or school newsletter needs to
 * write about GeoFights without emailing first. Copy and asset lists live in
 * lib/launch-kit.ts.
 */
export default function Press() {
  return (
    <div className="min-h-dvh overflow-x-clip">
      <header className="border-b border-border">
        <div className="mx-auto flex max-w-6xl items-center px-4 py-4 sm:px-6">
          <Link href="/" className="flex items-center gap-2 font-display text-sm font-bold uppercase tracking-[0.16em]">
            <img src="/icons/icon-192.png" alt="" width={28} height={28} className="size-7 rounded-md" />
            Geo<span className="text-primary">Fights</span>
          </Link>
          <span className="ml-3 font-mono text-[11px] uppercase tracking-[0.2em] text-muted-foreground">Press kit</span>
          <Link href="/" className="ml-auto">
            <Button size="sm" variant="outline">
              Play free
            </Button>
          </Link>
        </div>
      </header>

      <main>
        <section className="relative isolate border-b border-border">
          <div
            className="absolute inset-0 -z-10 opacity-60"
            style={{
              background:
                "radial-gradient(60% 60% at 85% 20%, oklch(0.85 0.19 124 / 12%), transparent 70%), radial-gradient(40% 40% at 5% 100%, oklch(0.79 0.16 72 / 8%), transparent 70%)",
            }}
          />
          <div className="mx-auto grid max-w-6xl gap-10 px-4 py-14 sm:px-6 lg:grid-cols-12 lg:py-20">
            <div className="lg:col-span-7">
              <p className="font-mono text-xs uppercase tracking-[0.2em] text-primary">Press &amp; creators</p>
              <h1 className="mt-4 font-display text-[2.4rem] font-bold uppercase leading-[0.95] sm:text-6xl">
                Your local park is the <span className="text-primary">arena</span>.
              </h1>
              <p className="mt-5 max-w-xl text-base leading-relaxed text-muted-foreground sm:text-lg">{PRESS.short}</p>
              <div className="mt-7 flex flex-wrap gap-3">
                <a href="/press/geofights-press-kit.zip" download>
                  <Button>
                    <Download className="size-4" /> Download press kit (.zip, 16 MB)
                  </Button>
                </a>
                <a href={`mailto:${PRESS_CONTACT}?subject=GeoFights%20press%20enquiry`}>
                  <Button variant="outline">
                    <Mail className="size-4" /> {PRESS_CONTACT}
                  </Button>
                </a>
              </div>
            </div>
            <div className="lg:col-span-5">
              <video
                className="mx-auto aspect-[9/16] max-h-[560px] w-auto rounded-2xl border border-border bg-card shadow-2xl"
                src="/videos/geofights-trailer.mp4"
                poster="/press/trailer-poster.jpg"
                controls
                playsInline
                preload="none"
                aria-label="GeoFights trailer"
              >
                <track kind="captions" src="/videos/geofights-trailer.vtt" srcLang="en" label="English" default />
              </video>
            </div>
          </div>
        </section>

        <Section title="Fact sheet">
          <dl className="grid gap-px overflow-hidden rounded-xl border border-border bg-border sm:grid-cols-2 lg:grid-cols-3">
            {PRESS.facts.map(([k, v]) => (
              <div key={k} className="bg-card p-4">
                <dt className="font-mono text-[11px] uppercase tracking-[0.16em] text-muted-foreground">{k}</dt>
                <dd className="mt-1 font-medium">{v}</dd>
              </div>
            ))}
          </dl>
        </Section>

        <Section title="Copy you can use">
          <div className="grid gap-4 lg:grid-cols-2">
            <CopyBlock label="One-liner" text={PRESS.oneLiner} />
            <CopyBlock label="Short description" text={PRESS.short} />
            <div className="lg:col-span-2">
              <CopyBlock label="About GeoFights (boilerplate)" text={PRESS.boilerplate} />
            </div>
          </div>
        </Section>

        <Section title="Features and safety">
          <div className="grid gap-8 lg:grid-cols-2">
            <ul className="space-y-3">
              {PRESS.features.map((f) => (
                <li key={f} className="flex gap-3 leading-relaxed">
                  <span className="mt-2 size-1.5 shrink-0 rounded-full bg-primary" />
                  {f}
                </li>
              ))}
            </ul>
            <div className="rounded-xl border border-primary/30 bg-card p-5">
              <p className="flex items-center gap-2 font-display font-semibold uppercase tracking-wide text-primary">
                <ShieldCheck className="size-4" /> Safety by design
              </p>
              <ul className="mt-3 space-y-2.5 text-sm leading-relaxed text-muted-foreground">
                {PRESS.safety.map((s) => (
                  <li key={s}>{s}</li>
                ))}
              </ul>
            </div>
          </div>
        </Section>

        <Section title="Screenshots">
          <p className="-mt-2 mb-5 text-sm text-muted-foreground">
            Real captures from the game. Click to open full size. Free to use in coverage about GeoFights.
          </p>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
            {SCREENSHOTS.filter((s) => s.orientation === "portrait").map((s) => (
              <Shot key={s.src} {...s} />
            ))}
          </div>
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            {SCREENSHOTS.filter((s) => s.orientation === "landscape").map((s) => (
              <Shot key={s.src} {...s} />
            ))}
          </div>
        </Section>

        <Section title="Logo and media">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {PRESS_ASSETS.map((a) => (
              <a
                key={a.href}
                href={a.href}
                download
                className="group overflow-hidden rounded-xl border border-border bg-card transition-colors hover:border-primary/50"
              >
                <div className="flex aspect-video items-center justify-center bg-background">
                  {a.preview ? (
                    <img src={a.preview} alt="" loading="lazy" className="max-h-full max-w-full object-contain" />
                  ) : (
                    <Download className="size-8 text-muted-foreground group-hover:text-primary" />
                  )}
                </div>
                <div className="p-3">
                  <p className="font-medium">{a.label}</p>
                  <p className="font-mono text-[11px] text-muted-foreground">{a.detail}</p>
                </div>
              </a>
            ))}
          </div>
          <p className="mt-4 text-xs text-muted-foreground">
            Brand colours: acid lime <code className="font-mono">#B4E818</code> on deep slate{" "}
            <code className="font-mono">#0D1722</code>. Type: Chakra Petch and IBM Plex Sans. Please don&apos;t recolour or
            stretch the icon.
          </p>
        </Section>

        <Section title="Contact">
          <p className="max-w-2xl leading-relaxed text-muted-foreground">
            Interviews, review access, school or club visits: email{" "}
            <a className="text-primary underline" href={`mailto:${PRESS_CONTACT}`}>
              {PRESS_CONTACT}
            </a>
            . We usually reply within two working days.
          </p>
        </Section>
      </main>

      <footer className="border-t border-border">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-6 gap-y-2 px-4 py-6 text-xs text-muted-foreground sm:px-6">
          <span className="font-display font-semibold uppercase tracking-[0.14em] text-foreground">
            Geo<span className="text-primary">Fights</span>
          </span>
          <span>© {new Date().getFullYear()} GeoFights</span>
          <Link href="/" className="hover:text-foreground">
            Home
          </Link>
          <Link href="/play" className="hover:text-foreground">
            Play
          </Link>
        </div>
      </footer>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="border-b border-border">
      <div className="mx-auto max-w-6xl px-4 py-12 sm:px-6">
        <h2 className="mb-6 font-display text-2xl font-bold uppercase tracking-wide">{title}</h2>
        {children}
      </div>
    </section>
  );
}

function CopyBlock({ label, text }: { label: string; text: string }) {
  const [copied, setCopied] = React.useState(false);
  const copy = async () => {
    await navigator.clipboard.writeText(text);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1500);
  };
  return (
    <div className="h-full rounded-xl border border-border bg-card p-4">
      <div className="mb-2 flex items-center gap-2">
        <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-muted-foreground">{label}</p>
        <Button size="sm" variant="ghost" className="ml-auto h-7 px-2 text-xs" onClick={copy}>
          {copied ? <Check className="size-3.5 text-primary" /> : <Copy className="size-3.5" />}
          {copied ? "Copied" : "Copy"}
        </Button>
      </div>
      <p className="leading-relaxed">{text}</p>
    </div>
  );
}

function Shot({ src, caption }: { src: string; caption: string }) {
  return (
    <a href={src} target="_blank" rel="noreferrer" className="group block">
      <img
        src={src}
        alt={caption}
        loading="lazy"
        className="w-full rounded-xl border border-border bg-card transition-colors group-hover:border-primary/50"
      />
      <p className="mt-2 text-xs text-muted-foreground">{caption}</p>
    </a>
  );
}
