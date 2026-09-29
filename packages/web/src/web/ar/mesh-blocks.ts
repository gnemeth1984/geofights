import * as THREE from "three";
import type { BlockSet } from "../../api/lib/creature-form";
import { buildTailLink, lump } from "./anatomy";
import { sculpt, type Mass, type SculptOptions } from "./sculpt";

/**
 * Mesh block library.
 *
 * Every block here is a small, pre-authored low-poly mesh built from three.js
 * geometry in this file — there is no GLTF import, no loader, no fetch and
 * nothing server-side. A block is referenced by string id and built on demand
 * into a plain `THREE.Group`, which the character renderer parents to the same
 * animated groups the primitives used to hang off. That is the whole contract:
 * the animation channels do not know or care whether the thing under
 * `headGroup` is a cone or a cat head.
 *
 * Authoring conventions, which the renderer relies on when it scales a block
 * into a slot:
 *
 * - **head** — authored around the origin at unit radius 1, facing `+Z`. The
 *   renderer scales by the head radius it already computed. A head block that
 *   can open its mouth exposes a child group named `jaw`.
 * - **ear** — base at the origin, tip toward `+Y`, unit height 1. Authored for
 *   the left side; the renderer mirrors `scale.x` for the right.
 * - **face** — authored to sit on the front of a unit head (eyes near
 *   `z = 0.8`), so it is parented to the head block and scaled with it.
 * - **torso** — authored to fill a 1x1x1 box centred on the origin, long axis
 *   `Z`. The renderer scales by the trunk's width/height/length.
 * - **hand / foot** — unit radius 1 around the origin, fingers toward `-Y`.
 * - **tail** — starts at the origin and runs to `-Z` over unit length 1, as a
 *   chain of nested joints each named `joint`, so the existing whip lag can
 *   still travel out to the tip.
 * - **accessory** — unit radius 1, upright, facing `+Z`.
 *
 * Poly budget: every block is a handful of primitives at low segment counts,
 * because these render on phones inside an AR session alongside a second
 * character.
 */

export type BlockMaterials = {
  body: THREE.Material;
  accent: THREE.Material;
  glow: THREE.Material;
  membrane: THREE.Material;
};

export type BlockContext = {
  materials: BlockMaterials;
  /**
   * Every geometry a block creates is pushed here, so the character that owns
   * the block disposes it with the rest of its body. Materials are shared and
   * owned by the character, so blocks never push those.
   */
  disposables: Array<THREE.BufferGeometry | THREE.Material>;
};

export const BLOCK_IDS = [
  // head
  "cat_head_block",
  "dragon_snout_block",
  "sprite_head_block",
  // ears
  "cat_ear_block",
  "horned_ear_block",
  "leaf_ear_block",
  // face
  "cat_face_block",
  "fanged_face_block",
  "sprite_face_block",
  // torso
  "smooth_torso_block",
  "fur_plate_torso_block",
  "armor_torso_block",
  // limbs
  "paw_hand_block",
  "paw_foot_block",
  "claw_hand_block",
  // tails
  "curved_tail_block",
  "tuft_tail_block",
  "blade_tail_block",
  // accessories
  "forehead_gem_block",
  "collar_block",
  "back_crystal_block",
] as const;

export type BlockId = (typeof BLOCK_IDS)[number];

/* ----------------------------------------------------------------- helpers */

function keep(ctx: BlockContext, geometry: THREE.BufferGeometry): THREE.BufferGeometry {
  ctx.disposables.push(geometry);
  return geometry;
}

function piece(
  ctx: BlockContext,
  geometry: THREE.BufferGeometry,
  material: THREE.Material,
  position?: [number, number, number],
  rotation?: [number, number, number],
  scale?: [number, number, number],
): THREE.Mesh {
  const item = new THREE.Mesh(keep(ctx, geometry), material);
  if (position) item.position.set(position[0], position[1], position[2]);
  if (rotation) item.rotation.set(rotation[0], rotation[1], rotation[2]);
  if (scale) item.scale.set(scale[0], scale[1], scale[2]);
  item.castShadow = true;
  return item;
}

