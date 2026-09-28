import * as THREE from "three";

/**
 * Wings.
 *
 * What was here before was a three-sided cone squashed flat on one axis, which
 * is a triangle however it is lit — and the same triangle was placed on both
 * sides with one fixed rotation, so a pair never mirrored: both wings pointed
 * the same way and the creature read as having been assembled wrong.
 *
 * A wing is not a triangle. It is a limb with a membrane hung off it, or a fan
 * of feathers, or a pair of long veined panels — so that is what this builds,
 * per theme, from the same maths the rest of the anatomy uses. Every wing is
 * built as a *right* wing extending along +X, and the left one is the same
 * geometry mirrored (`scale.x = -1`), which is the only way a pair is
 * guaranteed symmetric: there is one shape, and the other side is its
 * reflection rather than a second attempt at the same silhouette.
 *
 * Nothing in here knows about animation. The returned group is meant to be
 * added to a pivot that the animation pass rotates — flap about Z, fold about
 * Y — exactly as before.
 */

export type WingStyle = "membrane" | "feathered" | "insect" | "plated";

export type WingMaterials = {
  /** The translucent surface: membrane, flight feather, insect panel. */
  membrane: THREE.Material;
  /** Opaque structure: the arm bone, the finger spars, the leading edge. */
  bone: THREE.Material;
  /** Trim: coverts, veins, spar highlights. */
  accent: THREE.Material;
};

/** A wing, as a group extending +X from its root, and what it allocated. */
export type Wing = {
  group: THREE.Group;
  geometries: THREE.BufferGeometry[];
};

/**
 * Which wing a theme wears. Feathers for a bird, long veined panels for an
 * insect, panelled hard surfaces for a construct, and a bat/dragon membrane
 * for everything else — which is also the sane fallback, since a membrane is
 * the wing shape that reads on any body.
 */
export function wingStyleFor(theme: string): WingStyle {
  if (theme === "bird") return "feathered";
  if (theme === "insect") return "insect";
  if (theme === "construct") return "plated";
  return "membrane";
}

/** Cylinder between two points in the wing plane, for bones and spars. */
function strut(
  from: [number, number],
  to: [number, number],
  radius: number,
  material: THREE.Material,
  geometries: THREE.BufferGeometry[],
): THREE.Mesh {
  const a = new THREE.Vector3(from[0], 0, -from[1]);
  const b = new THREE.Vector3(to[0], 0, -to[1]);
  const dir = b.clone().sub(a);
  const length = Math.max(0.0001, dir.length());
  const geometry = new THREE.CylinderGeometry(radius, radius * 0.62, length, 6, 1, false);
  geometries.push(geometry);
  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.copy(a).addScaledVector(dir, 0.5);
  mesh.quaternion.setFromUnitVectors(
    new THREE.Vector3(0, 1, 0),
    dir.normalize(),
  );
  mesh.castShadow = true;
  return mesh;
}

/**
 * Lay a flat shape into the wing plane and give it a camber.
 *
 * Shapes are authored in XY — +X out along the span, +Y back toward the tail —
 * because that is the space a 2D outline is readable in. The rotation drops
 * that plane into the body's XZ, and the camber is what stops the result from
 * being a decal: a real wing sags away from its leading edge and droops toward
 * the tip, so the vertices are pushed down by how far back and how far out
 * they sit. Cheap, and it is the difference between a surface that catches the
 * light across its width and a flat sheet that flips between two shades.
 */
function layFlat(shape: THREE.Shape, span: number, curves: number, droop: number) {
  const geometry = new THREE.ShapeGeometry(shape, curves);
  geometry.rotateX(-Math.PI / 2);
  const position = geometry.attributes.position!;
  for (let i = 0; i < position.count; i += 1) {
    const x = position.getX(i);
    const z = position.getZ(i);
    // Behind-ness: 0 on the leading edge, 1 at the deepest point of the chord.
    const back = Math.max(0, -z) / (span * 0.34);
    const out = Math.abs(x) / span;
    position.setY(i, -droop * span * (back * 0.6 + out * out * 0.5));
  }
  geometry.computeVertexNormals();
  return geometry;
}

