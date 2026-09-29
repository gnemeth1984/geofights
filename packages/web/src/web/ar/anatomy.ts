import * as THREE from "three";

import { type Mass, sculpt } from "./sculpt";

/**
 * Anatomy: continuous procedural bodies, built from maths at runtime.
 *
 * What was here before was primitives standing next to each other — a box or a
 * capsule for the trunk, a capsule per leg, a sphere head floating above a gap
 * where a neck should be. That is what made the creatures read as toys: real
 * bodies are one surface that swells at the ribs, pinches at the waist, and
 * carries a mass at every joint so nothing ever shows a seam.
 *
 * So bodies are lofted instead. A body part is a list of cross-sections — a
 * ring with its own width, depth and offset — and the loft threads a single
 * closed surface through them. Change the profile and the same code builds a
 * barrel-chested brute, a whippet, or a serpent; the "any form or shape"
 * promise is kept, and there is still nothing to download.
 *
 * Nothing in here knows about animation. Everything it returns is either a
 * plain geometry or a group whose pivot sits where a real joint would, so the
 * existing channels keep driving bodies exactly as they did.
 */

/**
 * One cross-section of a lofted part, in the loft's canonical space: the axis
 * runs up +Y and the section is an ellipse in XZ.
 *
 * `x` and `z` bend the axis away from straight, which is how a chest that sits
 * forward of the hips or a tail that curves is described.
 */
export type Ring = {
  y: number;
  /** Half-width, across the body. */
  rx: number;
  /** Half-depth, front to back. */
  rz: number;
  x?: number;
  z?: number;
};

export type LoftOptions = {
  /** Vertices around each ring. 12 is plenty at phone scale. */
  radial?: number;
  /** Round the -Y end over, instead of leaving it open. */
  capStart?: boolean;
  /** Round the +Y end over. */
  capEnd?: boolean;
  /** How far the rounded cap bulges, as a share of the end ring's width. */
  capRise?: number;
};

/**
 * Thread one closed surface through a list of rings.
 *
 * Rings are expected in ascending `y`. Caps are built as extra rings following
 * a quarter-circle out to a pole, so an end reads as a rounded snout or a rump
 * rather than a flat lid — the giveaway of a lathed primitive.
 *
 * The seam vertex is duplicated (the ring is walked `radial + 1` times) so the
 * UVs run 0..1 around the body without a wrapped triangle at the join. Those
 * UVs are what the procedural skin maps tile across.
 */