/** A sphere at the poly budget these blocks are built to. */
function ball(radius: number): THREE.SphereGeometry {
  return new THREE.SphereGeometry(radius, 12, 8);
}

/**
 * The flesh of a block, as one surface.
 *
 * A block used to be a pile of `piece()` calls, and where those pieces shared
 * the body material they were meant to read as one volume — a skull with
 * cheeks, a paw with toes, a chest with a haunch behind it. They did not: each
 * primitive kept its own closed surface, so every overlap drew the ellipse
 * where the two intersected and the block read as parts glued together.
 *
 * Passing the body masses through {@link sculpt} instead resolves them into a
 * single shell with every join already filleted. It is one mesh out, which is
 * also cheaper to draw than the pieces it replaces.
 *
 * Accent, glow and membrane pieces stay separate primitives on purpose. Those
 * are trim — plates, claws, brow lines, whisker spots — and trim is *supposed*
 * to sit on the surface with an edge. Merging them would dissolve the only
 * thing that gives these blocks their markings.
 */
function flesh(
  ctx: BlockContext,
  masses: readonly Mass[],
  material: THREE.Material,
  options: SculptOptions,
): THREE.Mesh {
  const mesh = new THREE.Mesh(keep(ctx, sculpt(masses, options)), material);
  mesh.castShadow = true;
  return mesh;
}

/* -------------------------------------------------------------------- heads */

/**
 * Smooth cat head: a rounded skull with cheek volume and a short muzzle, plus
 * a lower jaw that the bite channel opens.
 */
function catHead(ctx: BlockContext): THREE.Group {
  const group = new THREE.Group();
  const { body, accent } = ctx.materials;

  // Skull, cheeks and muzzle as one surface. The cheeks are what makes the
  // silhouette read feline rather than just spherical, and the muzzle is what
  // makes it a face — neither survives being a ball parked on a ball, because
  // the intersection ring reads before the shape does.
  group.add(
    flesh(
      ctx,
      [
        lump([0, 0, 0], 1, 0.94, 0.96),
        lump([-0.62, -0.18, 0.28], 0.42, 0.357, 0.378),
        lump([0.62, -0.18, 0.28], 0.42, 0.357, 0.378),
        lump([0, -0.18, 0.78], 0.483, 0.368, 0.391),
      ],
      body,
      // Tight, for the reason the sculpted skull is: a soft blend averages the
      // muzzle back into the cheeks and the face goes flat.
      { blend: 0.13, cell: 1 / 8, maxCells: 20, uvAxis: "y" },
    ),
  );
  // Where the cranium is, for whatever gets worn on it. The sculpt swallowed
  // the skull ball that used to answer this by being the biggest mesh in the
  // group; these are that ball's own centre and radius.
  group.userData.cranium = { at: [0, 0, 0], r: 1 };
  // Brow line, in accent, so the face has a top edge to read against.
  group.add(piece(ctx, new THREE.BoxGeometry(1.1, 0.12, 0.34), accent, [0, 0.46, 0.62], [-0.32, 0, 0]));

  const jaw = new THREE.Group();
  jaw.name = "jaw";
  jaw.position.set(0, -0.34, 0.34);
  jaw.add(piece(ctx, ball(0.34), body, [0, -0.06, 0.34], undefined, [1.05, 0.55, 0.95]));
  jaw.add(piece(ctx, new THREE.BoxGeometry(0.44, 0.1, 0.4), accent, [0, -0.18, 0.4]));
  group.add(jaw);

  return group;
}

