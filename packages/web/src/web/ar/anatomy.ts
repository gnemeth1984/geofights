import * as THREE from "three";

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
};

/**
 * The trunk as one surface.
 *
 * Upright bodies are lofted bottom-up: hips, waist, ribcage, chest, shoulders.
 * The waist pinch and the chest swell are what stop an upright creature
 * reading as a barrel — they are small numbers, but they are the difference
 * between a body and a bin.
 *
 * Horizontal bodies are lofted the same way and then laid down, so the axis
 * runs rump to chest with the ribcage widest just behind the shoulder, the way
 * a four-legged animal carries its weight.
 */
export function buildTorso(spec: TorsoSpec): THREE.BufferGeometry {
  const { width, height, length, upright, bulk } = spec;
  const swell = 0.9 + bulk * 0.35;
  const pinch = 1 - bulk * 0.12;

  if (upright) {
    const halfW = width * 0.5;
    const halfD = length * 0.5;
    // Stations bottom to top, as a share of trunk height.
    const rings: Ring[] = [
      { y: -height * 0.5, rx: halfW * 0.78 * swell, rz: halfD * 0.82, z: -length * 0.01 },
      { y: -height * 0.3, rx: halfW * 0.9 * swell, rz: halfD * 0.92, z: length * 0.01 },
      { y: -height * 0.08, rx: halfW * 0.8 * pinch, rz: halfD * 0.8 * pinch, z: 0 },
      { y: height * 0.16, rx: halfW * 0.98 * swell, rz: halfD * 1.0 * swell, z: length * 0.03 },
      { y: halfD > 0 ? height * 0.38 : height * 0.38, rx: halfW * 1.0, rz: halfD * 0.94, z: length * 0.02 },
      { y: height * 0.5, rx: halfW * 0.72, rz: halfD * 0.7, z: 0 },
    ];
    return loft(rings, { capStart: true, capEnd: true, capRise: 0.55 });
  }

  // Laid down: loft along Y first, then rotate so +Y becomes forward (+Z).
  const halfW = width * 0.5;
  const halfH = height * 0.5;
  const rings: Ring[] = [
    // Rump, dropping toward the tail root.
    { y: -length * 0.5, rx: halfW * 0.72 * swell, rz: halfH * 0.74, z: -height * 0.04 },
    { y: -length * 0.28, rx: halfW * 0.94 * swell, rz: halfH * 0.96 * swell, z: -height * 0.02 },
    // Belly: narrower than the haunches and the ribs, which is what gives a
    // four-legged body a waist when seen from above.
    { y: -length * 0.05, rx: halfW * 0.84 * pinch, rz: halfH * 0.9, z: 0 },
    // Ribcage, the widest point, sitting just behind the shoulder.
    { y: length * 0.2, rx: halfW * 1.0 * swell, rz: halfH * 1.0 * swell, z: height * 0.02 },
    { y: length * 0.38, rx: halfW * 0.88, rz: halfH * 0.9, z: height * 0.05 },
    // Chest, tapering into where the neck will sit.
    { y: length * 0.5, rx: halfW * 0.66, rz: halfH * 0.68, z: height * 0.07 },
  ];
  const geometry = loft(rings, { capStart: true, capEnd: true, capRise: 0.5 });
  geometry.rotateX(Math.PI / 2);
  return geometry;
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
 * A limb in two tapered segments with a real joint between them.
 *
 * The old legs were one capsule positioned at its own middle, so a swing
 * rotated the leg about its centre — the foot went forward and the hip went
 * backward, through the body. Here the pivot sits at the top where a hip
 * belongs, the shaft tapers, and a ball of mass at the knee and at the hip
 * keeps the surface unbroken at every angle the joint reaches.
 */
export function buildLimb(spec: LimbSpec, material: THREE.Material): Limb {
  const { length, rootRadius, tipRadius } = spec;
  const jointBulge = spec.joint ?? 1.25;
  const upper = length * 0.52;
  const lower = length - upper;

  const pivot = new THREE.Group();

  // Hip / shoulder mass. Sits at the pivot so it never moves off the body,
  // which is what hides the join no matter how far the limb swings.
  const socketGeo = new THREE.SphereGeometry(rootRadius * jointBulge, 10, 8);
  const socket = new THREE.Mesh(socketGeo, material);
  socket.castShadow = true;
  pivot.add(socket);

  // Thigh / upper arm: lofted downward from the pivot, swelling at the top.
  const upperGeo = loft(
    [
      { y: -upper, rx: rootRadius * 0.74, rz: rootRadius * 0.74 },
      { y: -upper * 0.62, rx: rootRadius * 0.82, rz: rootRadius * 0.86 },
      { y: -upper * 0.2, rx: rootRadius * 1.0, rz: rootRadius * 1.04 },
      { y: 0, rx: rootRadius * 0.94, rz: rootRadius * 0.98 },
    ],
    { radial: 10 },
  );
  const upperMesh = new THREE.Mesh(upperGeo, material);
  upperMesh.castShadow = true;
  pivot.add(upperMesh);

  const joint = new THREE.Group();
  joint.position.y = -upper;
  pivot.add(joint);

  const kneeGeo = new THREE.SphereGeometry(rootRadius * 0.82 * jointBulge, 10, 8);
  const knee = new THREE.Mesh(kneeGeo, material);
  knee.castShadow = true;
  joint.add(knee);

  // Shank / forearm, tapering to the ankle.
  const lowerGeo = loft(
    [
      { y: -lower, rx: tipRadius * 0.9, rz: tipRadius * 0.95 },
      { y: -lower * 0.55, rx: tipRadius * 1.05, rz: tipRadius * 1.15 },
      { y: 0, rx: rootRadius * 0.78, rz: rootRadius * 0.8 },
    ],
    { radial: 10 },
  );
  const lowerMesh = new THREE.Mesh(lowerGeo, material);
  lowerMesh.castShadow = true;
  joint.add(lowerMesh);

  const geometries = [socketGeo, upperGeo, kneeGeo, lowerGeo];

  if (spec.foot) {
    // A foot, so the body stands on something instead of ending in a point.
    // Lofted flat and pushed forward of the ankle, like a real one is.
    const footGeo = loft(
      [
        { y: -tipRadius * 0.7, rx: tipRadius * 1.1, rz: tipRadius * 1.6, z: tipRadius * 0.5 },
        { y: 0, rx: tipRadius * 1.25, rz: tipRadius * 2.0, z: tipRadius * 0.7 },
        { y: tipRadius * 0.8, rx: tipRadius * 1.0, rz: tipRadius * 1.3, z: tipRadius * 0.2 },
      ],
      { radial: 10, capStart: true, capEnd: true, capRise: 0.35 },
    );
    const footMesh = new THREE.Mesh(footGeo, material);
    footMesh.castShadow = true;
    footMesh.position.y = -lower;
    joint.add(footMesh);
    geometries.push(footGeo);
  }

  return { pivot, joint, geometries };
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
