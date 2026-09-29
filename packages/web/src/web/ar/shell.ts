import * as THREE from "three";

/**
 * Shell: the armour layer that sits over a character's own skin.
 *
 * The reference look is a hard-surface shell worn on a soft body — glossy
 * plates with real thickness and a bevelled edge, panel seams between them, and
 * a glowing trim line tracing the edges. The themed skin from `skin.ts` stays
 * underneath and shows in the gaps, so a dragon is scaled *under* armour rather
 * than replaced by it.
 *
 * Plates are patches of an ellipsoid shell. Describing them that way, rather
 * than as boxes, is what makes them hug the lofted body instead of hovering off
 * it in flat slabs: a plate is told the radii of the body part it is worn on and
 * the sweep of surface it should cover, and it curves to match.
 *
 * Every plate on one body part is merged into a single geometry before it
 * becomes a mesh, and so is every trim line. A dressed character therefore adds
 * two draw calls per body part, not two per plate — which is what keeps a
 * fully-armoured pair of characters inside the phone frame budget.
 */

/* --------------------------------------------------------------- materials */

/**
 * The shell surface: much glossier and more metallic than any skin recipe, and
 * with no normal map of its own. Plates read as smooth moulded panels, so the
 * only relief they want is the geometry's own bevel and the seams between them.
 *
 * `clearcoatish` is a plain specular boost rather than a real clearcoat lobe —
 * `MeshPhysicalMaterial` would cost a heavier shader for a highlight that, at
 * phone resolution on a palm-sized character, is a few pixels wide.
 */
export function shellMaterial(color: number | THREE.Color): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({
    color: new THREE.Color(color),
    metalness: 0.55,
    roughness: 0.22,
    envMapIntensity: 1.2,
  });
}

/**
 * The trim surface. Emissive so it reads as lit from within even on the shadow
 * side of the body, which is the whole point of trim: it draws the silhouette
 * when nothing else is catching light.
 */
export function trimMaterial(color: number | THREE.Color, intensity: number): THREE.MeshStandardMaterial {
  const c = new THREE.Color(color);
  return new THREE.MeshStandardMaterial({
    // Near-black base. A trim tube that is lit *and* emitting the same hue sums
    // past 1.0 on its strongest channel and clips to white — which is how a
    // glowing accent line ends up reading as a rubber band. The hue survives
    // only if the diffuse response is taken out and the emissive carries the
    // colour alone.
    color: c.clone().multiplyScalar(0.06),
    emissive: c,
    emissiveIntensity: intensity,
    metalness: 0.0,
    roughness: 0.35,
    // Trim tubes are thin and sit proud of the plates; without this they
    // z-fight along the seam they are supposed to be hiding.
    polygonOffset: true,
    polygonOffsetFactor: -1,
  });
}

/* ------------------------------------------------------------------ merging */

/**
 * Concatenate geometries that all carry position/normal/uv and an index.
 *
 * Written out rather than pulled from `three/addons`, because the addons ship
 * without type declarations and a whole untyped module import is a poor trade
 * for forty lines.
 */
export function mergeGeometries(list: THREE.BufferGeometry[]): THREE.BufferGeometry | null {
  const parts = list.filter((geo) => geo.getAttribute("position"));
  if (parts.length === 0) return null;
  if (parts.length === 1) return parts[0]!;

  let vertexCount = 0;
  let indexCount = 0;
  for (const geo of parts) {
    vertexCount += geo.getAttribute("position").count;
    const index = geo.getIndex();
    indexCount += index ? index.count : geo.getAttribute("position").count;
  }

  const position = new Float32Array(vertexCount * 3);
  const normal = new Float32Array(vertexCount * 3);
  const uv = new Float32Array(vertexCount * 2);
  // Plates are small but a merged limb can pass 65k once the trim is in, so the
  // index is sized for the actual total rather than assuming 16-bit will do.
  const index = vertexCount > 65535 ? new Uint32Array(indexCount) : new Uint16Array(indexCount);

  let vertexAt = 0;
  let indexAt = 0;
  for (const geo of parts) {
    const pos = geo.getAttribute("position");
    const nor = geo.getAttribute("normal");
    const tex = geo.getAttribute("uv");
    for (let i = 0; i < pos.count; i += 1) {
      position[(vertexAt + i) * 3] = pos.getX(i);
      position[(vertexAt + i) * 3 + 1] = pos.getY(i);
      position[(vertexAt + i) * 3 + 2] = pos.getZ(i);
      if (nor) {
        normal[(vertexAt + i) * 3] = nor.getX(i);
        normal[(vertexAt + i) * 3 + 1] = nor.getY(i);
        normal[(vertexAt + i) * 3 + 2] = nor.getZ(i);
      }
      if (tex) {
        uv[(vertexAt + i) * 2] = tex.getX(i);
        uv[(vertexAt + i) * 2 + 1] = tex.getY(i);
      }
    }
    const src = geo.getIndex();
    if (src) {
      for (let i = 0; i < src.count; i += 1) index[indexAt + i] = vertexAt + src.getX(i);
      indexAt += src.count;
    } else {
      for (let i = 0; i < pos.count; i += 1) index[indexAt + i] = vertexAt + i;
      indexAt += pos.count;
    }
    vertexAt += pos.count;
    geo.dispose();
  }

  const merged = new THREE.BufferGeometry();
  merged.setAttribute("position", new THREE.BufferAttribute(position, 3));
  merged.setAttribute("normal", new THREE.BufferAttribute(normal, 3));
  merged.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
  merged.setIndex(new THREE.BufferAttribute(index, 1));
  return merged;
}