/** Dragon snout: low skull, long tapered muzzle, brow ridges, hinged jaw. */
function dragonSnout(ctx: BlockContext): THREE.Group {
  const group = new THREE.Group();
  const { body, accent } = ctx.materials;

  // Skull and muzzle as one surface. The muzzle was a cone laid along +Z, and
  // a cone is the worst case for this: a circular base ring sitting on a
  // sphere, so the join read as a collar around the snout. It is a tapered rod
  // through the same sculpt now, spanning from inside the skull to where the
  // cone's apex was, so the snout leaves the head as one continuous taper.
  //
  // The tip stays blunt rather than needling to a point. A cone apex is a
  // single vertex and lit like one; a snout that ends in a small ball reads as
  // a nose, which is what is wanted at the front of a bite.
  group.add(
    flesh(
      ctx,
      [
        lump([0, 0.05, -0.2], 0.92, 0.81, 0.92),
        { kind: "rod", from: [0, -0.04, 0.05], to: [0, -0.08, 1.28], r: 0.56, toR: 0.15 },
      ],
      body,
      { blend: 0.12, cell: 0.12, maxCells: 22, uvAxis: "z" },
    ),
  );
  // The cranium, for a crown or a gem: the skull lump, not the snout that now
  // shares its mesh.
  group.userData.cranium = { at: [0, 0.05, -0.2], r: 0.92 };
  for (const side of [-1, 1]) {
    group.add(
      piece(ctx, new THREE.BoxGeometry(0.22, 0.14, 0.7), accent, [side * 0.42, 0.42, 0.24], [-0.2, 0, side * 0.2]),
    );
  }

  const jaw = new THREE.Group();
  jaw.name = "jaw";
  jaw.position.set(0, -0.3, 0.1);
  jaw.add(
    piece(ctx, new THREE.ConeGeometry(0.4, 1.25, 6), accent, [0, -0.06, 0.6], [Math.PI / 2, 0, 0], [1, 1, 0.5]),
  );
  group.add(jaw);

  return group;
}

/** Round sprite head: an oversized smooth dome with a small crown ridge. */
function spriteHead(ctx: BlockContext): THREE.Group {
  const group = new THREE.Group();
  const { body, glow } = ctx.materials;

  group.add(piece(ctx, new THREE.SphereGeometry(1.05, 14, 10), body, [0, 0.05, 0], undefined, [1, 0.98, 0.98]));
  group.add(piece(ctx, new THREE.TorusGeometry(0.5, 0.06, 6, 14), glow, [0, 0.82, 0], [Math.PI / 2, 0, 0]));

  const jaw = new THREE.Group();
  jaw.name = "jaw";
  jaw.position.set(0, -0.5, 0.3);
  jaw.add(piece(ctx, ball(0.34), body, [0, -0.08, 0.28], undefined, [1.1, 0.5, 0.9]));
  group.add(jaw);

  return group;
}

/* --------------------------------------------------------------------- ears */

/**
 * Curved cat ear: two stacked cone sections with the upper one bent back, so
 * the ear reads as a curved shell rather than a straight spike. Every bend is
 * around X only, which keeps the block symmetric across the head's centre line
 * — the renderer can then hang the same block on both sides at opposite tilts
 * instead of mirroring `scale.x`, which would invert the lighting.
 */
function catEar(ctx: BlockContext): THREE.Group {
  const group = new THREE.Group();
  const { body, accent } = ctx.materials;

  // Lower shell: narrow enough that a pair does not span the whole skull, and
  // flattened front-to-back the way an ear is.
  group.add(piece(ctx, new THREE.ConeGeometry(0.28, 0.66, 7), body, [0, 0.31, 0], undefined, [1, 1, 0.62]));
  // Inner ear, pushed slightly forward out of the shell.
  group.add(piece(ctx, new THREE.ConeGeometry(0.17, 0.44, 7), accent, [0, 0.26, 0.07], undefined, [1, 1, 0.4]));

  const tip = new THREE.Group();
  tip.position.y = 0.58;
  tip.rotation.x = -0.3;
  tip.add(piece(ctx, new THREE.ConeGeometry(0.16, 0.46, 7), body, [0, 0.21, 0], undefined, [1, 1, 0.62]));
  group.add(tip);

  return group;
}

