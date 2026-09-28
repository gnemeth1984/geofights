import * as THREE from "three";
import type { CreatureTheme } from "../../api/lib/creature-form";

/**
 * Procedural creature skin.
 *
 * The thing that separates a toy from a creature is not polygon count, it is
 * surface: scales that catch the key light, fur that goes soft at a grazing
 * angle, hide with pores in it. That normally arrives as a downloaded texture
 * set, which this game cannot have — a player opens it in a park on mobile data
 * and the character has to be on the floor the frame it is asked for.
 *
 * So the maps are *drawn*, in code, into an offscreen canvas the first time a
 * theme is needed, and then shared by every character using that theme. One
 * dragon costs one 256px scale pattern; a hundred dragons cost the same one.
 *
 * What is generated per theme:
 *
 * - **normal** — the surface relief. Scales, fur strands, chitin facets or
 *   crystal fracture, packed as a tangent-space normal map. This is what makes
 *   the body catch light unevenly, and it is doing most of the work.
 * - **roughness** — where the surface is wet/waxy versus dry and dusty, so the
 *   highlight breaks up instead of sitting on the mesh like a plastic sheen.
 * - **ao** — creases and cavity darkening, which reads as thickness.
 *
 * All three are tiling greyscale/RGB canvases at 256², which is plenty at the
 * size a creature occupies on a phone screen, and costs ~260 KB of GPU memory
 * per theme with mipmaps. Generated once, cached in a module-level map, and
 * never disposed: the set is small, bounded by the theme list, and shared, so
 * disposing it with one character would pull the surface out from under every
 * other character still on screen.
 */

/** How a theme's surface behaves under light, independent of its colour. */
export type SkinProfile = {
  normal: THREE.Texture;
  roughnessMap: THREE.Texture;
  aoMap: THREE.Texture;
  /** Base roughness the map modulates around. */
  roughness: number;
  metalness: number;
  /** How strongly the relief reads. Fur wants more than wet hide. */
  normalScale: number;
  /** World-space tiles across a 1m surface. Fine for fur, coarse for plating. */
  tiling: number;
  /**
   * Rim/fresnel strength. A creature lit by two lights in a dark AR scene reads
   * flat at the silhouette; a little scattered light at grazing angles is what
   * sells "this is a body with thickness" rather than a painted cutout.
   */
  rim: number;
  /** Subsurface warmth pushed into the shadow side, 0–1. */
  subsurface: number;
};

const SIZE = 256;

type Ctx = CanvasRenderingContext2D;

function canvas(): { el: HTMLCanvasElement; ctx: Ctx } {
  const el = document.createElement("canvas");
  el.width = SIZE;
  el.height = SIZE;
  const ctx = el.getContext("2d");
  if (!ctx) throw new Error("no 2d context for procedural skin");
  return { el, ctx };
}

function texture(el: HTMLCanvasElement, srgb = false): THREE.Texture {
  const tex = new THREE.CanvasTexture(el);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  // Data maps (normal/roughness/ao) are values, not colour, and must not be
  // decoded as sRGB or the relief and the gloss both come out wrong.
  tex.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  tex.anisotropy = 4;
  tex.needsUpdate = true;
  return tex;
}

/** Deterministic noise, so a theme's surface is identical every session. */
function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

/**
 * Turn a greyscale height canvas into a tangent-space normal map.
 *
 * Sobel over the height, wrapped at the edges so the result still tiles. Doing
 * it this way means every theme below only has to draw a *height* field — bumps
 * light, pits dark — which is far easier to author than drawing normals.
 */
