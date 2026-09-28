import * as React from "react";

/**
 * Whether the screen is wider than it is tall, and short enough that a stacked
 * layout would not fit.
 *
 * Read from the viewport rather than from `screen.orientation`, because the
 * thing that actually matters is the shape of the box the controls have to fit
 * in: a phone turned sideways, a tablet in a stand and a resized desktop
 * window all want the same two-handed layout, and none of them report the same
 * orientation string.
 *
 * The height bound keeps a wide desktop window on the portrait layout, where
 * there is plenty of vertical room and a split pad would just look odd.
 */
const QUERY = "(orientation: landscape) and (max-height: 620px)";

export function useLandscape(): boolean {
  const [landscape, setLandscape] = React.useState(() => {
    if (typeof window === "undefined" || !window.matchMedia) return false;
    return window.matchMedia(QUERY).matches;
  });

  React.useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const media = window.matchMedia(QUERY);
    const apply = () => setLandscape(media.matches);
    apply();
    media.addEventListener("change", apply);
    return () => media.removeEventListener("change", apply);
  }, []);

  return landscape;
}