/* -------------------------------------------------------------------- maths */

export type Radii = { rx: number; ry: number; rz: number };

/**
 * A point on an ellipsoid. `phi` runs from the +Y pole down; `theta` is
 * measured from +Z, so theta 0 faces the direction the character does and a
 * chest plate is `theta` centred on zero.
 */
function surfacePoint(r: Radii, phi: number, theta: number, out: THREE.Vector3): THREE.Vector3 {
  const s = Math.sin(phi);
  return out.set(r.rx * s * Math.sin(theta), r.ry * Math.cos(phi), r.rz * s * Math.cos(theta));
}

/** The outward normal at a point, which on an ellipsoid is not the point itself. */
function surfaceNormal(r: Radii, p: THREE.Vector3, out: THREE.Vector3): THREE.Vector3 {
  return out.set(p.x / (r.rx * r.rx), p.y / (r.ry * r.ry), p.z / (r.rz * r.rz)).normalize();
}

/** 0 at the edges of a 0..1 span, 1 once `edge` in from either side. */
function border(u: number, v: number, edge: number): number {
  const d = Math.min(u, 1 - u, v, 1 - v) * 2;
  if (edge <= 0) return 1;
  const t = Math.min(1, d / edge);
  return t * t * (3 - 2 * t);
}

/* ------------------------------------------------------------------- plates */

/**
 * How far down a plate reaches, either everywhere or column by column.
 *
 * A fixed pair sweeps a rectangle of surface. A function is handed `u` — 0 at
 * the `theta[0]` edge of the plate, 1 at the other — and returns the phi span
 * for that column, which is how a plate gets an edge that follows a feature
 * instead of cutting a straight line across it.
 */
export type PhiSpan = [number, number] | ((u: number) => [number, number]);

export type PlateSpec = {
  /** Radii of the body part this plate is worn on. */
  radii: Radii;
  /** Vertical sweep from the +Y pole, in radians. */
  phi: PhiSpan;
  /** Horizontal sweep from +Z (front), in radians. */
  theta: [number, number];
  /** How far the plate stands proud of the body surface. */
  lift?: number;
  /** Plate thickness at its middle, tapering to nothing at the bevel. */
  thickness?: number;
  /** Share of the plate given over to the rolled edge, 0–0.5. */
  bevel?: number;
  segments?: [number, number];
  /** Shift the whole plate, for parts whose origin is not the body centre. */
  offset?: THREE.Vector3;
};

/**
 * One armour plate: a patch of ellipsoid shell with a rolled edge.
 *
 * The thickness is driven to zero at the plate's border, which does two jobs at
 * once. It gives the bevel that catches a highlight along every edge — the
 * detail that separates a moulded plate from a slice of sphere — and it closes
 * the outer and inner surfaces into each other at the rim, so the plate is a
 * solid with no side walls to build and no open edge to leak light.
 */