/** Horned ear: a three-section curl that sweeps back off the skull. */
function hornedEar(ctx: BlockContext): THREE.Group {
  const group = new THREE.Group();
  const { accent } = ctx.materials;

  let parent: THREE.Group = group;
  let radius = 0.26;
  for (let index = 0; index < 3; index += 1) {
    const joint = new THREE.Group();
    joint.position.y = index === 0 ? 0 : 0.36;
    // Sweep is around X only, so the block stays symmetric across the head's
    // centre line and both sides can use it unmirrored.
    joint.rotation.x = -0.3;
    joint.add(piece(ctx, new THREE.ConeGeometry(radius, 0.42, 6), accent, [0, 0.2, 0]));
    parent.add(joint);
    parent = joint;
    radius *= 0.68;
  }

  return group;
}

/** Leaf ear: a flat extruded blade, thin enough to catch the light edge-on. */
function leafEar(ctx: BlockContext): THREE.Group {
  const group = new THREE.Group();
  const { membrane, accent } = ctx.materials;

  const shape = new THREE.Shape();
  shape.moveTo(0, 0);
  shape.quadraticCurveTo(0.42, 0.42, 0, 1);
  shape.quadraticCurveTo(-0.42, 0.42, 0, 0);
  const blade = new THREE.Mesh(
    keep(ctx, new THREE.ExtrudeGeometry(shape, { depth: 0.05, bevelEnabled: false, curveSegments: 5 })),
    membrane,
  );
  blade.position.z = -0.025;
  group.add(blade);
  // Central rib, so the leaf does not read as a flat cutout.
  group.add(piece(ctx, new THREE.BoxGeometry(0.05, 0.9, 0.07), accent, [0, 0.46, 0]));

  return group;
}

/* --------------------------------------------------------------------- face */

/** Cat face: round sockets with lit pupils, a small nose and a smile. */
function catFace(ctx: BlockContext): THREE.Group {
  const group = new THREE.Group();
  const { accent, glow } = ctx.materials;

  for (const side of [-1, 1]) {
    group.add(piece(ctx, ball(0.26), accent, [side * 0.44, 0.2, 0.74], undefined, [1, 1.1, 0.5]));
    group.add(
      piece(ctx, new THREE.SphereGeometry(0.15, 10, 7), glow, [side * 0.44, 0.2, 0.84], undefined, [0.8, 1.15, 0.6]),
    );
    // Whisker pads.
    group.add(piece(ctx, ball(0.12), accent, [side * 0.26, -0.16, 0.92]));
  }

  // Nose: a tetrahedron reads as a triangular muzzle tip at this size.
  group.add(piece(ctx, new THREE.TetrahedronGeometry(0.14), accent, [0, -0.1, 1.05], [0.6, Math.PI / 4, 0]));
  // Smile: a half torus, opening downward.
  group.add(
    piece(ctx, new THREE.TorusGeometry(0.2, 0.035, 5, 10, Math.PI), accent, [0, -0.28, 0.92], [0, 0, Math.PI]),
  );

  return group;
}

/** Fanged face: narrow lit slits and a pair of tusks under the muzzle. */
function fangedFace(ctx: BlockContext): THREE.Group {
  const group = new THREE.Group();
  const { accent, glow } = ctx.materials;

  for (const side of [-1, 1]) {
    group.add(
      piece(ctx, new THREE.BoxGeometry(0.3, 0.1, 0.08), glow, [side * 0.4, 0.24, 0.66], [0, 0, side * -0.25]),
    );
    group.add(
      piece(ctx, new THREE.ConeGeometry(0.08, 0.28, 5), accent, [side * 0.22, -0.34, 0.95], [Math.PI, 0, 0]),
    );
    group.add(piece(ctx, ball(0.07), accent, [side * 0.14, -0.02, 1.12], undefined, [1, 1, 0.6]));
  }

  return group;
}