function heightToNormal(height: Ctx, strength: number): HTMLCanvasElement {
  const src = height.getImageData(0, 0, SIZE, SIZE).data;
  const { el, ctx } = canvas();
  const out = ctx.createImageData(SIZE, SIZE);
  const at = (x: number, y: number) => {
    const xi = ((x % SIZE) + SIZE) % SIZE;
    const yi = ((y % SIZE) + SIZE) % SIZE;
    return src[(yi * SIZE + xi) * 4]! / 255;
  };
  for (let y = 0; y < SIZE; y += 1) {
    for (let x = 0; x < SIZE; x += 1) {
      const dx =
        at(x - 1, y - 1) + 2 * at(x - 1, y) + at(x - 1, y + 1) -
        (at(x + 1, y - 1) + 2 * at(x + 1, y) + at(x + 1, y + 1));
      const dy =
        at(x - 1, y - 1) + 2 * at(x, y - 1) + at(x + 1, y - 1) -
        (at(x - 1, y + 1) + 2 * at(x, y + 1) + at(x + 1, y + 1));
      // Normalise the gradient into a unit normal; z stays positive so the
      // surface always faces out.
      const nx = dx * strength;
      const ny = dy * strength;
      const len = Math.hypot(nx, ny, 1);
      const i = (y * SIZE + x) * 4;
      out.data[i] = ((nx / len) * 0.5 + 0.5) * 255;
      out.data[i + 1] = ((ny / len) * 0.5 + 0.5) * 255;
      out.data[i + 2] = ((1 / len) * 0.5 + 0.5) * 255;
      out.data[i + 3] = 255;
    }
  }
  ctx.putImageData(out, 0, 0);
  return el;
}

/** Fill with mid grey — the "no relief" baseline every pattern draws onto. */
function base(ctx: Ctx, value = 128) {
  ctx.fillStyle = `rgb(${value},${value},${value})`;
  ctx.fillRect(0, 0, SIZE, SIZE);
}

/**
 * Overlapping scales, drawn as a brick-offset grid of lit crescents. Each scale
 * is a radial gradient so it domes, plus a dark leading edge where it overlaps
 * the row in front — that dark line is what the eye reads as a separate scale.
 */
