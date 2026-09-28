import * as THREE from "three";

/**
 * World-anchored markers: the GPS half of the scene.
 *
 * The character is anchored to the room by hit-test, but boosters, hazards and
 * opponents are anchored to the Earth — they live in a group that is rotated to
 * true north and positioned in metres from the session origin. Each kind reads
 * differently at a glance and from a distance, which is the whole job: a player
 * should know "collect that / do not walk there / that is a person" without
 * reading a label.
 */

export type MarkerKind = "booster" | "hazard" | "opponent";

export type Marker = {
  id: string;
  kind: MarkerKind;
  /** Metres east / north of the session origin. */
  east: number;
  north: number;
  label: string;
  /** Booster rarity, or hazard kind. */
  variant?: string;
  /** Hazard radius in metres. */
  radiusM?: number;
  /** True when the server says the player is close enough to act. */
  inRange?: boolean;
  distanceM?: number;
};

const RARITY_COLOR: Record<string, number> = {
  common: 0x9aa4b2,
  uncommon: 0x5ec8e5,
  rare: 0xb6f03c,
  epic: 0xa473f5,
  legendary: 0xf0a63c,
};

const HAZARD_COLOR = 0xff3b30;

/**
 * Anything past this is drawn on a ring at this distance instead of where it
 * really is. A booster 300 m away is a sub-pixel speck otherwise; pinning it to
 * the ring keeps the bearing honest and lets the label carry the distance.
 */
export const MAX_RENDER_M = 26;

export type MarkerObject = {
  marker: Marker;
  object: THREE.Object3D;
  update: (elapsed: number) => void;
  dispose: () => void;
};

export function createMarker(marker: Marker): MarkerObject {
  const { object, update, dispose } =
    marker.kind === "hazard"
      ? hazardMesh(marker)
      : marker.kind === "opponent"
        ? opponentMesh(marker)
        : boosterMesh(marker);

  object.name = `${marker.kind}:${marker.id}`;
  object.userData.markerId = marker.id;
  object.userData.markerKind = marker.kind;
  placeOnGround(object, marker);
  return { marker, object, update, dispose };
}

/** Position in local metres, clamped to the render ring, bearing preserved. */
export function placeOnGround(object: THREE.Object3D, marker: Marker) {
  const distance = Math.hypot(marker.east, marker.north);
  const scale = distance > MAX_RENDER_M ? MAX_RENDER_M / distance : 1;
  object.position.set(marker.east * scale, 0, -marker.north * scale);
  // Far markers are drawn slightly larger so they stay legible on the ring.
  object.scale.setScalar(distance > MAX_RENDER_M ? 1.6 : 1);
}

/* ------------------------------------------------------------------ booster */

function boosterMesh(marker: Marker) {
  const color = RARITY_COLOR[marker.variant ?? "common"] ?? RARITY_COLOR.common!;
  const group = new THREE.Group();
  const disposables: Array<THREE.BufferGeometry | THREE.Material> = [];

  const shellGeo = new THREE.IcosahedronGeometry(0.22, 1);
  const shellMat = new THREE.MeshStandardMaterial({
    color,
    emissive: new THREE.Color(color),
    emissiveIntensity: 0.7,
    metalness: 0.3,
    roughness: 0.25,
    transparent: true,
    opacity: 0.92,
  });
  const shell = new THREE.Mesh(shellGeo, shellMat);
  shell.position.y = 1.1;
  group.add(shell);
  disposables.push(shellGeo, shellMat);

  const cageGeo = new THREE.IcosahedronGeometry(0.32, 0);
  const cageMat = new THREE.MeshBasicMaterial({ color, wireframe: true, transparent: true, opacity: 0.45 });
  const cage = new THREE.Mesh(cageGeo, cageMat);
  cage.position.y = 1.1;
  group.add(cage);
  disposables.push(cageGeo, cageMat);

  // Beam to the ground so the orb is findable when it is off to the side.
  const beamGeo = new THREE.CylinderGeometry(0.035, 0.09, 1.1, 10, 1, true);
  const beamMat = new THREE.MeshBasicMaterial({
    color,
    transparent: true,
    opacity: 0.22,
    side: THREE.DoubleSide,
    depthWrite: false,
  });
  const beam = new THREE.Mesh(beamGeo, beamMat);
  beam.position.y = 0.55;
  group.add(beam);
  disposables.push(beamGeo, beamMat);

  const padGeo = new THREE.RingGeometry(0.2, 0.3, 40);
  const padMat = new THREE.MeshBasicMaterial({
    color,
    transparent: true,
    opacity: 0.5,
    side: THREE.DoubleSide,
  });
  const pad = new THREE.Mesh(padGeo, padMat);
  pad.rotation.x = -Math.PI / 2;
  pad.position.y = 0.02;
  group.add(pad);
  disposables.push(padGeo, padMat);

  return {
    object: group,
    update(elapsed: number) {
      shell.rotation.y = elapsed * 0.9;
      shell.rotation.x = elapsed * 0.4;
      cage.rotation.y = -elapsed * 0.6;
      const bob = Math.sin(elapsed * 1.6) * 0.07;
      shell.position.y = 1.1 + bob;
      cage.position.y = 1.1 + bob;
      // In range: the pad opens up and pulses fast — the "collect me" tell.
      const pulse = marker.inRange ? 0.45 + Math.sin(elapsed * 5) * 0.3 : 0.28;
      padMat.opacity = pulse;
      pad.scale.setScalar(marker.inRange ? 1.25 + Math.sin(elapsed * 5) * 0.12 : 1);
      cageMat.opacity = marker.inRange ? 0.7 : 0.35;
    },
    dispose() {
      for (const item of disposables) item.dispose();
    },
  };
}

