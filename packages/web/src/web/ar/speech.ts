import * as THREE from "three";

/**
 * The speech bubble that floats over a character.
 *
 * Drawn into a canvas and shown as a `THREE.Sprite`, for two reasons: a sprite
 * is billboarded by the renderer, so the bubble faces the player from every
 * angle without the client tracking the camera itself; and it lives in the
 * scene rather than the HTML overlay, so it stays pinned to the character's head in
 * a WebXR session where the overlay is a flat 2D layer in front of everything.
 *
 * Depth testing is off on purpose — a line you cannot read because the character's
 * own shoulder is in front of it is worse than one that floats over the mesh.
 */

const CANVAS_W = 512;
const CANVAS_H = 176;
/** World width of the bubble in metres; height follows the canvas aspect. */
const WORLD_W = 0.66;
const FADE_S = 0.18;

export type SpeechBubble = {
  sprite: THREE.Sprite;
  /** Show a line for `ttl` seconds. Replaces whatever is on screen. */
  say: (text: string, ttl?: number) => void;
  clear: () => void;
  /** Drives the fade and the float. Called from the character's own update. */
  update: (dt: number, baseY: number) => void;
  dispose: () => void;
};

export function createSpeechBubble(accent: number): SpeechBubble {
  const canvas = document.createElement("canvas");
  canvas.width = CANVAS_W;
  canvas.height = CANVAS_H;
  const ctx = canvas.getContext("2d");

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const material = new THREE.SpriteMaterial({
    map: texture,
    transparent: true,
    opacity: 0,
    depthTest: false,
    depthWrite: false,
  });
  const sprite = new THREE.Sprite(material);
  sprite.scale.set(WORLD_W, (WORLD_W * CANVAS_H) / CANVAS_W, 1);
  sprite.visible = false;
  sprite.renderOrder = 10;

  let ttlLeft = 0;
  let opacity = 0;
  let showing = false;
  let elapsed = 0;

  const draw = (text: string) => {
    if (!ctx) return;
    ctx.clearRect(0, 0, CANVAS_W, CANVAS_H);

    const lines = wrap(ctx, text, CANVAS_W - 64, "600 34px system-ui, -apple-system, sans-serif", 3);
    const lineHeight = 42;
    const bodyH = lines.length * lineHeight;
    const boxH = Math.min(CANVAS_H - 34, bodyH + 34);
    const boxY = (CANVAS_H - 26 - boxH) / 2;

    // Panel
    ctx.fillStyle = "rgba(12, 17, 24, 0.88)";
    roundRect(ctx, 12, boxY, CANVAS_W - 24, boxH, 22);
    ctx.fill();
    ctx.strokeStyle = `#${accent.toString(16).padStart(6, "0")}`;
    ctx.lineWidth = 3;
    ctx.stroke();

    // Tail, pointing down at the character's head.
    const tailY = boxY + boxH;
    ctx.beginPath();
    ctx.moveTo(CANVAS_W / 2 - 18, tailY - 2);
    ctx.lineTo(CANVAS_W / 2 + 18, tailY - 2);
    ctx.lineTo(CANVAS_W / 2, tailY + 24);
    ctx.closePath();
    ctx.fillStyle = "rgba(12, 17, 24, 0.88)";
    ctx.fill();

    ctx.fillStyle = "#eef4ff";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    const startY = boxY + boxH / 2 - ((lines.length - 1) * lineHeight) / 2;
    for (const [index, line] of lines.entries()) {
      ctx.fillText(line, CANVAS_W / 2, startY + index * lineHeight);
    }
    texture.needsUpdate = true;
  };

  return {
    sprite,
    say(text, ttl = 4.5) {
      const trimmed = text.trim();
      if (!trimmed) return;
      draw(trimmed);
      ttlLeft = ttl;
      showing = true;
      sprite.visible = true;
    },
    clear() {
      ttlLeft = 0;
      showing = false;
    },
    update(dt, baseY) {
      elapsed += dt;
      if (showing) {
        ttlLeft -= dt;
        if (ttlLeft <= 0) showing = false;
      }
      const target = showing ? 1 : 0;
      // Linear fade rather than a spring: text that overshoots reads as a flicker.
      const step = dt / FADE_S;
      opacity += Math.max(-step, Math.min(step, target - opacity));
      material.opacity = opacity;
      sprite.visible = opacity > 0.01;
      // Rises slightly as it appears, then breathes — stops it looking pasted on.
      sprite.position.set(0, baseY + 0.06 * opacity + Math.sin(elapsed * 1.6) * 0.008, 0);
    },
    dispose() {
      texture.dispose();
      material.dispose();
    },
  };
}

/* ---------------------------------------------------------------- internals */

function wrap(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
  font: string,
  maxLines: number,
): string[] {
  ctx.font = font;
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (ctx.measureText(candidate).width <= maxWidth || !current) {
      current = candidate;
      continue;
    }
    lines.push(current);
    current = word;
    if (lines.length === maxLines) break;
  }
  if (lines.length < maxLines && current) lines.push(current);
  // Anything that did not fit is elided rather than silently dropped.
  if (lines.length === maxLines) {
    const last = lines[maxLines - 1]!;
    const consumed = lines.join(" ");
    if (consumed.length < text.length - 1) {
      let clipped = last;
      while (clipped && ctx.measureText(`${clipped}…`).width > maxWidth) {
        clipped = clipped.slice(0, -1);
      }
      lines[maxLines - 1] = `${clipped}…`;
    }
  }
  return lines;
}

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
) {
  const radius = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + w, y, x + w, y + h, radius);
  ctx.arcTo(x + w, y + h, x, y + h, radius);
  ctx.arcTo(x, y + h, x, y, radius);
  ctx.arcTo(x, y, x + w, y, radius);
  ctx.closePath();
}
