import { useEffect } from "react";
import { ArrowRight, Car, Eye, Gift, MapPinned, ShieldCheck, Sparkles, Swords, Trees, Users } from "lucide-react";
import { Link, useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { SignInCard } from "@/components/play/sign-in-card";
import { HeroArt } from "@/components/landing/hero-art";
import { FAQ } from "@/components/landing/faq";
import { useSession } from "@/queries/session";

/**
 * The public front door. It is the game's landing, not a brochure: the account
 * form sits in the first screen, and anyone already signed in never sees this
 * page at all — they are sent straight to /play. Everything below the fold is
 * there for the people (and search engines) who have not heard of it yet.
 */
function Landing() {
  const session = useSession();
  const [, navigate] = useLocation();
  const signedIn = Boolean(session.data?.user);

  useEffect(() => {
    if (signedIn) navigate("/play", { replace: true });
  }, [signedIn, navigate]);

  return (
    <div className="min-h-dvh overflow-x-clip">
      <header className="absolute inset-x-0 top-0 z-10">
        <div className="mx-auto flex max-w-6xl items-center px-4 py-4 sm:px-6">
          <Link href="/" className="flex items-center gap-2 font-display text-sm font-bold uppercase tracking-[0.16em]">
            <img src="/icons/icon-192.png" alt="" width={28} height={28} className="size-7 rounded-md" />
            Geo<span className="text-primary">Fights</span>
          </Link>
          <a href="#join" className="ml-auto">
            <Button size="sm" variant="outline">
              Sign in
            </Button>
          </a>
        </div>
      </header>

      {/* ------------------------------------------------------------ hero */}
      <section className="relative isolate border-b border-border">
        <div
          className="absolute inset-0 -z-10 opacity-60"
          style={{
            background:
              "radial-gradient(60% 50% at 80% 30%, oklch(0.85 0.19 124 / 10%), transparent 70%), radial-gradient(40% 40% at 10% 90%, oklch(0.79 0.16 72 / 8%), transparent 70%)",
          }}
        />
        <div className="mx-auto grid max-w-6xl gap-10 px-4 pb-14 pt-24 sm:px-6 lg:grid-cols-12 lg:gap-6 lg:pb-20 lg:pt-28">
          <div className="lf-rise lg:col-span-6 lg:pt-6">
            <p className="font-mono text-xs uppercase tracking-[0.2em] text-primary">
              Free · plays in your phone's browser
            </p>
            <h1 className="mt-4 font-display text-[2.6rem] font-bold uppercase leading-[0.95] sm:text-6xl">
              Your local park <br className="hidden sm:block" />
              is the <span className="text-primary">arena</span>.
            </h1>
            <p className="mt-5 max-w-xl text-base leading-relaxed text-muted-foreground sm:text-lg">
              GeoFights is an AR battle game played outdoors. Walk to a park, pitch or playground
              near you, pick up free upgrades that drop there just for you, and fight other players
              on the grass you're standing on. Win, and you take one of their upgrades.
            </p>

            <div
              id="join"
              className="lf-rise mt-8 max-w-md scroll-mt-24 rounded-xl border border-primary/30 bg-card/90 p-5 shadow-[0_0_0_1px_oklch(0.85_0.19_124/6%),0_30px_60px_-20px_rgba(0,0,0,0.6)] backdrop-blur"
              style={{ animationDelay: "120ms" }}
            >
              <SignInCard initialMode="up" />
              <p className="mt-4 border-t border-border pt-3 text-xs leading-relaxed text-muted-foreground">
                After you sign in, the game asks for your location — that's how it finds the play
                areas around you. Players under 16 need a parent or guardian to switch it on.
              </p>
            </div>
          </div>

          <div className="lf-rise relative lg:col-span-6 lg:-mr-16 lg:self-center" style={{ animationDelay: "220ms" }}>
            <HeroArt />
          </div>
        </div>
      </section>

      {/* ---------------------------------------------------- how it works */}
      <section className="border-b border-border" aria-labelledby="how">
        <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6 lg:py-24">
          <h2 id="how" className="font-display text-3xl font-bold uppercase sm:text-4xl">
            How GeoFights works
          </h2>
          <ol className="mt-12 grid gap-12 md:grid-cols-3 md:gap-8">
            <Step
              n="01"
              icon={<Sparkles className="size-5" />}
              title="Describe your fighter"
              body="Type what you want — a spiky dragon, a rock golem, a glowing fox — and the game builds it, with its own moves, stats and personality."
            />
            <Step
              n="02"
              icon={<Gift className="size-5" />}
              title="Walk out and collect"
              body="Near a park, sports pitch or playground? Free upgrades drop there for you, a few times a day. Nobody else can see yours — you just have to walk to it."
            />
            <Step
              n="03"
              icon={<Swords className="size-5" />}
              title="Fight for keeps"
              body="Battle players in the same place, in AR on your phone's camera. The loser gives up one upgrade their fighter was wearing — the winner can equip it or sell it in the Market."
            />
          </ol>
        </div>
      </section>

      {/* ------------------------------------------------------------ safety */}
      <section className="border-b border-border" aria-labelledby="safety">
        <div className="mx-auto grid max-w-6xl gap-10 px-4 py-16 sm:px-6 lg:grid-cols-12 lg:py-24">
          <div className="lg:col-span-5">
            <p className="font-mono text-xs uppercase tracking-[0.2em] text-accent">For players and parents</p>
            <h2 id="safety" className="mt-3 font-display text-3xl font-bold uppercase sm:text-4xl">
              Built to be played outside, safely
            </h2>
            <p className="mt-4 text-muted-foreground">
              A game that sends people walking needs rules about where. These are enforced by the
              game server, not left to good intentions.
            </p>
          </div>
          <ul className="grid gap-6 sm:grid-cols-2 lg:col-span-7">
            <Rule
              icon={<Trees className="size-5" />}
              title="Only reviewed play areas"
              body="Parks, pitches and playgrounds are checked by a person before anyone is sent there. Unreviewed places get no drops and no fights."
            />
            <Rule
              icon={<ShieldCheck className="size-5" />}
              title="Never on a road"
              body="Roads, railways, water and private land are no-go zones. Upgrades are never placed on or near them, and pickups there are refused."
            />
            <Rule
              icon={<Car className="size-5" />}
              title="Walk, don't drive"
              body="Move faster than walking pace and the game pauses. It can't be played from a car or a bike."
            />
            <Rule
              icon={<Eye className="size-5" />}
              title="Your exact spot stays private"
              body="Location is used while you play. Other players never see your exact position."
            />
          </ul>
        </div>
      </section>

      {/* --------------------------------------------------------------- faq */}
      <section className="border-b border-border" aria-labelledby="faq">
        <div className="mx-auto max-w-3xl px-4 py-16 sm:px-6 lg:py-24">
          <h2 id="faq" className="font-display text-3xl font-bold uppercase sm:text-4xl">
            Questions
          </h2>
          <FAQ />
        </div>
      </section>

      {/* ------------------------------------------------------ closing CTA */}
      <section>
        <div className="mx-auto flex max-w-6xl flex-col items-start gap-6 px-4 py-16 sm:px-6 md:flex-row md:items-center">
          <div className="flex items-center gap-4">
            <MapPinned className="size-10 shrink-0 text-primary" />
            <p className="font-display text-2xl font-bold uppercase leading-tight sm:text-3xl">
              There's probably a park near you.
            </p>
          </div>
          <a href="#join" className="md:ml-auto">
            <Button size="lg">
              <Users className="size-4" />
              Create your player
              <ArrowRight className="size-4" />
            </Button>
          </a>
        </div>
        <footer className="border-t border-border">
          <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-6 gap-y-2 px-4 py-6 text-xs text-muted-foreground sm:px-6">
            <span className="font-display font-semibold uppercase tracking-[0.14em] text-foreground">
              Geo<span className="text-primary">Fights</span>
            </span>
            <span>© {new Date().getFullYear()} GeoFights</span>
            <Link href="/play" className="hover:text-foreground">
              Play
            </Link>
          </div>
        </footer>
      </section>
    </div>
  );
}

function Step(props: { n: string; icon: React.ReactNode; title: string; body: string }) {
  return (
    <li className="relative">
      <span className="font-display text-6xl font-bold leading-none text-transparent [-webkit-text-stroke:1px_oklch(0.85_0.19_124/55%)]">
        {props.n}
      </span>
      <div className="mt-4 flex items-center gap-2 text-primary">
        {props.icon}
        <h3 className="font-display text-xl font-semibold uppercase text-foreground">{props.title}</h3>
      </div>
      <p className="mt-3 leading-relaxed text-muted-foreground">{props.body}</p>
    </li>
  );
}

function Rule(props: { icon: React.ReactNode; title: string; body: string }) {
  return (
    <li className="border-l-2 border-primary/40 pl-4">
      <div className="flex items-center gap-2 text-primary">
        {props.icon}
        <h3 className="font-display text-base font-semibold uppercase text-foreground">{props.title}</h3>
      </div>
      <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{props.body}</p>
    </li>
  );
}

export default Landing;