/** Sprite face: big lit eyes with a highlight, and a tiny mouth. */
function spriteFace(ctx: BlockContext): THREE.Group {
  const group = new THREE.Group();
  const { accent, glow } = ctx.materials;

  for (const side of [-1, 1]) {
    group.add(piece(ctx, ball(0.3), glow, [side * 0.42, 0.12, 0.78], undefined, [1, 1.15, 0.5]));
    group.add(piece(ctx, ball(0.1), accent, [side * 0.52, 0.26, 0.92]));
  }
  group.add(
    piece(ctx, new THREE.TorusGeometry(0.13, 0.03, 5, 9, Math.PI), accent, [0, -0.3, 0.86], [0, 0, Math.PI]),
  );

  return group;
}

/* -------------------------------------------------------------------- torso */

/** Smooth torso: chest, barrel and haunch as one continuous soft volume. */
function smoothTorso(ctx: BlockContext): THREE.Group {
  const group = new THREE.Group();
  const { body } = ctx.materials;

  // Barrel, chest and haunch in one sculpt. The three were already overlapping
  // hard enough to read as one mass from the front, but in three-quarter and
  // side views — which is most of a fight — the two intersection rings ran
  // right across the flank.
  group.add(
    flesh(
      ctx,
      [
        lump([0, 0, 0], 0.5, 0.5, 0.56),
        lump([0, 0.03, 0.34], 0.4, 0.4, 0.36),
        lump([0, -0.02, -0.32], 0.44, 0.44, 0.374),
      ],
      body,
      { blend: 0.09, cell: 0.09, maxCells: 20, uvAxis: "z" },
    ),
  );

  return group;
}

/** Fur plate torso: the smooth volume with tufts standing off the flanks. */
function furPlateTorso(ctx: BlockContext): THREE.Group {
  const group = smoothTorso(ctx);
  const { accent } = ctx.materials;

  for (const [index, spot] of [-0.3, 0, 0.3].entries()) {
    for (const side of [-1, 1]) {
      group.add(
        piece(
          ctx,
          new THREE.ConeGeometry(0.16, 0.34, 5),
          accent,
          [side * 0.4, 0.12 - index * 0.04, spot],
          [0.4, 0, side * 1.1],
          [1, 1, 0.6],
        ),
      );
    }
  }

  return group;
}

/**
 * Armor torso: a rounded plated chest with shoulder pads, a spine ridge and a
 * lit core.
 *
 * The core used to be a literal `BoxGeometry` crate, which at realistic
 * proportions was a small hard-surface chest and at chibi ones is most of the
 * character — a cube with a head on it, with the curved plates the shell
 * dresses it in hovering off the flat faces instead of sitting on them. It is
 * a barrel now: the chest curve is what the plates are cut to follow, and the
 * hard-surface read comes from the panelling rather than from the silhouette.
 */
function armorTorso(ctx: BlockContext): THREE.Group {
  const group = new THREE.Group();
  const { body, accent, glow } = ctx.materials;

  const chest: [number, number, number] = [0.94, 0.86, 1.04];
  group.add(piece(ctx, new THREE.SphereGeometry(0.5, 16, 12), body, undefined, undefined, chest));
  // Breastplate: a patch cut off the same sphere a touch proud of it, so it
  // hugs the chest instead of floating in front of it.
  group.add(
    piece(
      ctx,
      new THREE.SphereGeometry(0.53, 18, 12, Math.PI * 0.68, Math.PI * 0.64, Math.PI * 0.26, Math.PI * 0.46),
      accent,
      undefined,
      undefined,
      chest,
    ),
  );
  // Spine ridge: three shrinking humps down the back rather than one long bar,
  // which follows the barrel instead of cutting a chord across it.
  for (const [index, z] of [-0.36, -0.06, 0.24].entries()) {
    const r = 0.13 - index * 0.02;
    group.add(piece(ctx, ball(r), accent, [0, 0.42 - index * 0.03, z], undefined, [0.8, 1.1, 1.5]));
  }
  group.add(piece(ctx, ball(0.12), glow, [0, 0.06, 0.52]));
  for (const side of [-1, 1]) {
    group.add(
      piece(
        ctx,
        new THREE.SphereGeometry(0.26, 10, 7, 0, Math.PI * 2, 0, Math.PI / 2),
        accent,
        [side * 0.42, 0.28, 0.2],
        [0, 0, side * 0.5],
      ),
    );
  }

  return group;
}

