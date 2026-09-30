import { ChevronDown } from "lucide-react";

/**
 * Landing FAQ. index.html carries the same questions as FAQPage JSON-LD for
 * search engines — keep the two in step when editing either.
 */
export const FAQ_ITEMS = [
  {
    q: "Is GeoFights free?",
    a: "Yes. It's free to play and there is nothing to buy with real money. Coins, upgrades and fighters are all earned by playing.",
  },
  {
    q: "What do I need to play?",
    a: "A phone with GPS and a camera, and a web browser. There's no app store download — you can add GeoFights to your home screen and it opens full screen like an app.",
  },
  {
    q: "Where can I play?",
    a: "In parks, sports pitches and playgrounds that have been reviewed and approved as play areas. The game shows you the nearest one.",
  },
  {
    q: "How do free upgrades work?",
    a: "When you're near an approved park, pitch or playground, the game drops an upgrade inside it just for you — a few times a day, with a wait between drops. Only you can see it, and you have to walk to it to pick it up.",
  },
  {
    q: "What happens if I lose a fight?",
    a: "You lose one of the upgrades your fighter had equipped, and the winner gets a fresh copy of it to use or sell in the Market. If you had nothing equipped, you lose nothing and the winner gets a random upgrade instead.",
  },
  {
    q: "Is it safe for children?",
    a: "Play only happens in reviewed areas, never on roads, railways or water, and the game pauses if you move faster than walking pace. Players under 16 need a parent or guardian to switch location on, and other players never see your exact position.",
  },
] as const;

export function FAQ() {
  return (
    <div className="mt-8 divide-y divide-border border-y border-border">
      {FAQ_ITEMS.map((item) => (
        <details key={item.q} className="group py-5">
          <summary className="flex cursor-pointer list-none items-center justify-between gap-4 font-display text-lg font-semibold [&::-webkit-details-marker]:hidden">
            <h3>{item.q}</h3>
            <ChevronDown className="size-5 shrink-0 text-primary transition-transform group-open:rotate-180" />
          </summary>
          <p className="mt-3 leading-relaxed text-muted-foreground">{item.a}</p>
        </details>
      ))}
    </div>
  );
}
