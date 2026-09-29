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

/**
 * Round sprite head: an oversized dome with a small crown ridge.
 *
 * The dome was a literal sphere, which is the one head in the set that had no
 * seams to fix and no shape either — a ball with a face decal, and at chibi
 * proportions it is most of the character. Sculpted, it keeps the round
 * silhouette the sprite wants but carries a brow over the eyes, a little
 * temple width and a narrower lower face, so the light has something to break
 * on and the face reads as sitting *in* a head rather than printed on a
 * balloon.
 */
function spriteHead(ctx: BlockContext): THREE.Group {
  const group = new THREE.Group();
  const { body, glow } = ctx.materials;

  group.add(
    flesh(
      ctx,
      [
        lump([0, 0.08, 0], 1.02, 1.0, 0.98),
        // Brow, over where the face block puts its eyes.
        lump([0, 0.16, 0.66], 0.72, 0.3, 0.42),
        // Temples, a touch wider than the dome at eye height.
        lump([-0.6, 0.06, 0.22], 0.36, 0.42, 0.44),
        lump([0.6, 0.06, 0.22], 0.36, 0.42, 0.44),
        // Narrower toward the chin, so the dome is not a perfect ball.
        lump([0, -0.72, 0.16], 0.58, 0.34, 0.56),
      ],
      body,
      // Generous. This one is *meant* to resolve into a single soft dome; the
      // features are inflections in it, not parts of it.
      { blend: 0.3, cell: 1 / 8, maxCells: 22, uvAxis: "y" },
    ),
  );
  // Where the cranium is, for whatever gets worn on it — the sculpt has no
  // sphere left to read it off.
  group.userData.cranium = { at: [0, 0.08, 0], r: 1.02 };
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
 * Masses along a sweeping taper — an ear shell, a horn, anything that leaves
 * the skull and curls.
 *
 * These used to be built as a chain of nested cone sections, each one parked
 * inside the last at a slight rotation. That is the cheapest way to get a
 * curve and the worst way to show one: every section boundary drew the ellipse
 * where two closed cones intersected, so a horn read as three cones threaded
 * on a stick, and the harder it curled the wider those rings opened.
 *
 * Laying overlapping lumps along the path instead lets {@link sculpt} find one
 * surface down the whole curl. `flat` squashes the cross-section front to back
 * for an ear — it is applied per lump rather than by scaling the finished mesh,
 * because scaling the mesh would squash the sweep along with the thickness and
 * flatten the curl itself out of the block.
 */
function curl(
  options: {
    /** How far the tip stands off the base. */
    height: number;
    /** Cross-section radius where it leaves the head. */
    rootRadius: number;
    /**
     * Cross-section radius at the tip.
     *
     * Keep it at roughly 1.5× the sculpt's `cell` or more. The grid carries one
     * vertex per cell that the surface crosses, so a tip thinner than a cell
     * has no cells of its own to be built out of: it comes out as a lopsided
     * nub rather than a point, and no amount of blend tuning hides it. A tip
     * that is blunt by a cell and a half reads as a point at the size these
     * blocks are drawn; a sub-cell one reads as damage.
     */
    tipRadius: number;
    /** How far back the tip sweeps, as a share of the height. */
    sweep: number;
    /** Thickness front-to-back relative to across. 1 is round. */
    flat?: number;
    /** How many lumps to lay down the path. */
    steps?: number;
  },
): Mass[] {
  const { height, rootRadius, tipRadius, sweep } = options;
  const flat = options.flat ?? 1;
  const steps = options.steps ?? 6;
  const masses: Mass[] = [];
  for (let index = 0; index <= steps; index += 1) {
    const t = index / steps;
    // Radius eased rather than linear: a straight taper on a curl reads as a
    // traffic cone, where a real horn holds its girth and then lets go.
    const r = rootRadius + (tipRadius - rootRadius) * (t * t * 0.55 + t * 0.45);
    masses.push(
      lump(
        // Quadratic sweep: leaves the skull upright, bends as it goes.
        [0, t * height, -sweep * height * t * t],
        r,
        // Along the path each lump has to reach past its neighbour's centre,
        // not merely touch its surface. Two lumps that only touch still leave
        // a waist between them, and the surface beads exactly the way the
        // cones used to ring — so the reach is a step and a third, not the
        // step itself. At the thin end this also makes the cap prolate, which
        // is what lets the tip come to a point while its cross-section stays
        // wide enough for the grid to resolve.
        Math.max(r, (height / steps) * 1.35),
        r * flat,
      ),
    );
  }
  return masses;
}

/**
 * Curved cat ear: one shell that leaves the skull upright and bends back, with
 * the inner ear set into it.
 *
 * The sweep is in Z only, which keeps the block symmetric across the head's
 * centre line — the renderer can then hang the same block on both sides at
 * opposite tilts instead of mirroring `scale.x`, which would invert the
 * lighting.
 */
function catEar(ctx: BlockContext): THREE.Group {
  const group = new THREE.Group();
  const { body, accent } = ctx.materials;

  group.add(
    flesh(
      ctx,
      curl({ height: 1.02, rootRadius: 0.28, tipRadius: 0.095, sweep: 0.22, flat: 0.6, steps: 7 }),
      body,
      { blend: 0.045, cell: 0.055, maxCells: 32, uvAxis: "y" },
    ),
  );
  // Inner ear, pushed slightly forward out of the shell. Accent, so it stays
  // its own surface — the edge where it meets the shell is the marking.
  group.add(piece(ctx, new THREE.ConeGeometry(0.17, 0.44, 7), accent, [0, 0.26, 0.07], undefined, [1, 1, 0.4]));

  return group;
}

/** Horned ear: one curl that sweeps back off the skull. */
function hornedEar(ctx: BlockContext): THREE.Group {
  const group = new THREE.Group();
  const { accent } = ctx.materials;

  group.add(
    flesh(
      ctx,
      curl({ height: 1.06, rootRadius: 0.26, tipRadius: 0.085, sweep: 0.42, steps: 8 }),
      accent,
      // Tight: a horn is hard-surfaced, and it is the one thing on the block
      // that should not soften as it curls.
      { blend: 0.035, cell: 0.05, maxCells: 34, uvAxis: "y" },
    ),
  );

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
 * Armor torso: a plated chest with shoulder shelves, a spine ridge and a lit
 * core.
 *
 * The core used to be a literal `BoxGeometry` crate, which at realistic
 * proportions was a small hard-surface chest and at chibi ones is most of the
 * character — a cube with a head on it, with the curved plates the shell
 * dresses it in hovering off the flat faces instead of sitting on them. It
 * became a barrel, and now it is sculpted, which is the difference between a
 * barrel and a body.
 *
 * Two surfaces, where there were eight primitives. The body is one sculpt:
 * chest, back and a shoulder shelf either side, so the pads have something
 * that already slopes to sit on rather than a sphere they have to cut into —
 * the intersection ring around each pad was the loudest seam on the block.
 * The armour is the second: the breastplate and the spine humps are a single
 * accent sculpt, so the ridge runs *into* the shoulders as one piece of
 * plating instead of three balls in a row down the spine.
 *
 * The accents stay a separate surface from the body on purpose — see
 * {@link flesh}: plating is trim and trim is supposed to have an edge. What
 * changed is that the trim no longer has edges *against itself*.
 */
function armorTorso(ctx: BlockContext): THREE.Group {
  const group = new THREE.Group();
  const { body, accent, glow } = ctx.materials;

  // Chest, back and the shoulder shelves, as one volume. The shelves are
  // barely proud of the barrel: enough to give the pads a slope and to widen
  // the silhouette at the top, not enough to read as a second mass.
  group.add(
    flesh(
      ctx,
      [
        lump([0, 0, 0], 0.47, 0.43, 0.52),
        lump([0, 0.1, 0.16], 0.44, 0.38, 0.4),
        lump([-0.34, 0.2, 0.1], 0.2, 0.17, 0.22),
        lump([0.34, 0.2, 0.1], 0.2, 0.17, 0.22),
      ],
      body,
      // Firm. A soft blend swells the shelves back into the barrel and the
      // shoulders go round, which is the one thing armour should not be.
      { blend: 0.1, cell: 0.085, maxCells: 22, uvAxis: "z" },
    ),
  );

  // The plating: breastplate, the ridge down the spine, and a pad capping each
  // shoulder. One sculpt, so the ridge and the pads are continuous armour.
  // Sitting a hair proud of the body sculpt is what keeps it reading as a
  // plate laid on the chest rather than as the chest itself.
  const plating: Mass[] = [
    lump([0, 0.04, 0.42], 0.34, 0.3, 0.16),
    lump([0, 0.3, 0.3], 0.26, 0.16, 0.16),
  ];
  for (const [index, z] of [-0.36, -0.06, 0.24].entries()) {
    plating.push(lump([0, 0.42 - index * 0.03, z], 0.11 - index * 0.015, 0.14 - index * 0.02, 0.2));
  }
  for (const side of [-1, 1]) {
    plating.push(lump([side * 0.42, 0.28, 0.16], 0.24, 0.16, 0.26));
  }
  group.add(
    flesh(ctx, plating, accent, {
      // Tighter than the body's: the humps have to stay humps. Blended as
      // softly as flesh they average into one bar down the back.
      blend: 0.055,
      cell: 0.075,
      maxCells: 24,
      uvAxis: "z",
    }),
  );

  group.add(piece(ctx, ball(0.12), glow, [0, 0.06, 0.52]));

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