function drawScales(ctx: Ctx, seed: number, cols = 14) {
  base(ctx, 120);
  const random = rng(seed);
  const w = SIZE / cols;
  const h = w * 0.72;
  for (let row = -1; row <= SIZE / h; row += 1) {
    for (let col = -1; col <= cols; col += 1) {
      const cx = col * w + (row % 2 ? w * 0.5 : 0);
      const cy = row * h;
      const jitter = (random() - 0.5) * w * 0.12;
      const r = w * (0.56 + random() * 0.1);
      const g = ctx.createRadialGradient(cx + jitter, cy - h * 0.2, r * 0.1, cx + jitter, cy, r);
      g.addColorStop(0, "rgb(196,196,196)");
      g.addColorStop(0.62, "rgb(140,140,140)");
      g.addColorStop(1, "rgb(70,70,70)");
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.ellipse(cx + jitter, cy, r, r * 0.82, 0, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}

/**
 * Fur: thousands of short tapering strands, all flowing roughly one way.
 * `withBase` off keeps whatever is underneath, so a coat can sit on hide.
 */
function drawFur(ctx: Ctx, seed: number, withBase = true) {
  if (withBase) base(ctx, 128);
  const random = rng(seed);
  for (let i = 0; i < 4200; i += 1) {
    const x = random() * SIZE;
    const y = random() * SIZE;
    // Mostly downward flow with a slow swirl, so the coat has a direction.
    const angle = Math.PI * 0.5 + Math.sin(x * 0.02) * 0.35 + (random() - 0.5) * 0.5;
    const len = 5 + random() * 11;
    const bright = random() > 0.5;
    ctx.strokeStyle = bright ? "rgba(215,215,215,0.5)" : "rgba(52,52,52,0.45)";
    ctx.lineWidth = random() * 1.1 + 0.4;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.quadraticCurveTo(
      x + Math.cos(angle) * len * 0.5,
      y + Math.sin(angle) * len * 0.5,
      x + Math.cos(angle) * len,
      y + Math.sin(angle) * len,
    );
    ctx.stroke();
  }
}

/** Hide: leathery cell pattern with pores, the way an elephant or a rhino reads. */
function drawHide(ctx: Ctx, seed: number) {
  base(ctx, 138);
  const random = rng(seed);
  // Creases first: long wandering dark lines that divide the surface into cells.
  ctx.lineCap = "round";
  for (let i = 0; i < 90; i += 1) {
    let x = random() * SIZE;
    let y = random() * SIZE;
    let angle = random() * Math.PI * 2;
    ctx.strokeStyle = `rgba(48,48,48,${0.16 + random() * 0.22})`;
    ctx.lineWidth = 0.8 + random() * 1.8;
    ctx.beginPath();
    ctx.moveTo(x, y);
    const steps = 6 + Math.floor(random() * 8);
    for (let s = 0; s < steps; s += 1) {
      angle += (random() - 0.5) * 1.1;
      x += Math.cos(angle) * 9;
      y += Math.sin(angle) * 9;
      ctx.lineTo(x, y);
    }
    ctx.stroke();
  }
  // Then pores and pebbling on top.
  for (let i = 0; i < 1500; i += 1) {
    const x = random() * SIZE;
    const y = random() * SIZE;
    const r = random() * 1.9 + 0.5;
    ctx.fillStyle = random() > 0.45 ? "rgba(90,90,90,0.4)" : "rgba(190,190,190,0.35)";
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }
}

/** Chitin: hard tessellated facets with a bevelled edge, for insects. */
function drawCarapace(ctx: Ctx, seed: number) {
  base(ctx, 132);
  const random = rng(seed);
  const cells = 9;
  const step = SIZE / cells;
  // Jittered lattice points, then each cell drawn as a bevelled hex-ish plate.
  for (let gy = -1; gy <= cells; gy += 1) {
    for (let gx = -1; gx <= cells; gx += 1) {
      const cx = (gx + 0.5) * step + (gy % 2 ? step * 0.5 : 0) + (random() - 0.5) * step * 0.2;
      const cy = (gy + 0.5) * step + (random() - 0.5) * step * 0.2;
      const r = step * (0.5 + random() * 0.08);
      const sides = 6;
      const spin = random() * Math.PI;
      ctx.beginPath();
      for (let s = 0; s <= sides; s += 1) {
        const a = spin + (s / sides) * Math.PI * 2;
        const px = cx + Math.cos(a) * r;
        const py = cy + Math.sin(a) * r * 0.86;
        if (s === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      ctx.closePath();
      const g = ctx.createLinearGradient(cx - r, cy - r, cx + r, cy + r);
      g.addColorStop(0, "rgb(198,198,198)");
      g.addColorStop(1, "rgb(104,104,104)");
      ctx.fillStyle = g;
      ctx.fill();
      ctx.strokeStyle = "rgba(38,38,38,0.85)";
      ctx.lineWidth = 1.6;
      ctx.stroke();
    }
  }
}

/** Fractured crystal / hard-edged planes, for elementals and constructs. */
function drawFacets(ctx: Ctx, seed: number, panels: boolean) {
  base(ctx, 136);
  const random = rng(seed);
  if (panels) {
    // Construct: machined panel lines and rivets on a flat surface.
    ctx.strokeStyle = "rgba(40,40,40,0.75)";
    for (let i = 0; i < 9; i += 1) {
      const y = random() * SIZE;
      ctx.lineWidth = 1 + random() * 1.6;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(SIZE, y + (random() - 0.5) * 10);
      ctx.stroke();
    }
    for (let i = 0; i < 7; i += 1) {
      const x = random() * SIZE;
      ctx.lineWidth = 1 + random() * 1.4;
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x + (random() - 0.5) * 10, SIZE);
      ctx.stroke();
    }
    for (let i = 0; i < 120; i += 1) {
      const x = random() * SIZE;
      const y = random() * SIZE;
      ctx.fillStyle = "rgba(205,205,205,0.6)";
      ctx.beginPath();
      ctx.arc(x, y, 1.4 + random(), 0, Math.PI * 2);
      ctx.fill();
    }
    return;
  }
  // Elemental: shards of varying brightness, hard edges, no curves anywhere.
  for (let i = 0; i < 150; i += 1) {
    const cx = random() * SIZE;
    const cy = random() * SIZE;
    const r = 8 + random() * 26;
    const sides = 3 + Math.floor(random() * 3);
    const spin = random() * Math.PI * 2;
    ctx.beginPath();
    for (let s = 0; s <= sides; s += 1) {
      const a = spin + (s / sides) * Math.PI * 2;
      const rr = r * (0.6 + random() * 0.6);
      const px = cx + Math.cos(a) * rr;
      const py = cy + Math.sin(a) * rr;
      if (s === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.closePath();
    const shade = 70 + Math.floor(random() * 130);
    ctx.fillStyle = `rgba(${shade},${shade},${shade},0.75)`;
    ctx.fill();
  }
}

/** Feathers: overlapping rounded barbs in rows, for birds. */
function drawFeathers(ctx: Ctx, seed: number) {
  base(ctx, 126);
  const random = rng(seed);
  const rows = 11;
  const h = SIZE / rows;
  for (let row = -1; row <= rows; row += 1) {
    const cols = 9;
    const w = SIZE / cols;
    for (let col = -1; col <= cols; col += 1) {
      const cx = col * w + (row % 2 ? w * 0.5 : 0) + (random() - 0.5) * 3;
      const cy = row * h;
      ctx.beginPath();
      // A feather tip: rounded at the bottom, tapering up into the row above.
      ctx.moveTo(cx, cy - h * 0.9);
      ctx.quadraticCurveTo(cx + w * 0.55, cy - h * 0.2, cx, cy + h * 0.5);
      ctx.quadraticCurveTo(cx - w * 0.55, cy - h * 0.2, cx, cy - h * 0.9);
      const g = ctx.createLinearGradient(cx, cy - h, cx, cy + h * 0.5);
      g.addColorStop(0, "rgb(178,178,178)");
      g.addColorStop(1, "rgb(74,74,74)");
      ctx.fillStyle = g;
      ctx.fill();
      // The quill, a bright line up the middle.
      ctx.strokeStyle = "rgba(210,210,210,0.5)";
      ctx.lineWidth = 0.8;
      ctx.beginPath();
      ctx.moveTo(cx, cy + h * 0.45);
      ctx.lineTo(cx, cy - h * 0.85);
      ctx.stroke();
    }
  }
}

/**
 * Derive a roughness map from the same height field: raised parts are polished
 * by wear and sit glossier, recessed creases hold dust and go matte. Remapped
 * into a narrow band around the theme's base roughness, because the full 0–1
 * range reads as wet plastic next to chalk.
 */
function heightToRoughness(height: Ctx, low: number, high: number): HTMLCanvasElement {
  const src = height.getImageData(0, 0, SIZE, SIZE).data;
  const { el, ctx } = canvas();
  const out = ctx.createImageData(SIZE, SIZE);
  for (let i = 0; i < SIZE * SIZE; i += 1) {
    const h = src[i * 4]! / 255;
    // High height → smoother (lower roughness).
    const value = (high - (high - low) * h) * 255;
    out.data[i * 4] = value;
    out.data[i * 4 + 1] = value;
    out.data[i * 4 + 2] = value;
    out.data[i * 4 + 3] = 255;
  }
  ctx.putImageData(out, 0, 0);
  return el;
}

/** Cavity darkening from the height field: the pits are where light does not reach. */
function heightToAo(height: Ctx, strength: number): HTMLCanvasElement {
  const src = height.getImageData(0, 0, SIZE, SIZE).data;
  const { el, ctx } = canvas();
  const out = ctx.createImageData(SIZE, SIZE);
  for (let i = 0; i < SIZE * SIZE; i += 1) {
    const h = src[i * 4]! / 255;
    const ao = 1 - (1 - h) * strength;
    const value = Math.max(0, Math.min(1, ao)) * 255;
    out.data[i * 4] = value;
    out.data[i * 4 + 1] = value;
    out.data[i * 4 + 2] = value;
    out.data[i * 4 + 3] = 255;
  }
  ctx.putImageData(out, 0, 0);
  return el;
}

/** Per-theme surface recipe: which pattern, and how it behaves under light. */
const RECIPES: Record<
  CreatureTheme,
  {
    draw: (ctx: Ctx, seed: number) => void;
    /** Sobel strength → how deep the relief reads. */
    relief: number;
    roughLow: number;
    roughHigh: number;
    ao: number;
    roughness: number;
    metalness: number;
    normalScale: number;
    tiling: number;
    rim: number;
    subsurface: number;
  }
> = {
  dragon: {
    draw: (ctx, seed) => drawScales(ctx, seed, 15),
    relief: 2.6,
    roughLow: 0.24,
    roughHigh: 0.68,
    ao: 0.55,
    roughness: 0.52,
    metalness: 0.18,
    normalScale: 1.0,
    tiling: 9,
    rim: 0.5,
    subsurface: 0.25,
  },
  beast: {
    // Creased hide underneath, coat on top: the skin shows through at the roots
    // instead of the fur reading as a flat felt layer.
    draw: (ctx, seed) => {
      drawHide(ctx, seed);
      drawFur(ctx, seed + 17, false);
    },
    relief: 1.5,
    roughLow: 0.62,
    roughHigh: 0.95,
    ao: 0.5,
    roughness: 0.84,
    metalness: 0.0,
    // Fur relief has to read strongly or a coat looks like painted-on stubble.
    normalScale: 1.35,
    tiling: 7,
    rim: 0.75,
    subsurface: 0.4,
  },
  insect: {
    draw: drawCarapace,
    relief: 3.0,
    roughLow: 0.12,
    roughHigh: 0.5,
    ao: 0.62,
    roughness: 0.34,
    metalness: 0.42,
    normalScale: 0.9,
    tiling: 6,
    rim: 0.65,
    subsurface: 0.1,
  },
  elemental: {
    draw: (ctx, seed) => drawFacets(ctx, seed, false),
    relief: 3.4,
    roughLow: 0.08,
    roughHigh: 0.42,
    ao: 0.45,
    roughness: 0.28,
    metalness: 0.25,
    normalScale: 1.1,
    tiling: 5,
    rim: 0.95,
    subsurface: 0.55,
  },
  bird: {
    draw: drawFeathers,
    relief: 2.0,
    roughLow: 0.42,
    roughHigh: 0.86,
    ao: 0.52,
    roughness: 0.66,
    metalness: 0.05,
    normalScale: 1.15,
    tiling: 8,
    rim: 0.7,
    subsurface: 0.35,
  },
  construct: {
    draw: (ctx, seed) => drawFacets(ctx, seed, true),
    relief: 2.2,
    roughLow: 0.14,
    roughHigh: 0.55,
    ao: 0.5,
    roughness: 0.32,
    metalness: 0.78,
    normalScale: 0.85,
    tiling: 5,
    rim: 0.45,
    subsurface: 0.0,
  },
};

/** Everything generated so far, keyed by theme. Shared, never disposed. */
const cache = new Map<CreatureTheme, SkinProfile>();

/**
 * The surface for a theme. First call for a theme draws it (a few ms of canvas
 * work); every call after that, including for every other character wearing the
 * same theme, is a map lookup.
 */
export function skinFor(theme: CreatureTheme): SkinProfile {
  const cached = cache.get(theme);
  if (cached) return cached;

  const recipe = RECIPES[theme];
  const height = canvas();
  recipe.draw(height.ctx, 0x9e3779b9 ^ theme.length * 2654435761);

  const profile: SkinProfile = {
    normal: texture(heightToNormal(height.ctx, recipe.relief)),
    roughnessMap: texture(heightToRoughness(height.ctx, recipe.roughLow, recipe.roughHigh)),
    aoMap: texture(heightToAo(height.ctx, recipe.ao)),
    roughness: recipe.roughness,
    metalness: recipe.metalness,
    normalScale: recipe.normalScale,
    tiling: recipe.tiling,
    rim: recipe.rim,
    subsurface: recipe.subsurface,
  };
  cache.set(theme, profile);
  return profile;
}

/**
 * Apply a theme's surface to a material, and patch two things the standard
 * shader will not do on its own.
 *
 * **Rim light.** In an AR scene the background is a camera feed and the lights
 * are few; a body with no scattered edge light reads as a sticker on the video.
 * A cheap wrap term added at grazing angles fixes it, and unlike a real rim
 * light it cannot blow out the front of the body or cost a second shadow map.
 *
 * **Subsurface warmth.** Skin, membrane and fur bleed warm light through their
 * thin parts. Approximated by lifting the shadow side toward the glow colour
 * rather than letting it fall to flat black.
 *
 * Both are injected into the existing `MeshStandardMaterial` program, so the
 * material keeps shadows, tone mapping, fog and instancing — writing a custom
 * ShaderMaterial would have thrown all of that away.
 */
export function applySkin(
  material: THREE.MeshStandardMaterial,
  theme: CreatureTheme,
  options: { rimColor: THREE.Color; tiling?: number; rim?: number; subsurface?: number } = {
    rimColor: new THREE.Color(0xffffff),
  },
): SkinProfile {
  const skin = skinFor(theme);
  const repeat = options.tiling ?? skin.tiling;

  // Textures are shared, so the repeat cannot be written on them — it is a
  // property of this material's use of them. Clone the cheap wrapper (the
  // image and the GPU upload stay shared) and set the repeat on the clone.
  const normal = skin.normal.clone();
  const rough = skin.roughnessMap.clone();
  const ao = skin.aoMap.clone();
  for (const tex of [normal, rough, ao]) {
    tex.repeat.set(repeat, repeat);
    tex.needsUpdate = true;
  }

  material.normalMap = normal;
  material.normalScale = new THREE.Vector2(skin.normalScale, skin.normalScale);
  material.roughnessMap = rough;
  material.aoMap = ao;
  material.aoMapIntensity = 0.85;
  material.roughness = skin.roughness;
  material.metalness = skin.metalness;

  const rimStrength = options.rim ?? skin.rim;
  const sss = options.subsurface ?? skin.subsurface;

  material.onBeforeCompile = (shader) => {
    shader.uniforms.uRimColor = { value: options.rimColor };
    shader.uniforms.uRimStrength = { value: rimStrength };
    shader.uniforms.uSubsurface = { value: sss };

    shader.fragmentShader = shader.fragmentShader
      .replace(
        "#include <common>",
        `#include <common>
         uniform vec3 uRimColor;
         uniform float uRimStrength;
         uniform float uSubsurface;`,
      )
      // After all lighting is accumulated but before tone mapping, so the rim
      // is graded with the rest of the image instead of sitting on top of it.
      .replace(
        "#include <dithering_fragment>",
        `{
           vec3 V = normalize(vViewPosition);
           vec3 N = normalize(geometryNormal);
           float facing = 1.0 - clamp(dot(N, V), 0.0, 1.0);
           // Tightened to the silhouette: pow keeps it off the flat front.
           float rim = pow(facing, 3.0) * uRimStrength;
           // Warmth bled into the unlit side, strongest where the body is
           // thin — approximated by the same grazing term, at low power.
           float wrap = pow(facing, 1.4) * uSubsurface * 0.35;
           gl_FragColor.rgb += uRimColor * rim + diffuseColor.rgb * wrap;
         }
         #include <dithering_fragment>`,
      );
  };
  // Changing the program requires a recompile even on an already-used material.
  material.needsUpdate = true;
  return skin;
}