/** Cusps along the trailing edge, back to front: tip, three scallops, root. */
const MEMBRANE_TRAILING: Array<{ cusp: [number, number]; control: [number, number] }> = [
  { cusp: [0.72, 0.28], control: [0.9, 0.04] },
  { cusp: [0.46, 0.32], control: [0.6, 0.1] },
  { cusp: [0.22, 0.3], control: [0.34, 0.12] },
  { cusp: [0.02, 0.08], control: [0.12, 0.16] },
];

/**
 * Bat/dragon wing: an arm out to a wrist, fingers fanning off it, membrane
 * stretched between them and scalloped where it spans finger to finger.
 *
 * The scallops are the whole read. A membrane cut off straight is a kite; the
 * concave spans between the finger tips are what the eye recognises as a wing,
 * and they are also why the spars have somewhere to go.
 */
function membraneWing(
  span: number,
  materials: WingMaterials,
  geometries: THREE.BufferGeometry[],
  hard: boolean,
): THREE.Group {
  const group = new THREE.Group();
  const s = span;
  const shape = new THREE.Shape();
  shape.moveTo(0.02 * s, 0.08 * s);
  // Leading edge: out to the wrist, sweeping forward as it goes.
  if (hard) {
    shape.lineTo(0.42 * s, -0.24 * s);
    shape.lineTo(0.72 * s, -0.3 * s);
    shape.lineTo(1 * s, -0.08 * s);
  } else {
    shape.quadraticCurveTo(0.34 * s, -0.22 * s, 0.7 * s, -0.3 * s);
    shape.quadraticCurveTo(0.9 * s, -0.27 * s, 1 * s, -0.04 * s);
  }
  for (const { cusp, control } of MEMBRANE_TRAILING) {
    if (hard) shape.lineTo(cusp[0] * s, cusp[1] * s);
    else shape.quadraticCurveTo(control[0] * s, control[1] * s, cusp[0] * s, cusp[1] * s);
  }
  const geometry = layFlat(shape, s, hard ? 4 : 14, hard ? 0.05 : 0.12);
  geometries.push(geometry);
  const membrane = new THREE.Mesh(geometry, materials.membrane);
  membrane.castShadow = true;
  group.add(membrane);

  // Arm to the wrist, then a finger to the tip and one down to every scallop.
  const wrist: [number, number] = [0.7, -0.3];
  const boneR = s * 0.026;
  group.add(strut([0.02, 0.06], wrist, boneR, materials.bone, geometries));
  group.add(strut(wrist, [1, -0.04], boneR * 0.72, materials.bone, geometries));
  for (const [index, { cusp }] of MEMBRANE_TRAILING.entries()) {
    if (index === MEMBRANE_TRAILING.length - 1) break;
    group.add(
      strut(wrist, cusp, boneR * (0.66 - index * 0.1), materials.accent, geometries),
    );
  }
  return group;
}

/**
 * Bird wing: two rows of feathers on a short arm.
 *
 * Long primaries fan off the wrist and sweep back; shorter coverts overlap the
 * leading edge and hide where the primaries are rooted. Feathers are one
 * rounded shape reused at a different scale and angle for each, so the fan
 * costs one geometry rather than fourteen.
 */
