import * as THREE from "three";

/**
 * Sculpt: one continuous surface from a handful of overlapping masses.
 *
 * The bodies were already lofted rather than stacked boxes, but every *join*
 * was still two surfaces crossing: a sphere at the shoulder pushed into the
 * chest loft, a ball at the knee pushed into the shin. Two surfaces crossing
 * leave a hard crease exactly where a real body has its softest transition, and
 * that crease is what makes a creature read as parts assembled rather than one
 * animal — the thing the reference art gets right and this did not.
 *
 * So a part is described here as a set of implicit masses — balls and tapered
 * rods — and the surface is found *between* them with a smooth union, which
 * fillets every join instead of intersecting it. The masses are only a
 * description; nothing in the output remembers where one ended and the next
 * began.
 *
 * Meshing is naive surface nets over a regular grid: one vertex per cell that
 * straddles the surface, placed at the average of the crossings on that cell's
 * edges, quads stitched across grid edges. It is chosen over marching cubes
 * because the vertices come out evenly spread and the triangles come out
 * well-shaped, which matters a lot more than exactness when a procedural
 * normal map is going to ride on top of it.
 *
 * Costs, measured at the resolutions the anatomy module asks for: a trunk is
 * ~25³ cells and a couple of thousand vertices, a limb segment a fraction of
 * that. A whole body is a few milliseconds of build time, once, and no more
 * draw calls than before — fewer, in fact, because the joint balls stopped
 * being their own meshes.
 */

export type V3 = readonly [number, number, number];

/** A rounded lump. `scale` stretches it into an ellipsoid. */
export type BallMass = { kind: "ball"; at: V3; r: number; scale?: V3 };

/** A tapered capsule from `from` to `to` — a shaft, a shin, a finger. */
export type RodMass = { kind: "rod"; from: V3; to: V3; r: number; toR?: number };

export type Mass = BallMass | RodMass;

export type SculptOptions = {
  /**
   * Fillet size of the smooth union, in metres. This is the single number that
   * decides whether the body reads as fleshy or as welded pipes: it is the
   * radius of the blend where two masses meet. Too small and the crease comes
   * back, too large and the creature inflates into a blob.
   */
  blend?: number;
  /** Target grid cell size. Smaller is rounder and slower. */
  cell?: number;
  /** Hard cap on cells per axis, so a big body cannot blow the build budget. */
  maxCells?: number;
  /** Axis the cylindrical UV wraps around. A trunk is "y", a limb is "y" too. */
  uvAxis?: "y" | "z";
};

/* -------------------------------------------------------- distance functions */

/**
 * Polynomial smooth minimum.
 *
 * The blend term is what a plain `Math.min` (a hard union) lacks: within `k` of
 * the seam it pulls the surface outward by the amount that makes the transition
 * curvature-continuous, which is the fillet.
 */
function smin(a: number, b: number, k: number): number {
  if (k <= 0) return Math.min(a, b);
  const h = Math.max(0, k - Math.abs(a - b)) / k;
  return Math.min(a, b) - h * h * k * 0.25;
}

type Prepared =
  | {
      kind: 0;
      x: number;
      y: number;
      z: number;
      rx: number;
      ry: number;
      rz: number;
      unit: number;
    }
  | {
      kind: 1;
      ax: number;
      ay: number;
      az: number;
      bx: number;
      by: number;
      bz: number;
      r1: number;
      r2: number;
    };

function prepare(masses: readonly Mass[]): Prepared[] {
  const out: Prepared[] = [];
  for (const mass of masses) {
    if (mass.kind === "ball") {
      const sx = mass.scale?.[0] ?? 1;
      const sy = mass.scale?.[1] ?? 1;
      const sz = mass.scale?.[2] ?? 1;
      const rx = Math.max(1e-4, mass.r * sx);
      const ry = Math.max(1e-4, mass.r * sy);
      const rz = Math.max(1e-4, mass.r * sz);
      out.push({
        kind: 0,
        x: mass.at[0],
        y: mass.at[1],
        z: mass.at[2],
        rx,
        ry,
        rz,
        // An ellipsoid has no cheap exact distance. Scaling the unit-sphere
        // distance by the smallest radius is the standard bound: never further
        // than the truth, which keeps the blend well behaved.
        unit: Math.min(rx, ry, rz),
      });
      continue;
    }
    out.push({
      kind: 1,
      ax: mass.from[0],
      ay: mass.from[1],
      az: mass.from[2],
      bx: mass.to[0],
      by: mass.to[1],
      bz: mass.to[2],
      r1: Math.max(1e-4, mass.r),
      r2: Math.max(1e-4, mass.toR ?? mass.r),
    });
  }
  return out;
}