export function loft(rings: Ring[], options: LoftOptions = {}): THREE.BufferGeometry {
  const radial = options.radial ?? 12;
  const capRise = options.capRise ?? 0.8;
  const rows: Ring[] = [];

  if (options.capStart && rings[0]) {
    const first = rings[0];
    const rise = Math.max(first.rx, first.rz) * capRise;
    // Quarter circle inward and downward, nearest ring last.
    for (let step = CAP_STEPS; step >= 1; step -= 1) {
      const t = step / (CAP_STEPS + 1);
      const shrink = Math.sqrt(Math.max(0, 1 - t * t));
      rows.push({
        y: first.y - rise * t,
        rx: first.rx * shrink,
        rz: first.rz * shrink,
        x: first.x,
        z: first.z,
      });
    }
  }

  rows.push(...rings);

  if (options.capEnd) {
    const last = rings[rings.length - 1]!;
    const rise = Math.max(last.rx, last.rz) * capRise;
    for (let step = 1; step <= CAP_STEPS; step += 1) {
      const t = step / (CAP_STEPS + 1);
      const shrink = Math.sqrt(Math.max(0, 1 - t * t));
      rows.push({
        y: last.y + rise * t,
        rx: last.rx * shrink,
        rz: last.rz * shrink,
        x: last.x,
        z: last.z,
      });
    }
  }

  const positions: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];
  const columns = radial + 1;

  // Total axial length, so v runs evenly along the surface rather than per-row
  // (an evenly-indexed v would stretch the pattern wherever rings bunch up).
  const spans: number[] = [0];
  for (let row = 1; row < rows.length; row += 1) {
    const previous = rows[row - 1]!;
    const current = rows[row]!;
    spans.push(
      spans[row - 1]! +
        Math.hypot(
          current.y - previous.y,
          (current.x ?? 0) - (previous.x ?? 0),
          (current.z ?? 0) - (previous.z ?? 0),
        ) +
        1e-5,
    );
  }
  const total = spans[spans.length - 1]!;

  for (const [row, ring] of rows.entries()) {
    const cx = ring.x ?? 0;
    const cz = ring.z ?? 0;
    for (let column = 0; column < columns; column += 1) {
      const angle = (column / radial) * Math.PI * 2;
      positions.push(
        cx + Math.cos(angle) * ring.rx,
        ring.y,
        cz + Math.sin(angle) * ring.rz,
      );
      uvs.push(column / radial, spans[row]! / total);
    }
  }

  // Poles, so a cap closes to a point instead of a pinhole.
  const startPole = options.capStart ? positions.length / 3 : -1;
  if (options.capStart && rows[0]) {
    const first = rows[0];
    positions.push(first.x ?? 0, first.y - Math.max(first.rx, first.rz) * 0.25, first.z ?? 0);
    uvs.push(0.5, 0);
  }
  const endPole = options.capEnd ? positions.length / 3 : -1;
  if (options.capEnd) {
    const last = rows[rows.length - 1]!;
    positions.push(last.x ?? 0, last.y + Math.max(last.rx, last.rz) * 0.25, last.z ?? 0);
    uvs.push(0.5, 1);
  }

  for (let row = 0; row < rows.length - 1; row += 1) {
    for (let column = 0; column < radial; column += 1) {
      const a = row * columns + column;
      const b = a + 1;
      const c = a + columns;
      const d = c + 1;
      indices.push(a, c, b, b, c, d);
    }
  }
  if (startPole >= 0) {
    for (let column = 0; column < radial; column += 1) {
      indices.push(startPole, column, column + 1);
    }
  }
  if (endPole >= 0) {
    const base = (rows.length - 1) * columns;
    for (let column = 0; column < radial; column += 1) {
      indices.push(endPole, base + column + 1, base + column);
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

/** Cap rings per end. Two is enough to read as round and costs almost nothing. */
const CAP_STEPS = 2;

/* -------------------------------------------------------------------- torso */

export type TorsoSpec = {
  /** Full width across the shoulders, in metres. */
  width: number;
  /** Full height of the trunk. */
  height: number;
  /** Full depth, nose to tail. */
  length: number;
  /** An upright body stands on its hips; a horizontal one runs front to back. */
  upright: boolean;
  /** 0 lean, 1 heavy. Drives how far the chest and haunches swell. */
  bulk: number;
  /**
   * Where limbs leave the body, in the trunk's own space.
   *
   * The shoulder and hip masses used to be spheres parented to the *limb*,
   * pushed into the chest to hide the join — two surfaces crossing, which is a
   * hard crease exactly where a body should be softest. Given the anchors, the
   * trunk grows its own shoulder shelf and haunches instead, so the mass that
   * covers the join is part of the same surface as the ribs.
   */
  sockets?: ReadonlyArray<{ at: readonly [number, number, number]; r: number }>;
};

/** An ellipsoidal lump, described by its three radii rather than a scale. */
export function lump(
  at: readonly [number, number, number],
  rx: number,
  ry: number,
  rz: number,
): Mass {
  return { kind: "ball", at, r: 1, scale: [Math.max(1e-3, rx), Math.max(1e-3, ry), Math.max(1e-3, rz)] };
}

/**
 * The trunk as one continuous surface.
 *
 * Described as overlapping masses — hips, waist, ribcage, chest, shoulder
 * shelf, plus a socket lump wherever a limb leaves — and resolved into a single
 * shell by {@link sculpt}'s smooth union. Nothing in the result records where
 * one mass stopped: the waist pinch, the chest swell and the haunches are all
 * one skin, and every limb join arrives already filleted.
 *
 * This replaces a lofted ring stack. The loft was continuous along its own axis
 * but could only ever be a tube: it had no way to carry a shoulder that stands
 * proud of the ribs, so the shoulders had to be separate balls, which is what
 * made the bodies read as assembled parts.
 */
export function buildTorso(spec: TorsoSpec): THREE.BufferGeometry {
  const { width, height, length, upright, bulk } = spec;
  const swell = 0.9 + bulk * 0.35;
  const pinch = 1 - bulk * 0.12;
  const halfW = width * 0.5;
  const halfH = height * 0.5;
  const halfD = length * 0.5;
  // The fillet that hides every join. Scaled off the body's smallest dimension
  // so a lithe creature does not get welded into a sausage.
  const blend = Math.min(0.12, Math.max(0.012, Math.min(width, height, length) * 0.3));
  const masses: Mass[] = [];

  if (upright) {
    // Bottom to top: haunches, waist, ribcage, shoulder shelf.
    masses.push(
      lump([0, -halfH * 0.58, -length * 0.02], halfW * 0.84 * swell, halfH * 0.46, halfD * 0.88),
      lump([0, -halfH * 0.14, 0], halfW * 0.76 * pinch, halfH * 0.32, halfD * 0.76 * pinch),
      lump([0, halfH * 0.24, length * 0.04], halfW * 0.96 * swell, halfH * 0.4, halfD * 0.98 * swell),
      lump([0, halfH * 0.56, length * 0.01], halfW * 0.9, halfH * 0.4, halfD * 0.8),
      // Belly: a little mass low and forward, so the front of the body is not a
      // straight line from chest to hip.
      lump([0, -halfH * 0.3, halfD * 0.22], halfW * 0.6 * swell, halfH * 0.3, halfD * 0.62),
    );
  } else {
    // Laid down: the same stations, but along Z with the ribcage just behind
    // the shoulder, which is where a four-legged body carries its weight.
    masses.push(
      lump([0, 0, -halfD * 0.66], halfW * 0.76 * swell, halfH * 0.78, halfD * 0.42),
      lump([0, -height * 0.04, -halfD * 0.2], halfW * 0.86 * pinch, halfH * 0.88, halfD * 0.4),
      lump([0, height * 0.02, halfD * 0.24], halfW * 0.98 * swell, halfH * 0.98 * swell, halfD * 0.44),
      lump([0, height * 0.06, halfD * 0.66], halfW * 0.7, halfH * 0.72, halfD * 0.4),
    );
  }

  for (const socket of spec.sockets ?? []) {
    // Anchors are clamped into the trunk's own box before they are used: a leg
    // that starts a long way below the body is a long leg, not a reason for the
    // hips to stretch down to the floor after it.
    const x = Math.max(-halfW, Math.min(halfW, socket.at[0]));
    const y = Math.max(-halfH * 0.92, Math.min(halfH * 0.92, socket.at[1]));
    const z = Math.max(-halfD, Math.min(halfD, socket.at[2]));
    // Deliberately smaller than the limb that lands on it, and pulled inboard:
    // the shelf only has to cover the join. Sized to reach the limb and it
    // swallows the arm instead, and the body loses the outline that says it has
    // arms at all.
    masses.push(lump([x * 0.7, y, z], socket.r * 0.72, socket.r * 0.8, socket.r * 0.86));
  }

  return sculpt(masses, {
    blend,
    cell: Math.max(width, height, length) / 24,
    maxCells: 30,
    uvAxis: upright ? "y" : "z",
  });
}

/* -------------------------------------------------------------------- skull */

export type SkullSpec = {
  /** Head radius. The skull is built around this and squashed from it. */
  radius: number;
  /** A muzzle pushed out of the front of the skull, for themes that want one. */
  muzzle: boolean;
  /** Cheek volume either side, 0 for a smooth dome. */
  cheeks: number;
};

/**
 * The skull as one surface, muzzle included.
 *
 * The muzzle was a second sphere parked on the front of the head sphere, and at
 * chibi proportions — where the head *is* the character — that join was the
 * most visible crease on the whole body, right in the middle of the face. Here
 * the skull, the cheeks and the muzzle are masses in one sculpt, so the snout
 * grows out of the face instead of being stuck to it.
 *
 * The jaw stays a separate mesh: it is hinged and animated, and nothing that
 * swings can be part of the surface it swings away from.
 */
export function buildSkull(spec: SkullSpec): THREE.BufferGeometry {
  const r = spec.radius;
  const masses: Mass[] = [
    lump([0, 0, 0], r * 0.94, r * 1.04, r),
    // Back of the skull, which is where the references carry their weight.
    lump([0, r * 0.06, -r * 0.3], r * 0.9, r * 0.92, r * 0.82),
  ];
  if (spec.cheeks > 0) {
    for (const side of [-1, 1]) {
      masses.push(
        lump(
          [side * r * 0.56, -r * 0.16, r * 0.24],
          r * 0.4 * spec.cheeks,
          r * 0.34 * spec.cheeks,
          r * 0.38 * spec.cheeks,
        ),
      );
    }
  }
  if (spec.muzzle) {
    // One mass, sized and placed where the old muzzle sphere was. What was
    // wrong with the two-sphere head was the crease where the sphere met the
    // face, not the snout it made: a ball this wide protruding this far is
    // what reads as a snout on a head this round, and the tight blend below
    // is enough to fillet the join without changing the profile.
    //
    // A muzzle split into a bridge and a tip was tried first and spread wider
    // and shallower than this — the face read flat, which is the opposite of
    // the point. It sits high for the jaw's sake: the jaw is a separate hinged
    // mesh under the snout, and the only thing on a primitive face that reads
    // as a mouth, so a muzzle reaching further down swallows it and a bite
    // animates nothing.
    masses.push(lump([0, -r * 0.22, r * 0.82], r * 0.47, r * 0.37, r * 0.55));
  }
  return sculpt(masses, {
    // A face is read closer than anything else on the body, so it is the one
    // part worth spending cells on. The blend is tight for the same reason:
    // the fillet is meant to round the join, not to average the snout into
    // the skull.
    blend: r * 0.14,
    cell: r / 11,
    maxCells: 30,
    uvAxis: "y",
  });
}

/* ---------------------------------------------------------------- tail link */

export type TailLinkSpec = {
  /** Radius at this link's own joint. */
  radius: number;
  /** Radius at the next joint out. */
  nextRadius: number;
  /** Distance to the next joint along -Z. */
  step: number;
  /** How far the chain drops per link, so the link can follow the droop. */
  drop: number;
};

/**
 * One link of a tail, as a solid that spans the gap to its neighbours.
 *
 * A tail has to be a chain — the whip lag is the whole point, and lag needs
 * separately rotatable pieces — but it does not have to be a row of beads,
 * which is what a sphere per joint looked like. Each link is a tapered rod
 * running from *behind* its own joint to *past* the next one, so consecutive
 * links interpenetrate by about a quarter of their length. The overlap is what
 * closes the silhouette at rest and keeps it closed through a swing.
 */
export function buildTailLink(spec: TailLinkSpec): THREE.BufferGeometry {
  const { radius, nextRadius, step, drop } = spec;
  const back = step * 0.34;
  const front = step * 1.18;
  return sculpt(
    [
      {
        kind: "rod",
        from: [0, (drop * back) / step, back],
        to: [0, -(drop * front) / step, -front],
        r: radius,
        toR: Math.max(radius * 0.4, nextRadius * 0.96),
      },
      // A little mass on the joint itself, kept *inside* the rod's own surface.
      // It exists to fill the inner corner when the chain bends — a link wider
      // than the rod that runs through it would scallop the silhouette at every
      // joint, which is the bead chain again by another name.
      lump([0, 0, 0], radius * 0.86, radius * 0.84, radius * 0.84),
    ],
    {
      blend: radius * 0.5,
      cell: Math.max(0.004, radius * 0.4),
      maxCells: 22,
      uvAxis: "z",
    },
  );
}

/* --------------------------------------------------------------------- neck */

export type NeckSpec = {
  /** Where the neck leaves the trunk, in rig space. */
  from: THREE.Vector3;
  /** Where it meets the skull, in rig space. */
  to: THREE.Vector3;
  /** Half-width at the trunk end. */
  rootRadius: number;
  /** Half-width at the skull end. */
  tipRadius: number;
};

/**
 * A neck, which the bodies did not have at all — the head simply hovered over
 * the trunk. Lofted along the line between the two, slightly S-curved and
 * thicker at the root, and deliberately overshooting into both the trunk and
 * the skull so neither join can show a seam.
 *
 * Returned as a mesh already positioned and aimed in rig space, so the caller
 * only has to add it. It is not parented to the head: the head group is
 * animated and a neck that swung with it would tear out of the chest.
 */
export function buildNeck(spec: NeckSpec): { geometry: THREE.BufferGeometry; quaternion: THREE.Quaternion; position: THREE.Vector3 } {
  const span = spec.from.distanceTo(spec.to);
  const length = Math.max(0.02, span);
  const rings: Ring[] = [];
  const stations = 5;
  for (let step = 0; step <= stations; step += 1) {
    const t = step / stations;
    // Cubic ease from root to tip: thick where it leaves the body, slim at the
    // skull, with the taper front-loaded the way a real neck's is.
    const radius = spec.rootRadius + (spec.tipRadius - spec.rootRadius) * (t * t * (3 - 2 * t));
    rings.push({
      y: -length * 0.12 + length * 1.12 * t,
      rx: radius,
      // Necks are deeper than they are wide, and the curve pushes the middle
      // forward so the head sits ahead of the chest rather than straight up.
      rz: radius * 1.12,
      z: Math.sin(t * Math.PI) * length * 0.08,
    });
  }
  const geometry = loft(rings, { radial: 10 });
  const direction = spec.to.clone().sub(spec.from).normalize();
  const quaternion = new THREE.Quaternion().setFromUnitVectors(
    new THREE.Vector3(0, 1, 0),
    direction,
  );
  return { geometry, quaternion, position: spec.from.clone() };
}

/* --------------------------------------------------------------------- limb */

export type LimbSpec = {
  /** Total limb length, hip to foot. */
  length: number;
  /** Radius at the hip or shoulder. */
  rootRadius: number;
  /** Radius at the ankle or wrist. */
  tipRadius: number;
  /** How far the joint bulges past the shaft, as a share of its radius. */
  joint?: number;
  /** A leg carries a foot plate; an arm does not. */
  foot?: boolean;
};

export type Limb = {
  /** Pivot at the hip or shoulder — this is what rotation channels drive. */
  pivot: THREE.Group;
  /**
   * Pivot at the knee or elbow, already parented under `pivot`. Driving it
   * from the hip rotation is what makes a stride bend instead of swinging
   * rigid, and it needs no new animation channel to do it.
   */
  joint: THREE.Group;
  geometries: THREE.BufferGeometry[];
};

/**
 * A limb in two sculpted segments with a real joint between them.
 *
 * Two meshes, not four. A limb has to bend, so it cannot be a single surface —
 * but everything on one side of the knee now is: the hip socket, the thigh and
 * the top half of the knee are one sculpt, and the bottom of the knee, the
 * shank and the foot are another. What used to be four primitives crossing
 * each other at three visible creases is now one crease-free shape per segment,
 * and the only remaining overlap is ball-inside-ball at the knee, which reads
 * as a joint rather than as a seam however far it swings.
 *
 * The pivot still sits at the top where a hip belongs, so a swing carries the
 * foot forward without driving the hip back through the body.
 */
export function buildLimb(spec: LimbSpec, material: THREE.Material): Limb {
  const { length, rootRadius, tipRadius } = spec;
  const jointBulge = spec.joint ?? 1.25;
  const upper = length * 0.52;
  const lower = length - upper;
  // Fillet off the limb's own thickness: a thick leg blends softly, a thin arm
  // stays an arm instead of being welded into a sausage.
  const blend = Math.max(0.008, rootRadius * 0.6);
  // Cell size chosen across the limb rather than along it — the thin axis is
  // the one that decides whether it reads as round.
  const cell = Math.max(0.006, rootRadius * 0.42);
  const knee = rootRadius * 0.82 * jointBulge;

  const pivot = new THREE.Group();

  // Hip / shoulder, thigh and the upper half of the knee, as one surface. The
  // socket mass sits on the pivot so it never moves off the body, which is
  // what keeps the join to the trunk covered at any angle.
  const upperGeo = sculpt(
    [
      // The socket no longer has to be big enough to hide the join on its own —
      // the trunk grows its own shelf to meet it — so it is barely proud of the
      // shaft, which is what keeps a limb reading as a limb.
      lump([0, 0, 0], rootRadius * jointBulge * 0.84, rootRadius * jointBulge * 0.8, rootRadius * jointBulge * 0.84),
      { kind: "rod", from: [0, -rootRadius * 0.2, 0], to: [0, -upper, 0], r: rootRadius * 0.95, toR: rootRadius * 0.7 },
      // Belly of the thigh, forward and slightly outboard of the shaft.
      lump([0, -upper * 0.38, rootRadius * 0.12], rootRadius * 0.92, upper * 0.3, rootRadius * 0.98),
      lump([0, -upper, 0], knee * 0.92, knee * 0.86, knee * 0.92),
    ],
    { blend, cell, maxCells: 26, uvAxis: "y" },
  );
  const upperMesh = new THREE.Mesh(upperGeo, material);
  upperMesh.castShadow = true;
  pivot.add(upperMesh);

  const joint = new THREE.Group();
  joint.position.y = -upper;
  pivot.add(joint);

  // Knee underside, shank and foot, again as one surface.
  const lowerMasses: Mass[] = [
    lump([0, 0, 0], knee * 0.88, knee * 0.84, knee * 0.88),
    { kind: "rod", from: [0, 0, 0], to: [0, -lower, 0], r: rootRadius * 0.76, toR: tipRadius * 0.92 },
    // Calf: mass behind the shin, high up, which is where a leg carries it.
    lump([0, -lower * 0.34, -tipRadius * 0.3], tipRadius * 1.0, lower * 0.26, tipRadius * 1.15),
  ];
  if (spec.foot) {
    // A foot, so the body stands on something instead of ending in a point.
    // Flattened and pushed forward of the ankle, like a real one is.
    lowerMasses.push(
      lump([0, -lower + tipRadius * 0.15, tipRadius * 0.5], tipRadius * 1.2, tipRadius * 0.62, tipRadius * 1.85),
    );
  }
  const lowerGeo = sculpt(lowerMasses, {
    blend: blend * 0.85,
    cell: Math.max(0.006, tipRadius * 0.46),
    maxCells: 26,
    uvAxis: "y",
  });
  const lowerMesh = new THREE.Mesh(lowerGeo, material);
  lowerMesh.castShadow = true;
  joint.add(lowerMesh);

  return { pivot, joint, geometries: [upperGeo, lowerGeo] };
}

/* -------------------------------------------------------------- spine chain */

export type SpineSpec = {
  /** One bone per body segment, at these offsets along the body axis. */
  offsets: number[];
  /** Rest height of the body in rig space, which the bones are placed at. */
  baseY: number;
  /** Half-width at the thickest point. */
  girth: number;
  /** Depth relative to width. */
  depth: number;
  /** How far the body tapers by the far end, 0..1. */
  taper: number;
};

export type Spine = {
  mesh: THREE.SkinnedMesh;
  /**
   * The bones, in the same order as `offsets`. These are `Object3D`s, so the
   * existing per-segment animation writes to them unchanged — and because the
   * surface is skinned to them, a serpent now bends as one body instead of
   * sliding a row of separate spheres past each other.
   */
  bones: THREE.Bone[];
  geometry: THREE.BufferGeometry;
};

/**
 * A long body as one skinned surface over a chain of bones.
 *
 * This is the case that genuinely needs skinning: serpents and insect bodies
 * are animated by moving each segment independently, and with detached
 * primitives that shows as beads on a string. Bound to bones, the same motion
 * deforms a single continuous body.
 *
 * Weights are linear between the two nearest bones, which for a chain this
 * coarse is both correct and the cheapest thing the GPU can skin.
 */
export function buildSpine(spec: SpineSpec, material: THREE.Material): Spine {
  const { offsets, girth, depth, taper } = spec;
  const bones: THREE.Bone[] = [];
  // Bones are siblings under one root, not a parented chain: the animation
  // writes an absolute position per segment, which a chain would compound.
  const root = new THREE.Bone();
  for (const offset of offsets) {
    const bone = new THREE.Bone();
    // Bones rest at the body's own height, so the animation's absolute
    // per-segment writes need no rebasing to reach the same place.
    bone.position.set(0, spec.baseY, offset);
    root.add(bone);
    bones.push(bone);
  }

  const first = offsets[0]!;
  const last = offsets[offsets.length - 1]!;
  const rings: Ring[] = [];
  const stations = Math.max(8, offsets.length * 3);
  for (let step = 0; step <= stations; step += 1) {
    const t = step / stations;
    const z = first + (last - first) * t;
    // Thickest a third of the way from the head end, then tapering away.
    const swell = Math.sin(Math.min(1, t * 1.15 + 0.12) * Math.PI) * 0.35 + 0.72;
    const scale = swell * (1 - taper * t);
    rings.push({ y: z, rx: girth * scale, rz: girth * depth * scale });
  }
  const geometry = loft(rings, { radial: 12, capStart: true, capEnd: true, capRise: 0.7 });
  // Lofted along Y, but a spine runs along Z — then lifted to the bones' own
  // height, so the bind pose is the rest pose and binding is a no-op.
  geometry.rotateX(Math.PI / 2);
  geometry.translate(0, spec.baseY, 0);

  // Skin the surface to the bones by position along the body axis.
  const position = geometry.getAttribute("position");
  const indices: number[] = [];
  const weights: number[] = [];
  for (let vertex = 0; vertex < position.count; vertex += 1) {
    const z = position.getZ(vertex);
    // Nearest bone, and the next one toward the vertex.
    let nearest = 0;
    for (let bone = 1; bone < offsets.length; bone += 1) {
      if (Math.abs(offsets[bone]! - z) < Math.abs(offsets[nearest]! - z)) nearest = bone;
    }
    const toward = offsets[nearest]! < z ? nearest + 1 : nearest - 1;
    const second = toward >= 0 && toward < offsets.length ? toward : nearest;
    const gap = Math.abs(offsets[second]! - offsets[nearest]!);
    const share = gap > 1e-6 ? Math.min(0.5, Math.abs(z - offsets[nearest]!) / gap) : 0;
    indices.push(nearest, second, 0, 0);
    weights.push(1 - share, share, 0, 0);
  }
  geometry.setAttribute("skinIndex", new THREE.Uint16BufferAttribute(indices, 4));
  geometry.setAttribute("skinWeight", new THREE.Float32BufferAttribute(weights, 4));

  const mesh = new THREE.SkinnedMesh(geometry, material);
  mesh.castShadow = true;
  // `bindMode: detached` is not wanted here — the default binds to the mesh's
  // own world matrix, which is what keeps the body under the rig's transform.
  mesh.add(root);
  mesh.bind(new THREE.Skeleton(bones));
  return { mesh, bones, geometry };
}
