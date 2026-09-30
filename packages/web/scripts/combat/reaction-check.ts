/**
 * Reaction check — the result animations, on real bodies.
 *
 * Builds the actual procedural characters and steps the actual update loop, so
 * what is asserted here is what the player sees rather than a reading of the
 * curve table. Four body types, because the whole point of the channel system
 * is that one curve has to read on a heavy brute, a whippet and a floating orb
 * alike, and a pose that only works on one of them is a bug the curve cannot
 * see.
 *
 * `slump` is what this was written for: it is the only state in the table that
 * has to *not* recover in the middle, and the easy mistakes (a spring that
 * bounces the body back over its own idle height, a pose that reads as a crouch
 * into a jump) are invisible in the source and obvious here.
 *
 *   cd packages/web && bun scripts/combat/reaction-check.ts
 */
// A canvas stub: the skin painter draws procedural textures into a 2D context,
// and none of that touches the motion this script is checking.
const ctx2d = new Proxy(
  {
    canvas: { width: 256, height: 256 },
    createLinearGradient: () => ({ addColorStop() {} }),
    createRadialGradient: () => ({ addColorStop() {} }),
    getImageData: () => ({ data: new Uint8ClampedArray(256 * 256 * 4), width: 256, height: 256 }),
    createImageData: () => ({ data: new Uint8ClampedArray(256 * 256 * 4), width: 256, height: 256 }),
    measureText: () => ({ width: 10 }),
  } as Record<string, unknown>,
  {
    get(target, key) {
      if (key in target) return target[key as string];
      return () => undefined;
    },
    set() {
      return true;
    },
  },
);
(globalThis as Record<string, unknown>).document = {
  createElement: () => ({
    width: 256,
    height: 256,
    style: {},
    getContext: () => ctx2d,
    toDataURL: () => "",
  }),
};

import { createCharacter, type AnimationState } from "../../src/web/ar/character";

let fails = 0;
let passes = 0;
function check(name: string, ok: boolean, detail: unknown = "") {
  if (ok) passes++;
  else {
    fails++;
    console.log(`FAIL ${name} ${detail}`);
  }
}

const finite = (n: number) => Number.isFinite(n);

function sample(modelId: string, state: AnimationState) {
  const c = createCharacter({ modelId, name: "T", rarity: "rare", level: 3 });
  const frames: { t: number; y: number; pitch: number; scaleY: number }[] = [];
  let bad = 0;
  // Settle idle first, then play, stepping at 60fps through the move + residual.
  for (let i = 0; i < 30; i++) c.update(i / 60, false);
  c.play(state);
  const start = 30 / 60;
  for (let i = 30; i < 30 + 60 * 3.2; i++) {
    const elapsed = i / 60;
    c.update(elapsed, false);
    // Animation drives the rig, not the group: the group carries the planted
    // ground ring and the bubble, which deliberately do not move with the body.
    const g = c.group.children.find((child) => child.type === "Group")!;
    c.group.traverse((o) => {
      if (!finite(o.position.x) || !finite(o.position.y) || !finite(o.position.z)) bad++;
      if (!finite(o.rotation.x) || !finite(o.rotation.y) || !finite(o.rotation.z)) bad++;
      if (!finite(o.scale.x) || !finite(o.scale.y) || !finite(o.scale.z)) bad++;
    });
    frames.push({
      t: elapsed - start,
      y: g.position.y,
      pitch: g.rotation.x,
      scaleY: g.scale.y,
    });
  }
  const st = c.progress().state;
  c.dispose();
  return { frames, bad, endState: st };
}

for (const modelId of ["proc_heavy_01", "proc_standard_01", "proc_skirmish_01", "proc_v1"]) {
  const slump = sample(modelId, "slump");
  const dance = sample(modelId, "celebrate");
  check(`${modelId}: no NaN in the slump`, slump.bad === 0, slump.bad);
  const mid = slump.frames.filter((f) => f.t > 0.4 && f.t < 1.8);
  const minY = Math.min(...mid.map((f) => f.y));
  const maxY = Math.max(...mid.map((f) => f.y));
  const idleY = slump.frames[0]!.y;
  check(`${modelId}: the body goes down, not up`, minY < idleY - 0.01, { idleY, minY });
  check(`${modelId}: and stays down — nothing bounces back over idle`, maxY < idleY + 0.012, { idleY, maxY });
  const maxPitch = Math.max(...mid.map((f) => f.pitch));
  check(`${modelId}: it folds forward`, maxPitch > 0.05, maxPitch);
  const squashed = Math.min(...mid.map((f) => f.scaleY));
  check(`${modelId}: and compresses`, squashed < slump.frames[0]!.scaleY - 0.01, squashed);
  const last = slump.frames.at(-1)!;
  check(`${modelId}: back on its feet by the end`, last.t > 2.4 && Math.abs(last.y - idleY) < 0.02 && Math.abs(last.pitch) < 0.03, last);
  check(`${modelId}: hands back to idle`, slump.endState === "idle", slump.endState);
  // The opposite of the dance, which is the whole design.
  const danceMaxY = Math.max(...dance.frames.filter((f) => f.t > 0 && f.t < 1.8).map((f) => f.y));
  check(`${modelId}: the dance goes up where the slump goes down`, danceMaxY > idleY + 0.01 && minY < idleY, { danceMaxY, minY, idleY });
}

console.log(`\n${fails === 0 ? "PASS" : "FAIL"} — ${passes} checks passed, ${fails} failed`);
