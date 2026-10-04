import * as THREE from "three";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";

/**
 * The one lighting rig, shared by the AR arena and the character lab.
 *
 * It used to be two copies of "a hemisphere light and a directional light",
 * which is what made bodies read as flat toys: a single key with no fill and
 * no rim gives a creature one bright side, one black side and no edge, and
 * `castShadow` was set on the meshes while the renderer's shadow map was never
 * switched on, so nothing ever touched the floor.
 *
 * What is here instead is a three-point rig plus a shadow catcher:
 *
 * - **hemisphere** — the ambient bed. Sky above, ground bounce below.
 * - **key** — warm, high, from the front-right. Carries the form, and is the
 *   only light that casts, so there is exactly one shadow map in the frame.
 * - **fill** — cool, low, from the opposite side. Lifts the shadow side off
 *   black without flattening what the key just shaped.
 * - **rim** — from behind and above, so a silhouette separates from whatever
 *   is behind it. In AR that background is a live camera feed, which is the
 *   hardest thing there is to stand out against.
 *
 * The key's shadow camera is kept small — a couple of metres a side — so its
 * texels stay tight and contact shadows stay sharp. That only works if the
 * light follows the bodies, which is what `focus` is for: call it once a frame
 * with whoever is standing and the rig walks itself over them.
 */
export type LightRig = {
  key: THREE.DirectionalLight;
  fill: THREE.DirectionalLight;
  rim: THREE.DirectionalLight;
  hemisphere: THREE.HemisphereLight;
  /** The plane the key's shadow lands on. Invisible except for the shadow. */
  catcher: THREE.Mesh;
  /**
   * Walk the key and the catcher over a point, keeping the light's offset.
   * Cheap enough to call every frame; allocates nothing.
   */
  focus: (at: THREE.Vector3) => void;
  dispose: () => void;
};

/** Where the key sits relative to whatever it is lighting, in metres. */
const KEY_OFFSET = new THREE.Vector3(1.5, 4, 2);

export type LightRigOptions = {
  /** Floor height the shadow catcher sits just above. */
  floorY?: number;
  /** How dark the caught shadow goes. Lower over a bright camera feed. */
  shadowOpacity?: number;
  /** Shadow map resolution. 1024 holds 60fps on a mid-range phone. */
  shadowMapSize?: number;
  /**
   * How strongly the room reflects in the armour. 0 switches the environment
   * off entirely, for a caller that wants the three lights and nothing else.
   */
  environmentIntensity?: number;
};

/**
 * Configure a renderer for the rig and add the rig to a scene.
 *
 * Tone mapping belongs here rather than at the call site: ACES is what keeps a
 * 2.4-intensity key from clipping a bright creature's highlights to flat
 * white, and the rig's intensities are balanced against it. A renderer with
 * the rig but without the tone mapping is a different look, not the same one.
 */
export function installLightRig(
  renderer: THREE.WebGLRenderer,
  scene: THREE.Scene,
  options: LightRigOptions = {},
): LightRig {
  const floorY = options.floorY ?? 0;
  const shadowOpacity = options.shadowOpacity ?? 0.32;
  const mapSize = options.shadowMapSize ?? 1024;

  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.15;

  /**
   * Environment map: what makes the armour read as armour.
   *
   * Three directional lights give a plate one highlight and nothing else, so a
   * glossy shell came out looking like matte vinyl and a dark shell came out
   * as a flat black hole with only its trim visible — which is exactly what
   * the construct's plating was doing. A metallic-rough surface needs
   * *something to reflect*: the reference's black helmet reads as lacquer
   * because a room is smeared across it. `RoomEnvironment` is a studio box of
   * bright panels, prefiltered once here into a small PMREM, which gives every
   * plate a broad soft reflection and its bevels a bright edge.
   *
   * 256px is plenty — it is only ever seen blurred across curved plate — and
   * the intensity is kept well under 1 so the room adds sheen without becoming
   * the light source and flattening the key's shaping. The hemisphere bed is
   * pulled down to compensate, since the environment now carries part of the
   * ambient it used to carry alone.
   */
  const envIntensity = options.environmentIntensity ?? 0.42;
  let envMap: THREE.Texture | null = null;
  if (envIntensity > 0) {
    const pmrem = new THREE.PMREMGenerator(renderer);
    const room = new RoomEnvironment();
    envMap = pmrem.fromScene(room, 0.04, 0.1, 30).texture;
    scene.environment = envMap;
    scene.environmentIntensity = envIntensity;
    // The room itself is scaffolding for the prefilter — nothing renders it
    // again, so its meshes go back immediately rather than living in memory
    // for the session.
    room.traverse((node) => {
      const mesh = node as THREE.Mesh;
      if (!mesh.isMesh) return;
      mesh.geometry.dispose();
      const material = mesh.material;
      for (const item of Array.isArray(material) ? material : [material]) item.dispose();
    });
    pmrem.dispose();
  }

  const hemisphere = new THREE.HemisphereLight(0xdff0ff, 0x24303f, envIntensity > 0 ? 0.68 : 1.05);

  const key = new THREE.DirectionalLight(0xfff4e6, 2.4);
  key.castShadow = true;
  key.shadow.mapSize.set(mapSize, mapSize);
  const shadowCam = key.shadow.camera;
  shadowCam.left = -1.8;
  shadowCam.right = 1.8;
  shadowCam.top = 1.8;
  shadowCam.bottom = -1.8;
  shadowCam.near = 0.5;
  shadowCam.far = 14;
  // Bias pair tuned for capsule-heavy bodies: plain bias alone either leaves
  // acne on the curved trunk or peels the contact shadow off the feet.
  key.shadow.bias = -0.0009;
  key.shadow.normalBias = 0.02;
  key.shadow.radius = 2;

  const target = new THREE.Object3D();
  key.target = target;

  const fill = new THREE.DirectionalLight(0xbcd7ff, 0.55);
  fill.position.set(-2.5, 1.6, 1.2);

  const rim = new THREE.DirectionalLight(0xffffff, 0.9);
  rim.position.set(-0.8, 2.8, -3);

  const catcherGeometry = new THREE.PlaneGeometry(14, 14);
  const catcherMaterial = new THREE.ShadowMaterial({
    color: 0x000000,
    opacity: shadowOpacity,
    transparent: true,
  });
  const catcher = new THREE.Mesh(catcherGeometry, catcherMaterial);
  catcher.rotation.x = -Math.PI / 2;
  catcher.position.y = floorY + 0.002;
  catcher.receiveShadow = true;

  scene.add(hemisphere, key, target, fill, rim, catcher);
  key.position.copy(KEY_OFFSET).setY(KEY_OFFSET.y + floorY);

  return {
    key,
    fill,
    rim,
    hemisphere,
    catcher,
    focus: (at) => {
      target.position.copy(at);
      key.position.set(at.x + KEY_OFFSET.x, at.y + KEY_OFFSET.y, at.z + KEY_OFFSET.z);
      catcher.position.set(at.x, floorY + 0.002, at.z);
    },
    dispose: () => {
      scene.remove(hemisphere, key, target, fill, rim, catcher);
      if (envMap) {
        if (scene.environment === envMap) scene.environment = null;
        envMap.dispose();
      }
      catcherGeometry.dispose();
      catcherMaterial.dispose();
      key.dispose();
      fill.dispose();
      rim.dispose();
      hemisphere.dispose();
    },
  };
}