/* -------------------------------------------------------------------- limbs */

/** Paw hand: a soft pad with three toes and an accent underside. */
function pawHand(ctx: BlockContext): THREE.Group {
  const group = new THREE.Group();
  const { body, accent } = ctx.materials;

  // Pad and toes as one surface. The blend is deliberately small: enough to
  // fillet each toe into the pad, not enough to fill the valleys between them.
  // Merge a paw too softly and the toes stop being toes — it becomes a mitten.
  group.add(
    flesh(
      ctx,
      [
        lump([0, 0, 0], 0.62, 0.527, 0.651),
        ...[-1, 0, 1].map((slot) => lump([slot * 0.32, -0.26, 0.34], 0.22, 0.22, 0.22)),
      ],
      body,
      { blend: 0.07, cell: 0.1, maxCells: 18, uvAxis: "y" },
    ),
  );
  group.add(piece(ctx, ball(0.34), accent, [0, -0.42, 0.05], undefined, [1.1, 0.35, 1.1]));

  return group;
}

/** Paw foot: flatter and longer than the hand, with a heel pad. */
function pawFoot(ctx: BlockContext): THREE.Group {
  const group = new THREE.Group();
  const { body, accent } = ctx.materials;

  group.add(
    flesh(
      ctx,
      [
        lump([0, -0.12, 0.08], 0.58, 0.348, 0.754),
        ...[-1, 0, 1].map((slot) => lump([slot * 0.3, -0.2, 0.55], 0.2, 0.2, 0.2)),
      ],
      body,
      { blend: 0.07, cell: 0.1, maxCells: 18, uvAxis: "y" },
    ),
  );
  group.add(piece(ctx, ball(0.3), accent, [0, -0.32, 0.1], undefined, [1.2, 0.3, 1.3]));

  return group;
}

/** Claw hand: a hard wedge palm with three swept claws. */
function clawHand(ctx: BlockContext): THREE.Group {
  const group = new THREE.Group();
  const { body, accent } = ctx.materials;

  // The palm was a literal box. Hard corners are the point on a claw hand, but
  // a box is six flat faces and the one facing the key light went dead flat
  // against a body that curves everywhere else — it read as a crate with
  // claws in it. Two masses now: a palm and a knuckle ridge across the front,
  // so the wedge keeps its hard read from the knuckle line and the claws
  // rather than from being a cuboid.
  group.add(
    flesh(
      ctx,
      [lump([0, 0, -0.04], 0.34, 0.2, 0.28), lump([0, -0.04, 0.22], 0.35, 0.15, 0.13)],
      body,
      { blend: 0.05, cell: 0.07, maxCells: 16, uvAxis: "y" },
    ),
  );
  for (const slot of [-1, 0, 1]) {
    group.add(
      piece(ctx, new THREE.ConeGeometry(0.1, 0.62, 5), accent, [slot * 0.24, -0.36, 0.3], [-1.05, 0, slot * 0.18]),
    );
  }

  return group;
}

/* --------------------------------------------------------------------- tail */

/**
 * A jointed tail spine. Each joint is a child of the one before it and carries
 * a base curl, so the tail arcs at rest and a whip crack compounds outward
 * instead of swinging the whole tail as one rigid arm. Joints are named
 * `joint`, which is how the renderer collects them for the existing lag pass.
 */