/** Exact distance to a round cone (a capsule with a different radius per end). */
function rodDistance(item: Extract<Prepared, { kind: 1 }>, px: number, py: number, pz: number): number {
  const bax = item.bx - item.ax;
  const bay = item.by - item.ay;
  const baz = item.bz - item.az;
  const l2 = bax * bax + bay * bay + baz * baz;
  if (l2 < 1e-9) {
    return Math.hypot(px - item.ax, py - item.ay, pz - item.az) - item.r1;
  }
  const rr = item.r1 - item.r2;
  const a2 = l2 - rr * rr;
  const il2 = 1 / l2;
  const pax = px - item.ax;
  const pay = py - item.ay;
  const paz = pz - item.az;
  const y = pax * bax + pay * bay + paz * baz;
  const z = y - l2;
  const xx = pax * l2 - bax * y;
  const xy = pay * l2 - bay * y;
  const xz = paz * l2 - baz * y;
  const x2 = xx * xx + xy * xy + xz * xz;
  const y2 = y * y * l2;
  const z2 = z * z * l2;
  const k = Math.sign(rr) * rr * rr * x2;
  if (Math.sign(z) * a2 * z2 > k) return Math.sqrt(x2 + z2) * il2 - item.r2;
  if (Math.sign(y) * a2 * y2 < k) return Math.sqrt(x2 + y2) * il2 - item.r1;
  return (Math.sqrt(x2 * a2 * il2) + y * rr) * il2 - item.r1;
}

function distance(items: readonly Prepared[], blend: number, px: number, py: number, pz: number): number {
  let d = Number.POSITIVE_INFINITY;
  for (const item of items) {
    let next: number;
    if (item.kind === 0) {
      const dx = (px - item.x) / item.rx;
      const dy = (py - item.y) / item.ry;
      const dz = (pz - item.z) / item.rz;
      next = (Math.sqrt(dx * dx + dy * dy + dz * dz) - 1) * item.unit;
    } else {
      next = rodDistance(item, px, py, pz);
    }
    d = d === Number.POSITIVE_INFINITY ? next : smin(d, next, blend);
  }
  return d;
}

/* ------------------------------------------------------------------- bounds */

function boundsOf(masses: readonly Mass[]): { min: number[]; max: number[] } {
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  const grow = (at: V3, radii: [number, number, number]) => {
    for (let axis = 0; axis < 3; axis += 1) {
      min[axis] = Math.min(min[axis]!, at[axis]! - radii[axis]!);
      max[axis] = Math.max(max[axis]!, at[axis]! + radii[axis]!);
    }
  };
  for (const mass of masses) {
    if (mass.kind === "ball") {
      const s = mass.scale ?? [1, 1, 1];
      grow(mass.at, [mass.r * s[0]!, mass.r * s[1]!, mass.r * s[2]!]);
    } else {
      const far = Math.max(mass.r, mass.toR ?? mass.r);
      grow(mass.from, [far, far, far]);
      grow(mass.to, [far, far, far]);
    }
  }
  return { min, max };
}

/* ------------------------------------------------------------ surface nets */

const EDGES: Array<[number, number]> = [
  [0, 1],
  [2, 3],
  [4, 5],
  [6, 7],
  [0, 2],
  [1, 3],
  [4, 6],
  [5, 7],
  [0, 4],
  [1, 5],
  [2, 6],
  [3, 7],
];

/** Corner offsets, indexed so bit 0 is x, bit 1 is y, bit 2 is z. */
const CORNERS: Array<[number, number, number]> = [
  [0, 0, 0],
  [1, 0, 0],
  [0, 1, 0],
  [1, 1, 0],
  [0, 0, 1],
  [1, 0, 1],
  [0, 1, 1],
  [1, 1, 1],
];

/**
 * Mesh a set of masses into one surface.
 *
 * The returned geometry carries positions, gradient normals and cylindrical
 * UVs, and is indexed — a drop-in for anything that used to take a loft.
 */