function featheredWing(
  span: number,
  materials: WingMaterials,
  geometries: THREE.BufferGeometry[],
): THREE.Group {
  const group = new THREE.Group();
  const s = span;

  // One feather: a lens, pointed at the tip and rounded at the quill.
  const feather = new THREE.Shape();
  feather.moveTo(0, 0);
  feather.quadraticCurveTo(0.34, 0.14, 1, 0.03);
  feather.quadraticCurveTo(0.34, -0.1, 0, 0);
  const featherGeo = layFlat(feather, 1, 8, 0.05);
  geometries.push(featherGeo);

  const primaries = 9;
  for (let i = 0; i < primaries; i += 1) {
    const u = i / (primaries - 1);
    const mesh = new THREE.Mesh(featherGeo, materials.membrane);
    // Rooted along the arm, fanning from just off the leading edge round to
    // the trailing edge, longest in the middle of the fan.
    const angle = -0.12 + u * 1.15;
    const length = s * (0.62 + Math.sin((0.25 + u * 0.6) * Math.PI) * 0.42);
    mesh.scale.set(length, 1, length * 0.46);
    mesh.position.set(s * (0.46 - u * 0.16), -s * 0.012 * i, -s * (0.06 + u * 0.1));
    mesh.rotation.y = angle;
    mesh.castShadow = true;
    group.add(mesh);
  }

  const coverts = 5;
  for (let i = 0; i < coverts; i += 1) {
    const u = i / (coverts - 1);
    const mesh = new THREE.Mesh(featherGeo, materials.accent);
    const length = s * (0.3 - u * 0.1);
    mesh.scale.set(length, 1, length * 0.55);
    mesh.position.set(s * (0.08 + u * 0.4), s * 0.02, s * (0.1 - u * 0.16));
    mesh.rotation.y = 0.1 + u * 0.7;
    group.add(mesh);
  }

  group.add(strut([0.02, 0.04], [0.52, -0.2], s * 0.03, materials.bone, geometries));
  group.add(strut([0.52, -0.2], [0.78, -0.16], s * 0.022, materials.bone, geometries));
  return group;
}

/**
 * Insect wing: a long forewing and a shorter hindwing, both veined.
 *
 * Narrow and near-transparent rather than broad and opaque — an insect wing is
 * mostly the veins, and the panel between them is what light passes through.
 */
function insectWing(
  span: number,
  materials: WingMaterials,
  geometries: THREE.BufferGeometry[],
): THREE.Group {
  const group = new THREE.Group();
  const s = span;

  const panel = (reach: number, depth: number, back: number) => {
    const shape = new THREE.Shape();
    shape.moveTo(0.02, back * 0.3);
    shape.quadraticCurveTo(0.4, -depth, 1, -depth * 0.28);
    shape.quadraticCurveTo(0.96, back * 0.6, 0.62, back);
    shape.quadraticCurveTo(0.3, back * 0.86, 0.02, back * 0.3);
    const geometry = layFlat(shape, 1, 12, 0.06);
    geometries.push(geometry);
    const mesh = new THREE.Mesh(geometry, materials.membrane);
    mesh.scale.setScalar(reach * s);
    return mesh;
  };

  const fore = panel(1, 0.3, 0.16);
  fore.position.set(0, s * 0.01, -s * 0.02);
  fore.rotation.y = -0.06;
  group.add(fore);

  const hind = panel(0.66, 0.24, 0.3);
  hind.position.set(0, -s * 0.02, -s * 0.12);
  hind.rotation.y = 0.34;
  group.add(hind);

  // Veins: the long one down the leading edge of each panel, plus two cross
  // ribs on the forewing, which is where an insect wing shows its structure.
  group.add(strut([0.02, 0.02], [0.98, -0.1], s * 0.014, materials.bone, geometries));
  group.add(strut([0.04, 0.04], [0.6, 0.2], s * 0.01, materials.accent, geometries));
  group.add(strut([0.2, -0.14], [0.74, 0.04], s * 0.008, materials.accent, geometries));
  return group;
}

/**
 * Build one wing for a side.
 *
 * `side` is -1 or 1 and is the *only* difference between the two wings of a
 * pair: the right one is built, the left one is that same geometry reflected
 * through the body's centre plane. Three.js handles the negative determinant
 * by flipping the winding, and the membrane materials are double-sided, so the
 * reflection shades identically instead of turning inside out.
 */
export function buildWing(options: {
  style: WingStyle;
  span: number;
  side: number;
  materials: WingMaterials;
}): Wing {
  const { style, span, side, materials } = options;
  const geometries: THREE.BufferGeometry[] = [];
  const inner =
    style === "feathered"
      ? featheredWing(span, materials, geometries)
      : style === "insect"
        ? insectWing(span, materials, geometries)
        : membraneWing(span, materials, geometries, style === "plated");
  const group = new THREE.Group();
  group.add(inner);
  if (side < 0) group.scale.x = -1;
  return { group, geometries };
}