function tailSpine(
  ctx: BlockContext,
  options: { joints: number; girth: number; curl: number; material?: THREE.Material },
): { group: THREE.Group; tip: THREE.Group } {
  const group = new THREE.Group();
  const material = options.material ?? ctx.materials.body;
  const step = 1 / options.joints;

  let parent: THREE.Group = group;
  for (let index = 0; index < options.joints; index += 1) {
    const joint = new THREE.Group();
    joint.name = "joint";
    joint.position.z = index === 0 ? 0 : -step;
    joint.rotation.x = options.curl;
    const radius = options.girth * (1 - (index / options.joints) * 0.6);
    const nextRadius = options.girth * (1 - ((index + 1) / options.joints) * 0.6);
    // One tapered link per joint, spanning past its neighbours on both sides.
    //
    // This was a ball per joint, stretched along Z to close the gaps the taper
    // opened up. Stretched spheres butted end to end are still beads: the seam
    // lands at the widest point of each one, which is exactly where the eye
    // reads the outline. The link reaches behind its own joint and past the
    // next, so consecutive links interpenetrate and the silhouette stays shut
    // through a whip crack.
    //
    // No droop is passed: a block tail gets its arc from `curl` on each joint,
    // compounding outward, so a link that also curved in its own geometry
    // would double the bend.
    const link = new THREE.Mesh(keep(ctx, buildTailLink({ radius, nextRadius, step, drop: 0 })), material);
    link.castShadow = true;
    joint.add(link);
    parent.add(joint);
    parent = joint;
  }

  const tip = new THREE.Group();
  tip.position.z = -step;
  parent.add(tip);

  return { group, tip };
}

/** Curved cat tail: a long soft curl with a slightly heavier tip. */
function curvedTail(ctx: BlockContext): THREE.Group {
  const { group, tip } = tailSpine(ctx, { joints: 5, girth: 0.1, curl: 0.16 });
  tip.add(piece(ctx, ball(0.09), ctx.materials.body, [0, 0, -0.04], undefined, [1, 1, 1.3]));
  return group;
}

/** Tuft tail: short spine, big soft plume on the end. */
function tuftTail(ctx: BlockContext): THREE.Group {
  const { group, tip } = tailSpine(ctx, { joints: 4, girth: 0.09, curl: 0.1 });
  const { membrane, accent } = ctx.materials;
  tip.add(piece(ctx, new THREE.ConeGeometry(0.22, 0.4, 6), membrane, [0, 0.02, -0.16], [-Math.PI / 2, 0, 0]));
  tip.add(piece(ctx, ball(0.11), accent, [0, 0, -0.02]));
  return group;
}

/** Blade tail: a stiff spine ending in a flat lit blade. */
function bladeTail(ctx: BlockContext): THREE.Group {
  const { group, tip } = tailSpine(ctx, { joints: 5, girth: 0.09, curl: 0.06 });
  const { accent, glow } = ctx.materials;
  tip.add(
    piece(ctx, new THREE.ConeGeometry(0.16, 0.5, 4), accent, [0, 0, -0.22], [-Math.PI / 2, 0, 0], [1, 1, 0.3]),
  );
  tip.add(piece(ctx, new THREE.OctahedronGeometry(0.07), glow, [0, 0, -0.06]));
  return group;
}

/* ---------------------------------------------------------------- accessory */

/**
 * Forehead gem: a lit octahedron set flat into an accent rim. Both sit in the
 * XY plane facing `+Z`, so the piece reads as a stone inlaid in the brow — a
 * rim rotated flat would ride the skull like a halo instead.
 */
function foreheadGem(ctx: BlockContext): THREE.Group {
  const group = new THREE.Group();
  const { accent, glow } = ctx.materials;

  group.add(piece(ctx, new THREE.OctahedronGeometry(0.72, 0), glow, [0, 0, 0.08], undefined, [0.9, 1, 0.5]));
  group.add(piece(ctx, new THREE.TorusGeometry(0.78, 0.17, 6, 14), accent));

  return group;
}

/** Collar: a band around the neck with a lit tag at the front. */
function collarBand(ctx: BlockContext): THREE.Group {
  const group = new THREE.Group();
  const { accent, glow } = ctx.materials;

  group.add(piece(ctx, new THREE.TorusGeometry(1, 0.16, 6, 14), accent, [0, 0, 0], [Math.PI / 2, 0, 0]));
  group.add(piece(ctx, new THREE.OctahedronGeometry(0.3), glow, [0, -0.2, 0.95]));

  return group;
}