export function sculpt(masses: readonly Mass[], options: SculptOptions = {}): THREE.BufferGeometry {
  const items = prepare(masses);
  const bounds = boundsOf(masses);
  const blend = Math.max(0, options.blend ?? 0.04);
  const maxCells = options.maxCells ?? 30;

  // The blend pushes the surface outward past the masses' own bounds, and the
  // grid needs a shell of outside samples for the sign test to close the
  // surface, so the box is padded by both.
  const span = [0, 0, 0].map((_, axis) => bounds.max[axis]! - bounds.min[axis]!);
  const cell = Math.max(
    1e-3,
    options.cell ?? Math.max(...span) / 22,
  );
  const pad = blend * 0.6 + cell * 1.5;
  const min = bounds.min.map((value) => value - pad);
  const max = bounds.max.map((value) => value + pad);

  const dims = [0, 1, 2].map((axis) => {
    const wanted = Math.ceil((max[axis]! - min[axis]!) / cell);
    return Math.max(3, Math.min(maxCells, wanted));
  }) as [number, number, number];
  const step = [0, 1, 2].map((axis) => (max[axis]! - min[axis]!) / dims[axis]!) as [
    number,
    number,
    number,
  ];

  const [nx, ny, nz] = dims;
  const sx = nx + 1;
  const sy = ny + 1;
  const sz = nz + 1;
  const field = new Float32Array(sx * sy * sz);
  const at = (i: number, j: number, k: number) => (k * sy + j) * sx + i;

  for (let k = 0; k < sz; k += 1) {
    const z = min[2]! + k * step[2];
    for (let j = 0; j < sy; j += 1) {
      const y = min[1]! + j * step[1];
      for (let i = 0; i < sx; i += 1) {
        field[at(i, j, k)] = distance(items, blend, min[0]! + i * step[0], y, z);
      }
    }
  }

  const positions: number[] = [];
  const cellVertex = new Int32Array(nx * ny * nz).fill(-1);
  const cellAt = (i: number, j: number, k: number) => (k * ny + j) * nx + i;

  for (let k = 0; k < nz; k += 1) {
    for (let j = 0; j < ny; j += 1) {
      for (let i = 0; i < nx; i += 1) {
        let inside = 0;
        const values: number[] = [];
        for (const [ox, oy, oz] of CORNERS) {
          const value = field[at(i + ox, j + oy, k + oz)]!;
          values.push(value);
          if (value < 0) inside += 1;
        }
        if (inside === 0 || inside === 8) continue;

        let cx = 0;
        let cy = 0;
        let cz = 0;
        let crossings = 0;
        for (const [a, b] of EDGES) {
          const va = values[a]!;
          const vb = values[b]!;
          if (va < 0 === vb < 0) continue;
          const t = va / (va - vb);
          const ca = CORNERS[a]!;
          const cb = CORNERS[b]!;
          cx += (ca[0] + (cb[0] - ca[0]) * t) * step[0];
          cy += (ca[1] + (cb[1] - ca[1]) * t) * step[1];
          cz += (ca[2] + (cb[2] - ca[2]) * t) * step[2];
          crossings += 1;
        }
        if (crossings === 0) continue;

        cellVertex[cellAt(i, j, k)] = positions.length / 3;
        positions.push(
          min[0]! + i * step[0] + cx / crossings,
          min[1]! + j * step[1] + cy / crossings,
          min[2]! + k * step[2] + cz / crossings,
        );
      }
    }
  }

  const indices: number[] = [];
  /**
   * Quads are dual to the grid edges: an edge that crosses the surface is
   * surrounded by four cells, and each of those cells is guaranteed to hold a
   * vertex, so the four vertices make a face. Winding follows the sign at the
   * edge's low corner, which is consistent across the whole grid.
   */
  const quad = (a: number, b: number, c: number, d: number, flip: boolean) => {
    if (a < 0 || b < 0 || c < 0 || d < 0) return;
    if (flip) indices.push(a, c, b, a, d, c);
    else indices.push(a, b, c, a, c, d);
  };

  for (let k = 0; k < sz; k += 1) {
    for (let j = 0; j < sy; j += 1) {
      for (let i = 0; i < sx; i += 1) {
        const value = field[at(i, j, k)]!;
        const solid = value < 0;
        if (i < nx && j >= 1 && k >= 1 && solid !== field[at(i + 1, j, k)]! < 0) {
          quad(
            cellVertex[cellAt(i, j - 1, k - 1)]!,
            cellVertex[cellAt(i, j, k - 1)]!,
            cellVertex[cellAt(i, j, k)]!,
            cellVertex[cellAt(i, j - 1, k)]!,
            !solid,
          );
        }
        if (j < ny && i >= 1 && k >= 1 && solid !== field[at(i, j + 1, k)]! < 0) {
          quad(
            cellVertex[cellAt(i - 1, j, k - 1)]!,
            cellVertex[cellAt(i, j, k - 1)]!,
            cellVertex[cellAt(i, j, k)]!,
            cellVertex[cellAt(i - 1, j, k)]!,
            solid,
          );
        }
        if (k < nz && i >= 1 && j >= 1 && solid !== field[at(i, j, k + 1)]! < 0) {
          quad(
            cellVertex[cellAt(i - 1, j - 1, k)]!,
            cellVertex[cellAt(i, j - 1, k)]!,
            cellVertex[cellAt(i, j, k)]!,
            cellVertex[cellAt(i - 1, j, k)]!,
            !solid,
          );
        }
      }
    }
  }

  /* ------------------------------------------------- normals, UVs and seams */

  const count = positions.length / 3;
  const normals = new Float32Array(count * 3);
  // Gradient of the field, which is the outward normal by definition. Taken
  // from the field rather than from the triangles, so the surface shades as the
  // smooth thing it is instead of showing the grid it was found on.
  const h = Math.min(...step) * 0.4;
  for (let vertex = 0; vertex < count; vertex += 1) {
    const px = positions[vertex * 3]!;
    const py = positions[vertex * 3 + 1]!;
    const pz = positions[vertex * 3 + 2]!;
    const gx = distance(items, blend, px + h, py, pz) - distance(items, blend, px - h, py, pz);
    const gy = distance(items, blend, px, py + h, pz) - distance(items, blend, px, py - h, pz);
    const gz = distance(items, blend, px, py, pz + h) - distance(items, blend, px, py, pz - h);
    const length = Math.hypot(gx, gy, gz) || 1;
    normals[vertex * 3] = gx / length;
    normals[vertex * 3 + 1] = gy / length;
    normals[vertex * 3 + 2] = gz / length;
  }

  const axis = options.uvAxis ?? "y";
  const low = axis === "y" ? bounds.min[1]! : bounds.min[2]!;
  const high = axis === "y" ? bounds.max[1]! : bounds.max[2]!;
  const reach = Math.max(1e-4, high - low);
  const centre = [
    (bounds.min[0]! + bounds.max[0]!) * 0.5,
    (bounds.min[1]! + bounds.max[1]!) * 0.5,
    (bounds.min[2]! + bounds.max[2]!) * 0.5,
  ];
  const uvs = new Float32Array(count * 2);
  for (let vertex = 0; vertex < count; vertex += 1) {
    const px = positions[vertex * 3]! - centre[0]!;
    const py = positions[vertex * 3 + 1]!;
    const pz = positions[vertex * 3 + 2]! - centre[2]!;
    const around =
      axis === "y"
        ? Math.atan2(pz, px)
        : Math.atan2(px, positions[vertex * 3 + 1]! - centre[1]!);
    uvs[vertex * 2] = around / (Math.PI * 2) + 0.5;
    uvs[vertex * 2 + 1] = ((axis === "y" ? py : positions[vertex * 3 + 2]!) - low) / reach;
  }

  // The wrap is a discontinuity in u, so any triangle spanning it would squeeze
  // a whole copy of the tiling pattern into a thin band down the back. The
  // vertices on the low side of such a triangle are duplicated with u + 1,
  // which is the standard seam split and the only way a wrapped UV holds up
  // under a repeating map.
  const outPositions = Array.from(positions);
  const outNormals = Array.from(normals);
  const outUvs = Array.from(uvs);
  const clones = new Map<number, number>();
  const cloneOf = (vertex: number): number => {
    const existing = clones.get(vertex);
    if (existing !== undefined) return existing;
    const index = outPositions.length / 3;
    outPositions.push(
      outPositions[vertex * 3]!,
      outPositions[vertex * 3 + 1]!,
      outPositions[vertex * 3 + 2]!,
    );
    outNormals.push(
      outNormals[vertex * 3]!,
      outNormals[vertex * 3 + 1]!,
      outNormals[vertex * 3 + 2]!,
    );
    outUvs.push(outUvs[vertex * 2]! + 1, outUvs[vertex * 2 + 1]!);
    clones.set(vertex, index);
    return index;
  };
  for (let triangle = 0; triangle < indices.length; triangle += 3) {
    const a = indices[triangle]!;
    const b = indices[triangle + 1]!;
    const c = indices[triangle + 2]!;
    const ua = outUvs[a * 2]!;
    const ub = outUvs[b * 2]!;
    const uc = outUvs[c * 2]!;
    if (Math.max(ua, ub, uc) - Math.min(ua, ub, uc) <= 0.5) continue;
    if (ua < 0.5) indices[triangle] = cloneOf(a);
    if (ub < 0.5) indices[triangle + 1] = cloneOf(b);
    if (uc < 0.5) indices[triangle + 2] = cloneOf(c);
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(outPositions, 3));
  geometry.setAttribute("normal", new THREE.Float32BufferAttribute(outNormals, 3));
  geometry.setAttribute("uv", new THREE.Float32BufferAttribute(outUvs, 2));
  geometry.setIndex(indices);
  return geometry;
}

/** Vertex count of a sculpt, for budget checks in tests and the lab. */
export function sculptSize(geometry: THREE.BufferGeometry): { vertices: number; triangles: number } {
  return {
    vertices: geometry.getAttribute("position").count,
    triangles: (geometry.getIndex()?.count ?? 0) / 3,
  };
}