export function buildPlate(spec: PlateSpec): THREE.BufferGeometry {
  const { radii } = spec;
  const lift = spec.lift ?? 0.004;
  const thickness = spec.thickness ?? 0.012;
  const bevel = spec.bevel ?? 0.22;
  const [segU, segV] = spec.segments ?? [8, 6];
  const offset = spec.offset;

  const rows = segV + 1;
  const cols = segU + 1;
  const count = rows * cols * 2;
  const position = new Float32Array(count * 3);
  const normal = new Float32Array(count * 3);
  const uv = new Float32Array(count * 2);

  const p = new THREE.Vector3();
  const n = new THREE.Vector3();
  const outer = new THREE.Vector3();
  const inner = new THREE.Vector3();

  // Both surfaces are written in one pass: the outer half of the buffer first,
  // then the inner, so the index below can address them by a fixed stride.
  const half = rows * cols;
  const fixedPhi = Array.isArray(spec.phi) ? spec.phi : null;
  const phiAt = fixedPhi ? () => fixedPhi : (spec.phi as (u: number) => [number, number]);
  for (let row = 0; row < rows; row += 1) {
    const v = row / segV;
    for (let col = 0; col < cols; col += 1) {
      const u = col / segU;
      // Read per column, not per row: a shaped plate's top and bottom edges
      // are curves, and `v` only says how far between them this row sits.
      const span = phiAt(u);
      const phi = span[0] + (span[1] - span[0]) * v;
      const theta = spec.theta[0] + (spec.theta[1] - spec.theta[0]) * u;
      surfacePoint(radii, phi, theta, p);
      surfaceNormal(radii, p, n);
      const roll = border(u, v, bevel);
      inner.copy(p).addScaledVector(n, lift);
      outer.copy(p).addScaledVector(n, lift + thickness * roll);
      if (offset) {
        inner.add(offset);
        outer.add(offset);
      }
      const i = row * cols + col;
      position[i * 3] = outer.x;
      position[i * 3 + 1] = outer.y;
      position[i * 3 + 2] = outer.z;
      normal[i * 3] = n.x;
      normal[i * 3 + 1] = n.y;
      normal[i * 3 + 2] = n.z;
      uv[i * 2] = u;
      uv[i * 2 + 1] = v;
      const j = half + i;
      position[j * 3] = inner.x;
      position[j * 3 + 1] = inner.y;
      position[j * 3 + 2] = inner.z;
      normal[j * 3] = -n.x;
      normal[j * 3 + 1] = -n.y;
      normal[j * 3 + 2] = -n.z;
      uv[j * 2] = u;
      uv[j * 2 + 1] = v;
    }
  }

  const index: number[] = [];
  for (let row = 0; row < segV; row += 1) {
    for (let col = 0; col < segU; col += 1) {
      const a = row * cols + col;
      const b = a + 1;
      const c = a + cols;
      const d = c + 1;
      index.push(a, c, b, b, c, d);
      // Inner surface, wound the other way so it faces inward.
      index.push(half + a, half + b, half + c, half + b, half + d, half + c);
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(position, 3));
  geo.setAttribute("normal", new THREE.BufferAttribute(normal, 3));
  geo.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
  geo.setIndex(index);
  // The bevel bends the surface away from the host ellipsoid's normal, so the
  // analytic normals above are only right in the plate's flat middle.
  geo.computeVertexNormals();
  return geo;
}

/* --------------------------------------------------------------------- trim */

export type TrimSpec = {
  radii: Radii;
  /** Start and end surface points, unless `path` describes the whole route. */
  from?: [number, number];
  to?: [number, number];
  lift?: number;
  radius?: number;
  steps?: number;
  offset?: THREE.Vector3;
  /**
   * Route the line through arbitrary surface points instead of straight from
   * `from` to `to`. Handed `t` in 0..1, returns `[phi, theta]`, so a trim can
   * trace a shaped plate's edge or cross a pole.
   */
  path?: (t: number) => [number, number];
};

/**
 * A glowing line traced over the body between two surface points.
 *
 * Both `phi` and `theta` are interpolated, so one call draws a band around a
 * limb, a seam running up a chest, or the diagonal brow line the reference
 * wears — whichever two endpoints describe.
 */
export function buildTrim(spec: TrimSpec): THREE.BufferGeometry {
  const lift = spec.lift ?? 0.016;
  const radius = spec.radius ?? 0.006;
  const steps = spec.steps ?? 14;
  const points: THREE.Vector3[] = [];
  const p = new THREE.Vector3();
  const n = new THREE.Vector3();
  for (let i = 0; i <= steps; i += 1) {
    const t = i / steps;
    const from = spec.from ?? [0, 0];
    const to = spec.to ?? from;
    const at = spec.path?.(t);
    const phi = at ? at[0] : from[0] + (to[0] - from[0]) * t;
    const theta = at ? at[1] : from[1] + (to[1] - from[1]) * t;
    surfacePoint(spec.radii, phi, theta, p);
    surfaceNormal(spec.radii, p, n);
    const point = p.clone().addScaledVector(n, lift);
    if (spec.offset) point.add(spec.offset);
    points.push(point);
  }
  const curve = new THREE.CatmullRomCurve3(points);
  // Five sides is plenty: a trim tube is a few pixels across on screen and the
  // emissive surface has no highlight to give the facets away.
  return new THREE.TubeGeometry(curve, steps, radius, 5, false);
}

/* ------------------------------------------------------------- dressing sets */

/** What a dressed body part hands back: one shell geometry and one trim geometry. */
export type Dressing = {
  shell: THREE.BufferGeometry | null;
  trim: THREE.BufferGeometry | null;
};

export type TorsoDressSpec = {
  width: number;
  height: number;
  length: number;
  upright: boolean;
  /** Vertical centre of the trunk in the part's own space, usually 0. */
  centerY?: number;
  /**
   * Plate thickness multiplier, 1 by default.
   *
   * A round body needs this down near a half: plate thickness is derived from
   * the trunk's smallest radius, and on a sphere every radius is the largest
   * one, so the belt that reads as a belt on a torso comes out as a ring around
   * a planet.
   */
  bulk?: number;
};

/**
 * Torso armour: a chest plate split down the middle by a seam, a pair of
 * shoulder caps, and a belt plate at the hips.
 *
 * The chest is two plates rather than one because the reference's centre seam
 * is what gives the torso a front — a single wrapped plate reads as a barrel.
 */
export function dressTorso(spec: TorsoDressSpec): Dressing {
  const radii: Radii = {
    rx: spec.width * 0.52,
    ry: spec.height * 0.52,
    rz: spec.length * (spec.upright ? 0.56 : 0.5),
  };
  const offset = spec.centerY ? new THREE.Vector3(0, spec.centerY, 0) : undefined;
  const thickness = Math.min(radii.rx, radii.rz) * 0.13 * (spec.bulk ?? 1);
  const lift = thickness * 0.3;
  const plates: THREE.BufferGeometry[] = [];
  const trims: THREE.BufferGeometry[] = [];

  // Chest halves. The seam gap is the 0.06rad either side of centre they both
  // stop short of, which shows the skin underneath as a dark line.
  for (const side of [-1, 1]) {
    plates.push(
      buildPlate({
        radii,
        phi: [0.5, 1.5],
        theta: side < 0 ? [-1.15, -0.07] : [0.07, 1.15],
        lift,
        thickness,
      }),
    );
    // Trim along the plate's lower edge, which is where the eye reads the
    // bottom of the ribcage.
    trims.push(
      buildTrim({
        radii,
        from: [1.5, side < 0 ? -1.1 : 0.09],
        to: [1.5, side < 0 ? -0.09 : 1.1],
        lift: lift + thickness,
        radius: thickness * 0.34,
        offset,
      }),
    );
  }
  // Collar: a band across the top of the chest, under where the head sits.
  trims.push(
    buildTrim({
      radii,
      from: [0.56, -1.1],
      to: [0.56, 1.1],
      lift: lift + thickness,
      radius: thickness * 0.3,
      steps: 16,
      offset,
    }),
  );

  // Back plate, one piece: nothing needs to read across it.
  plates.push(
    buildPlate({
      radii,
      phi: [0.6, 1.6],
      theta: [Math.PI - 1.0, Math.PI + 1.0],
      lift,
      thickness: thickness * 0.85,
    }),
  );

  // Belt, wrapped the whole way round at the hips.
  plates.push(
    buildPlate({
      radii,
      phi: [1.72, 2.06],
      theta: [-Math.PI, Math.PI],
      lift,
      thickness: thickness * 0.9,
      bevel: 0.4,
      segments: [18, 4],
    }),
  );

  if (offset) {
    for (const plate of plates) plate.translate(offset.x, offset.y, offset.z);
  }
  return { shell: mergeGeometries(plates), trim: mergeGeometries(trims) };
}

export type HeadDressSpec = {
  /** Radius of the skull the shell is worn on. */
  radius: number;
  /** Squash the shell along Y, for a skull that is not a sphere. */
  squash?: number;
  /** Trace the brow line, which a face-block head does not want. */
  brow?: boolean;
};

/**
 * Head shell: a crown plate over the top and back of the skull, cheek plates
 * down either side, and — on a bare head — the brow line the reference wears
 * angled down toward the centre of the face.
 *
 * The front of the skull is deliberately left bare so eyes, visor or a face
 * block still read; the crown stops well short of it.
 *
 * Neither plate's lower edge is level. A crown cut at one latitude draws a
 * hoop right across the brow, and a cheek plate cut at one latitude ends in a
 * straight line through the middle of the jaw — both read as a decal rather
 * than as armour made for this skull. So the crown dips to a point at the brow,
 * lifts at the temples to let the cheek show under it, and comes lower down the
 * nape; and the cheek flares down to a jaw guard at the chin end while tapering
 * to a narrow strap where it tucks under the crown at the ear.
 */
export function dressHead(spec: HeadDressSpec): Dressing {
  const r = spec.radius;
  const radii: Radii = { rx: r, ry: r * (spec.squash ?? 1), rz: r };
  const thickness = r * 0.12;
  const lift = thickness * 0.25;
  const plates: THREE.BufferGeometry[] = [];
  const trims: THREE.BufferGeometry[] = [];

  // Crown: over the top, from the brow back and down the nape. Its lower edge
  // is a function of heading rather than a constant, written in theta so the
  // seam and the brow line below can be placed off the same curve and stay
  // agreed with it.
  const crownHem = (theta: number): number => {
    const facing = Math.cos(theta);
    return 1.02 + 0.22 * Math.max(facing, 0) + 0.3 * Math.max(-facing, 0);
  };
  plates.push(
    buildPlate({
      radii,
      phi: (u) => [0.0, crownHem(-Math.PI + 2 * Math.PI * u)],
      theta: [-Math.PI, Math.PI],
      lift,
      thickness,
      bevel: 0.3,
      segments: [24, 7],
    }),
  );
  // Cheeks, either side of the face, leaving the middle clear.
  //
  // `theta` has to stay ascending or the patch sweeps backwards and turns
  // itself inside out, which puts the front of the face at u = 1 on the left
  // side and u = 0 on the right. `chinward` folds that away so one jaw curve
  // describes both sides: 1 at the chin end of the plate, 0 at the ear end.
  const jawTop = (f: number): number => 0.86 + 0.24 * f;
  const jawHem = (f: number): number => 1.42 + 0.58 * f;
  for (const side of [-1, 1]) {
    const theta: [number, number] = side < 0 ? [-1.5, -0.62] : [0.62, 1.5];
    const chinward = (u: number): number => (side < 0 ? u : 1 - u);
    plates.push(
      buildPlate({
        radii,
        phi: (u) => [jawTop(chinward(u)), jawHem(chinward(u))],
        theta,
        lift,
        thickness: thickness * 0.8,
        segments: [10, 6],
      }),
    );
    // Trim along that lower edge. The jaw is the line the eye looks for on a
    // head, and a lit line on it is what makes the flare read as a jaw rather
    // than as a plate that happens to be wider at one end.
    trims.push(
      buildTrim({
        radii,
        path: (t) => [jawHem(chinward(t)), theta[0] + (theta[1] - theta[0]) * t],
        lift: lift + thickness * 0.8,
        radius: thickness * 0.24,
        steps: 12,
      }),
    );
  }
  if (spec.brow !== false) {
    // Brow: dips toward the centre line, which is what reads as a scowl and
    // gives the face a direction even with no features on it. It rides a fixed
    // distance below the crown's hem, so it is the crown that decides where the
    // scowl sits and the two can never disagree — a line tuned independently
    // ends up buried under the plate at one end of its run.
    for (const side of [-1, 1]) {
      trims.push(
        buildTrim({
          radii,
          path: (t) => {
            const theta = side * (1.45 - 1.33 * t);
            return [crownHem(theta) + 0.1, theta];
          },
          lift: lift + thickness,
          radius: thickness * 0.3,
          steps: 10,
        }),
      );
    }
  }
  // Crown seam, front to back over the top of the skull. Interpolating a
  // fixed latitude from theta 0 to theta pi would have run it round the side
  // instead; going over means crossing the pole, where theta flips and phi
  // turns back, so the route is written out rather than lerped.
  trims.push(
    buildTrim({
      radii,
      path: (t) =>
        t < 0.5 ? [crownHem(0) * (1 - 2 * t), 0] : [crownHem(Math.PI) * (2 * t - 1), Math.PI],
      lift: lift + thickness,
      radius: thickness * 0.26,
      steps: 18,
    }),
  );

  return { shell: mergeGeometries(plates), trim: mergeGeometries(trims) };
}

export type SegmentDressSpec = {
  /** Radius of the body at this segment. */
  radius: number;
  /** The body's axis at this segment: "z" for a body lying front-to-back. */
  axis: "y" | "z";
};

/**
 * Armour for one segment of a long, bending body: a dorsal plate over the top
 * and a band round the girth.
 *
 * A long body cannot wear the chest-and-belt set. A rigid plate spanning a
 * spine that undulates would tear out through its own skin on the first idle
 * wave — so the plating is broken into a ring per segment, each riding its own
 * bone, which keeps the armour intact however far the body bends.
 *
 * The band is a torus rather than a traced trim line because it has to encircle
 * the body's *axis*, and for a body lying front-to-back that is not the axis a
 * belt would wrap.
 */
export function dressSegment(spec: SegmentDressSpec): Dressing {
  const r = spec.radius;
  const thickness = r * 0.16;
  const lift = thickness * 0.3;

  // Dorsal plate over the top of the segment, narrow enough that the flanks
  // stay bare skin.
  const plate = buildPlate({
    radii: { rx: r, ry: r, rz: r },
    phi: [0.12, 0.95],
    theta: spec.axis === "z" ? [-1.35, 1.35] : [-Math.PI, Math.PI],
    lift,
    thickness,
    bevel: 0.3,
    segments: [12, 5],
  });

  const band = new THREE.TorusGeometry(r + lift + thickness * 0.4, thickness * 0.34, 5, 16);
  // A torus is born in the XY plane with its hole down +Z, which is right for a
  // body running front-to-back. An upright segment needs it laid flat instead.
  if (spec.axis === "y") band.rotateX(Math.PI / 2);

  return { shell: plate, trim: band };
}

export type LimbDressSpec = {
  /** Length of the segment being dressed, running down -Y from its pivot. */
  length: number;
  rootRadius: number;
  tipRadius: number;
  /** A shoulder or hip cap over the socket at the top of the segment. */
  cap?: boolean;
};

/**
 * Limb armour: a cap over the joint socket, a plate down the front of the
 * segment, and a glowing band round the middle.
 *
 * A limb is a tapered tube, not an ellipsoid, so each piece is built on its own
 * local ellipsoid sized to the radius at that height and then offset down the
 * segment — which lets the same plate code follow a taper it knows nothing
 * about.
 */
export function dressLimb(spec: LimbDressSpec): Dressing {
  const { length, rootRadius, tipRadius } = spec;
  const plates: THREE.BufferGeometry[] = [];
  const trims: THREE.BufferGeometry[] = [];
  // Kept deliberately thin relative to the limb. A stubby chibi limb is only a
  // couple of radii long, so plating it at the torso's proportional thickness
  // swells every segment into a bead and the leg reads as a stack of balls.
  const thickness = rootRadius * 0.12;
  const lift = thickness * 0.25;

  if (spec.cap !== false) {
    // Socket cap: a dome over the shoulder or hip, which is what stops a limb
    // reading as a stick pushed into the body.
    const capR = rootRadius * 1.04;
    plates.push(
      buildPlate({
        radii: { rx: capR, ry: capR, rz: capR },
        phi: [0, 1.32],
        theta: [-Math.PI, Math.PI],
        lift,
        thickness,
        bevel: 0.32,
        segments: [16, 6],
      }),
    );
  }

  // Front plate over the upper half of the segment: a greave or a bracer.
  const midR = rootRadius + (tipRadius - rootRadius) * 0.45;
  const plateR = { rx: midR * 1.04, ry: length * 0.3, rz: midR * 1.04 };
  plates.push(
    buildPlate({
      radii: plateR,
      phi: [0.62, 2.1],
      theta: [-1.25, 1.25],
      lift,
      thickness,
      offset: new THREE.Vector3(0, -length * 0.34, 0),
    }),
  );

  // Band round the segment below the plate, where a joint would be.
  const bandR = rootRadius + (tipRadius - rootRadius) * 0.78;
  trims.push(
    buildTrim({
      radii: { rx: bandR, ry: bandR, rz: bandR },
      from: [Math.PI / 2, -Math.PI + 0.001],
      to: [Math.PI / 2, Math.PI - 0.001],
      lift: lift + thickness * 0.6,
      radius: thickness * 0.32,
      steps: 18,
      offset: new THREE.Vector3(0, -length * 0.74, 0),
    }),
  );

  return { shell: mergeGeometries(plates), trim: mergeGeometries(trims) };
}