/** Back crystal cluster: three lit shards at different angles. */
function backCrystal(ctx: BlockContext): THREE.Group {
  const group = new THREE.Group();
  const { glow, accent } = ctx.materials;

  const shards: Array<[number, number, number, number]> = [
    [0, 0.1, 0, 1],
    [-0.5, -0.1, -0.35, 0.66],
    [0.46, -0.14, 0.3, 0.55],
  ];
  for (const [x, y, z, size] of shards) {
    group.add(
      piece(
        ctx,
        new THREE.OctahedronGeometry(size, 0),
        glow,
        [x, y + size * 0.4, z],
        [0.2 * x, size * 2, 0.25 * z],
        [0.6, 1.5, 0.6],
      ),
    );
  }
  group.add(piece(ctx, ball(0.42), accent, [0, -0.1, 0], undefined, [1.4, 0.4, 1.2]));

  return group;
}

/* ------------------------------------------------------------- the registry */

const BUILDERS: Record<BlockId, (ctx: BlockContext) => THREE.Group> = {
  cat_head_block: catHead,
  dragon_snout_block: dragonSnout,
  sprite_head_block: spriteHead,
  cat_ear_block: catEar,
  horned_ear_block: hornedEar,
  leaf_ear_block: leafEar,
  cat_face_block: catFace,
  fanged_face_block: fangedFace,
  sprite_face_block: spriteFace,
  smooth_torso_block: smoothTorso,
  fur_plate_torso_block: furPlateTorso,
  armor_torso_block: armorTorso,
  paw_hand_block: pawHand,
  paw_foot_block: pawFoot,
  claw_hand_block: clawHand,
  curved_tail_block: curvedTail,
  tuft_tail_block: tuftTail,
  blade_tail_block: bladeTail,
  forehead_gem_block: foreheadGem,
  collar_block: collarBand,
  back_crystal_block: backCrystal,
};

/** Build one block by id. The group is unscaled: the slot scales it. */
export function buildBlock(id: BlockId, ctx: BlockContext): THREE.Group {
  const group = BUILDERS[id](ctx);
  group.name = id;
  return group;
}

/* -------------------------------------------------------------- block plans */

/**
 * Which block fills which slot, per block set. A slot set to `null` falls back
 * to the primitive the renderer already built for it, which is how a block set
 * stays a partial upgrade rather than an all-or-nothing second renderer.
 */
export type BlockPlan = {
  head: BlockId | null;
  ear: BlockId | null;
  face: BlockId | null;
  torso: BlockId | null;
  hand: BlockId | null;
  foot: BlockId | null;
  tail: BlockId | null;
  accessory: BlockId | null;
  /** Where the accessory hangs: on the head, at the neck, or on the spine. */
  accessoryMount: "head" | "neck" | "back";
};

const PLANS: Record<Exclude<BlockSet, "none">, BlockPlan> = {
  cat: {
    head: "cat_head_block",
    ear: "cat_ear_block",
    face: "cat_face_block",
    torso: "smooth_torso_block",
    hand: "paw_hand_block",
    foot: "paw_foot_block",
    tail: "curved_tail_block",
    accessory: "forehead_gem_block",
    accessoryMount: "head",
  },
  dragon: {
    head: "dragon_snout_block",
    ear: "horned_ear_block",
    face: "fanged_face_block",
    torso: "armor_torso_block",
    hand: "claw_hand_block",
    foot: "paw_foot_block",
    tail: "blade_tail_block",
    accessory: "back_crystal_block",
    accessoryMount: "back",
  },
  sprite: {
    head: "sprite_head_block",
    ear: "leaf_ear_block",
    face: "sprite_face_block",
    torso: "fur_plate_torso_block",
    hand: "paw_hand_block",
    foot: "paw_foot_block",
    tail: "tuft_tail_block",
    accessory: "collar_block",
    accessoryMount: "neck",
  },
};

/** The plan for a block set, or null for the primitive-only body. */
export function blockPlanFor(set: BlockSet | undefined): BlockPlan | null {
  if (!set || set === "none") return null;
  return PLANS[set] ?? null;
}