/* ------------------------------------------------------------------- hazard */

function hazardMesh(marker: Marker) {
  const group = new THREE.Group();
  const disposables: Array<THREE.BufferGeometry | THREE.Material> = [];
  const radius = Math.max(1.5, Math.min(marker.radiusM ?? 12, MAX_RENDER_M));

  // A hazard is a wall, not a dot: a translucent no-go cylinder you can see
  // the edge of from inside the play area.
  const wallGeo = new THREE.CylinderGeometry(radius, radius, 2.4, 40, 1, true);
  const wallMat = new THREE.MeshBasicMaterial({
    color: HAZARD_COLOR,
    transparent: true,
    opacity: 0.14,
    side: THREE.DoubleSide,
    depthWrite: false,
  });
  const wall = new THREE.Mesh(wallGeo, wallMat);
  wall.position.y = 1.2;
  group.add(wall);
  disposables.push(wallGeo, wallMat);

  const edgeGeo = new THREE.RingGeometry(radius - 0.25, radius, 64);
  const edgeMat = new THREE.MeshBasicMaterial({
    color: HAZARD_COLOR,
    transparent: true,
    opacity: 0.6,
    side: THREE.DoubleSide,
  });
  const edge = new THREE.Mesh(edgeGeo, edgeMat);
  edge.rotation.x = -Math.PI / 2;
  edge.position.y = 0.03;
  group.add(edge);
  disposables.push(edgeGeo, edgeMat);

  const postGeo = new THREE.CylinderGeometry(0.05, 0.05, 2, 8);
  const postMat = new THREE.MeshBasicMaterial({ color: HAZARD_COLOR, transparent: true, opacity: 0.75 });
  for (let i = 0; i < 8; i += 1) {
    const angle = (i / 8) * Math.PI * 2;
    const post = new THREE.Mesh(postGeo, postMat);
    post.position.set(Math.cos(angle) * radius, 1, Math.sin(angle) * radius);
    group.add(post);
  }
  disposables.push(postGeo, postMat);

  return {
    object: group,
    update(elapsed: number) {
      wallMat.opacity = 0.1 + Math.sin(elapsed * 3) * 0.05;
      edgeMat.opacity = 0.45 + Math.sin(elapsed * 3) * 0.2;
    },
    dispose() {
      for (const item of disposables) item.dispose();
    },
  };
}

/* ----------------------------------------------------------------- opponent */

function opponentMesh(marker: Marker) {
  const group = new THREE.Group();
  const disposables: Array<THREE.BufferGeometry | THREE.Material> = [];
  const color = 0x5ec8e5;

  const markerGeo = new THREE.OctahedronGeometry(0.26, 0);
  const markerMat = new THREE.MeshStandardMaterial({
    color,
    emissive: new THREE.Color(color),
    emissiveIntensity: 0.6,
    metalness: 0.5,
    roughness: 0.3,
  });
  const diamond = new THREE.Mesh(markerGeo, markerMat);
  diamond.position.y = 1.9;
  group.add(diamond);
  disposables.push(markerGeo, markerMat);

  const columnGeo = new THREE.CylinderGeometry(0.06, 0.06, 1.9, 10, 1, true);
  const columnMat = new THREE.MeshBasicMaterial({
    color,
    transparent: true,
    opacity: 0.25,
    side: THREE.DoubleSide,
    depthWrite: false,
  });
  const column = new THREE.Mesh(columnGeo, columnMat);
  column.position.y = 0.95;
  group.add(column);
  disposables.push(columnGeo, columnMat);

  const footGeo = new THREE.RingGeometry(0.24, 0.36, 40);
  const footMat = new THREE.MeshBasicMaterial({
    color,
    transparent: true,
    opacity: 0.45,
    side: THREE.DoubleSide,
  });
  const foot = new THREE.Mesh(footGeo, footMat);
  foot.rotation.x = -Math.PI / 2;
  foot.position.y = 0.02;
  group.add(foot);
  disposables.push(footGeo, footMat);

  return {
    object: group,
    update(elapsed: number) {
      diamond.rotation.y = elapsed * 1.1;
      diamond.position.y = 1.9 + Math.sin(elapsed * 1.4) * 0.06;
      footMat.opacity = marker.inRange ? 0.4 + Math.sin(elapsed * 4) * 0.25 : 0.3;
    },
    dispose() {
      for (const item of disposables) item.dispose();
    },
  };
}
