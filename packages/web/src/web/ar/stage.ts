import * as THREE from "three";
import {
  animationDuration,
  createCharacter,
  strikeWeight,
  type AnimationState,
  type Character,
  type CharacterConfig,
} from "./character";
import { createMarker, placeOnGround, type Marker, type MarkerObject } from "./markers";
import { installLightRig, type LightRig } from "./lighting";
import { DASH_MOVES } from "../../api/lib/creature-form";
import {
  ATTACK_PROFILE,
  CLOSE_GUARD_M,
  CORNERED_SPACE_M,
  inReach as profileInReach,
} from "../../api/lib/move-combat";

/**
 * The AR stage: one Three.js renderer driving three presentation modes from
 * the same scene graph.
 *
 *   xr      — WebXR `immersive-ar`. Real passthrough, real 6DoF pose, and
 *             hit-test placement when the device offers it.
 *   camera  — `getUserMedia` passthrough behind a transparent canvas, pose from
 *             device orientation. This is the iOS Safari path and the path for
 *             any browser without WebXR.
 *   preview — no camera at all, orbit-ish look controls on a dark grid. Desktop
 *             development and demos.
 *
 * Two anchor spaces, deliberately:
 *   `roomGroup`  holds the placed character. It is anchored to the physical floor by
 *                hit-test, because a battle happens in the space you are
 *                standing in and must not drift with GPS noise.
 *   `worldGroup` holds boosters, hazards and opponents. It is rotated to true
 *                north and positioned in metres from the session origin, so
 *                those objects are anchored to the Earth.
 *
 * Headset note (XREAL Air 2): birdbath glasses are 3DoF and expose no plane
 * detection, so `hit-test` is requested as an *optional* feature and the stage
 * degrades to placing the character on a fixed floor plane a set distance ahead.
 * Nothing about the rest of the scene changes.
 */

export type StageMode = "xr" | "camera" | "preview";

/**
 * How the second character stands relative to the player's.
 *
 *   spar  — beside and slightly beyond them, the training-partner framing: both
 *           bodies in frame from the phone, the player's own character nearest.
 *   duel  — directly across from them, squared up. This is a fight: the two
 *           characters stand centred between the players, so the exchange reads
 *           as one body swinging at another rather than at the camera.
 */
export type OpponentStance = "spar" | "duel";

export type StageCapabilities = {
  webglSupported: boolean;
  xrSupported: boolean;
  hitTestSupported: boolean;
  cameraSupported: boolean;
  secureContext: boolean;
};

export type StageEvents = {
  onReticle?: (visible: boolean) => void;
  onPlaced?: (placed: boolean) => void;
  onMarkerTap?: (marker: Marker) => void;
  onModeChange?: (mode: StageMode) => void;
  onError?: (message: string) => void;
};

const FLOOR_Y = -1.5;
/** Scratch vectors for the per-frame light walk, so `tick` allocates nothing. */
const LIGHT_FOCUS = new THREE.Vector3();
const LIGHT_SCRATCH = new THREE.Vector3();
/**
 * Scratch rotation/offset for the impact camera kick, for the same reason: it
 * runs every frame a hit is still settling and must not allocate.
 */
const KICK_EULER = new THREE.Euler();
const KICK_QUAT = new THREE.Quaternion();
const KICK_VEC = new THREE.Vector3();
/**
 * Where the character lands when there is no hit-test to land it on. Far
 * enough that a whole body fits in the frame from a phone held at chest
 * height, rather than filling it from the ankles down.
 */
const FALLBACK_DISTANCE_M = 5;
/** How far to the character's side a sparring partner stands, in metres. */
const SPAR_SIDE_M = 0.95;
/** And how much further from the player, so the two bodies do not overlap. */
const SPAR_DEPTH_M = 0.45;
/**
 * How far apart a duel seats the two bodies, in metres.
 *
 * Reach is measured centre to centre less `CLOSE_GUARD_M`, so this is the gap
 * every move's `reachM` is judged against at the start of a round: at one
 * metre a body has 0.45 m of it to cover, which all but the shortest jabs
 * have. Closer than this and the two meshes read as one; further and the pad
 * opens refusing.
 */
const DUEL_GAP_M = 1;
/**
 * Where the view rests when nothing is driving it — no headset, no device
 * orientation, just a browser. Level with the horizon puts the floor ahead at
 * the very bottom of the frame, so a placed character ends up behind whatever
 * chrome the screen is carrying. Tilted down this much the whole body sits in
 * the upper half, clear of the move pad — which is where a player holding a
 * phone points it anyway.
 */
const RESTING_PITCH = -0.3;

/**
 * Walking pace, in metres per second. Deliberately slow: this is a body being
 * watched through a phone camera at a few metres, and anything quicker reads as
 * sliding rather than walking — and on a handheld AR shot, slides off frame.
 */
const MOVE_SPEED_MPS = 1.1;
/**
 * How far the character may roam from where it was placed. The fight has to
 * stay in shot: past this the body is out of the frame of a phone held still,
 * and a player who cannot see their own character has lost the fight to the
 * camera rather than to an opponent.
 */
const ROAM_RADIUS_M = 2.5;
/** How fast the stick's reading catches up, per second. Eases the first step. */
const DRIVE_EASE = 6;
/** How fast the body turns toward where it wants to look, in radians a second. */
const TURN_RATE = 8;
/**
 * The closest the two bodies get comes from `move-combat.ts` (`CLOSE_GUARD_M`),
 * because the hit check measures range past exactly that guard and a scene that
 * seated the bodies at a different distance than the server measured from would
 * whiff blows the eye saw connect. There is no physics in here and no collision
 * to resolve — the guard is the one exception, because two creatures standing
 * inside each other is not a fight.
 */

/**
 * The dash moves' phase windows, as shares of their own timeline.
 *
 * The animation curve leans, squashes and swings — it cannot cover ground,
 * because a curve is a pure function of one number and has no idea where its
 * opponent is standing. So the metres live here, and these are the two windows
 * the body is actually translated in: it closes the gap through the first, and
 * gives a little of it back through the last. The middle is the strike, where
 * the body is committed and does not move.
 *
 * They line up with the beats in `dash_strike`'s curve on purpose: the lunge
 * runs 0.05–0.5 and the recoil starts at 0.72, so what the legs are doing
 * matches where the body is going.
 */
const DASH_WINDOW = { closeFrom: 0.05, closeTo: 0.5, recoverFrom: 0.72 } as const;
/**
 * Dash pace, in metres a second — roughly three times a walk, which is what
 * makes it read as a dash rather than a brisk stroll.
 */
const DASH_SPEED_MPS = 3.4;
/**
 * The bot's dash is slower, and deliberately so: it is the tell that gives a
 * player time to read the move coming and answer it. A bot that closed as fast
 * as the player would be unreadable rather than hard.
 */
const DASH_BOT_SPEED_MPS = 2.1;
/**
 * The most ground one dash may cover is the move's own `closesM`, read from
 * `ATTACK_PROFILE` rather than set here.
 *
 * This used to be one flat 1.4 m cap for every dash, and that number was a lie
 * the moment the server started checking range: the hit check credits a dash
 * with `reachM + closesM`, so a body that physically closed 1.4 m while the
 * server counted 0.52 m would arrive nose-to-nose and be told it whiffed. A
 * dash that covers exactly the ground the rules say it covers cannot do that.
 * A dash from too far away still lands short, which remains the right answer
 * to being out of range — it is just now the same "short" both sides measured.
 */
function dashCloseM(state: AnimationState): number {
  return ATTACK_PROFILE[state]?.closesM ?? 0;
}
/**
 * The furthest any dash in the table closes — derived, so adding a longer dash
 * moves the leashes that have to contain one without anybody remembering to.
 */
const DASH_MAX_M = Math.max(...Object.values(ATTACK_PROFILE).map((p) => p.closesM));
/**
 * How much of the dash is given back on the recoil, as a share of the ground
 * it actually closed.
 *
 * A share rather than a flat 0.3 m, because the dashes no longer all cover the
 * same distance: 0.3 m off a 1.4 m lunge was a stumble, but 0.3 m off the
 * 0.52 m a `dash_strike` really closes would hand back most of the ground the
 * move exists to take, and the lunge would read as a flinch.
 */
const DASH_RECOIL_SHARE = 0.21;
/** The recoil is a stumble backward, not a second dash. */
const DASH_RECOIL_SPEED = 0.55;

/* ------------------------------------------------------------------- impact */

/**
 * How long both bodies stop dead on a hit, in seconds, from a graze to the
 * heaviest thing in the game.
 *
 * Hitstop is the cheapest weight in animation and the most missed when it is
 * absent: without it two curves pass through each other on their own clocks
 * and a landed blow is indistinguishable from a near miss. Freezing both
 * bodies for a few frames at the moment of contact is what says they touched.
 *
 * The range is tuned for the cinematic read the player asked for — long enough
 * to be unmistakable, short of the frozen-frame stutter a fighting game uses.
 */
const HITSTOP_MIN_S = 0.045;
const HITSTOP_MAX_S = 0.14;
/** A guard eats most of the blow, so it eats most of the freeze with it. */
const HITSTOP_BLOCK_SCALE = 0.55;

/**
 * How hard a hit throws the camera, in radians at full weight.
 *
 * The camera is the player's own head, and a body being hit two metres away
 * does not move it — so this is a deliberate cinematic lie, and it is kept
 * small and fast enough to read as a flinch rather than as a fault in the
 * viewer. It decays on a spring, so the frame swings back through centre once
 * and settles instead of sliding home.
 */
const CAMERA_KICK_RAD = 0.055;
/** Positional shove, in metres, on the same scale. */
const CAMERA_KICK_M = 0.035;
/** Handheld jitter laid over the kick, in radians at full weight. */
const CAMERA_SHAKE_RAD = 0.022;
/** How fast the jitter rattles, in Hz. */
const CAMERA_SHAKE_HZ = 24;
/** How quickly the shake envelope dies away, per second. */
const CAMERA_SHAKE_DECAY = 7.5;
/** The kick's return spring: stiff and well damped, so it does not wobble. */
const CAMERA_KICK_STIFFNESS = 190;
const CAMERA_KICK_DAMPING = 17;
/**
 * A hit landing on the player's own character is felt harder than one it deals
 * — the camera belongs to the player, and taking a blow is the event that
 * should move it.
 */
const CAMERA_TAKEN_SCALE = 1.35;
const CAMERA_DEALT_SCALE = 0.72;

/**
 * How fast a struck body is thrown, in metres a second at full weight, and how
 * quickly that dies away.
 *
 * Knockback is displacement, not a pose: the animation channels can fold a
 * body around an impact but they cannot move the ground out from under it, so
 * giving real ground is the stage's job. The decay is what makes it a shove
 * rather than a slide — a little under a fifth of a second of travel.
 */
const KNOCKBACK_SPEED_MPS = 2.6;
const KNOCKBACK_DECAY = 9;
/** Caught on a guard, most of the energy goes into the block, not the feet. */
const KNOCKBACK_BLOCK_SCALE = 0.45;
/**
 * A blow thrown out of a dash shoves less than one thrown from a stance.
 *
 * Not a fudge: the attacker is still driving forward into the body it just
 * hit, so far less of the blow goes into moving that body away. It also keeps
 * a lunge honest — a full shove would give back every inch the dash just
 * closed, and a dash that ends further from its opponent than it began is not
 * a dash anybody would throw.
 */
const KNOCKBACK_DASH_SCALE = 0.45;

/**
 * How far a move reaches, and the forgiveness on the edge of that, both come
 * from `move-combat.ts` — `ATTACK_PROFILE[move].reachM`, its `closesM`, and
 * `REACH_SLACK_M`.
 *
 * There used to be a second reach table here, hand-copied, floored so that
 * nothing swung by a body reached less than 0.38 m — which meant every move
 * connected from the 1.05 m the game seats a sparring pair at, and spacing was
 * decoration. The server's table is the un-floored one: a bite reaches 0.30 m
 * and genuinely cannot touch from the seat, so closing that gap is the
 * player's job. The scene now asks the same table the hit check asks, so what
 * the eye calls a whiff and what the server calls a whiff are one answer.
 *
 * Range is still the difference between a fight and two bodies playing their
 * animations at each other: a swipe thrown from across the room has to miss,
 * and it has to look like it missed — the body commits, finds nothing, and
 * recovers.
 */

/* ----------------------------------------------------------------- footwork */

/**
 * The opponent's footwork: what it is doing with its feet between blows.
 *
 * A body that only ever plays attack curves from a fixed spot reads as a
 * training dummy no matter how good the curves are, because a fight is mostly
 * the moving around in between. So the opponent picks one of these, commits to
 * it for a beat, and picks again.
 */
type FootworkMode = "hold" | "advance" | "retreat" | "circle";
/** How long one footwork choice is committed to, in ms. */
const FOOTWORK_MIN_MS = 420;
const FOOTWORK_MAX_MS = 1_100;
/** Footwork pace, as a share of a walk. A fighter shuffles; it does not stroll. */
const FOOTWORK_SPEED = 0.55;
/** How far from its seat footwork may take the opponent. */
const FOOTWORK_LEASH_M = 0.7;
/** The band it tries to hold: close enough to threaten, far enough to swing. */
const FOOTWORK_NEAR_M = 0.75;
const FOOTWORK_FAR_M = 1.35;
/**
 * How long after the last blow footwork stops and the opponent walks back to
 * its seat.
 *
 * Footwork belongs to an exchange. Once one is over the opponent settles, so
 * the scene comes to rest in a known layout instead of the two bodies drifting
 * wherever the last shuffle left them — and so anything measuring the scene
 * has something stable to measure.
 */
const FOOTWORK_IDLE_MS = 1_800;

/** The moves that cover ground. Set-shaped because it is asked every frame. */
const DASH_STATES: ReadonlySet<string> = new Set(DASH_MOVES);

/** Whether a state is one of the dashes, and so needs the body translated. */
function isDashState(state: AnimationState): boolean {
  return DASH_STATES.has(state);
}

/**
 * One dash in flight. Held per side, because both bodies can be mid-dash at
 * once — a bot answering a player's dash with its own is a normal exchange.
 */
type DashRun = {
  /**
   * When the run was booked, on the wall clock.
   *
   * The phase is read off the wall rather than off accumulated frame deltas,
   * because the animation the dash belongs to is on the wall clock too: the
   * body has to be lunging while the pose is lunging. Accumulating deltas
   * instead puts the dash on the renderer's clock, and since a frame delta is
   * clamped so a backgrounded tab cannot fling a body across the room, a slow
   * renderer would stretch the dash past the move that owns it.
   */
  startedAt: number;
  /**
   * The stage's total frozen milliseconds at the moment the run was booked.
   *
   * Hitstop has to cost the run its moving time, same as it costs the bodies
   * theirs — a freeze in the closing window would otherwise quietly steal
   * ground, and one in the recovery window would skip the recovery, leaving
   * the lunge holding every inch it closed. Subtracting the freeze this run
   * has lived through keeps it on the wall clock without paying for the part
   * of the wall where nothing was allowed to move.
   */
  heldAtStart: number;
  /**
   * How far through the run the last frame left it, 0 to 1.
   *
   * Kept so a frame moves the body by the slice of the run it actually
   * covered rather than by its own length. A dash's closing window is a few
   * hundred milliseconds wide, and a frame can be longer than that — sampling
   * the phase at one instant per frame means a slow renderer drops the lunge
   * entirely and shows a move that closed no ground at all.
   */
  phase: number;
  durationMs: number;
  speedMps: number;
  /**
   * The ground this particular dash is allowed to cover — its move's own
   * `closesM`, captured at book time so the run cannot be re-measured against
   * a different move's number mid-flight.
   */
  closesM: number;
  /** Metres closed so far, against this run's `closesM`. */
  travelled: number;
  /** Metres given back so far, against `DASH_RECOIL_SHARE` of `travelled`. */
  recoiled: number;
};

/** Below this the stick is centred, not nudged. */
const DRIVE_DEADZONE = 0.02;
/** How long facing keeps easing after the stick is let go, in ms. */
const SETTLE_MS = 450;
/**
 * How long a character stands still in a real match before it drifts back to
 * the middle. Two players squared up should end up centred between them when
 * neither is doing anything, and a walk that ended somewhere odd should not
 * leave the fight framed off to one side for the rest of the round.
 */
const RECENTRE_AFTER_MS = 2_500;
/** And how slowly it drifts, as a share of walking pace. */
const RECENTRE_SPEED = 0.35;

/**
 * Which rule is deciding where the player's character is looking.
 *
 * Facing used to be one rule — look at your opponent — because a body that
 * could not move had nothing else to look at. Now that the stick walks it, the
 * rules compete: a character mid-stride should look where it is going, and a
 * character mid-swing should look at what it is swinging at, and the swing wins
 * for exactly as long as it lasts.
 */
type FacingMode = "idle" | "walk" | "settle";

/**
 * Whether this browser can give us a GL context at all. Checked before the
 * stage is built, because a headless or GPU-less browser throws inside the
 * renderer constructor and there is no point taking the page down with it.
 */
export function webglSupported(): boolean {
  try {
    const probe = document.createElement("canvas");
    return Boolean(
      probe.getContext("webgl2") ??
        probe.getContext("webgl") ??
        probe.getContext("experimental-webgl"),
    );
  } catch {
    return false;
  }
}

export async function probeCapabilities(): Promise<StageCapabilities> {
  const secureContext = typeof window !== "undefined" && window.isSecureContext;
  const cameraSupported = Boolean(navigator.mediaDevices?.getUserMedia);
  let xrSupported = false;
  let hitTestSupported = false;
  try {
    if (navigator.xr) {
      xrSupported = await navigator.xr.isSessionSupported("immersive-ar");
      // There is no capability query for hit-test short of asking for it, so
      // this is optimistic and corrected when the session actually opens.
      hitTestSupported = xrSupported;
    }
  } catch {
    xrSupported = false;
  }
  return { webglSupported: webglSupported(), xrSupported, hitTestSupported, cameraSupported, secureContext };
}

export class ARStage {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(70, 1, 0.05, 400);
  private roomGroup = new THREE.Group();
  private worldGroup = new THREE.Group();
  private reticle: THREE.Mesh;
  private grid: THREE.GridHelper;
  /**
   * Key / fill / rim and the shadow catcher. The key's shadow camera is kept
   * deliberately tight, so the rig is walked over the bodies every frame
   * rather than widened to cover a whole room.
   */
  private lights: LightRig;
  /** Seconds since the stage opened — `THREE.Clock` is deprecated. */
  private startedAt = performance.now();
  private raycaster = new THREE.Raycaster();

  private character: Character | null = null;
  /**
   * The training partner. A second procedural body in the same room space,
   * built by the same `createCharacter` as the player's own — there is no
   * separate bot rig, model or pipeline, only another form.
   */
  private sparring: Character | null = null;
  private stance: OpponentStance = "spar";
  /**
   * Manual facing offset, in radians, from the landscape turn stick. It rides
   * on top of whatever the character is facing rather than replacing it, so
   * letting go of the stick does not strand the body pointing at nothing.
   */
  private aimYaw = 0;
  /**
   * What the movement stick is asking for, camera-relative: `y` away from the
   * camera, `x` to its right, each -1..1. Intent only — it is integrated in
   * the render loop, so a stick held down keeps walking without the UI having
   * to tick anything.
   */
  private drive = { x: 0, y: 0 };
  /** The eased reading actually walked, so the first step accelerates. */
  private driveSmooth = { x: 0, y: 0 };
  /**
   * How much health the character has left, 0..1. Kept here as well as on the
   * body so a rebuilt mesh can be put back at the damage it had taken rather
   * than standing up pristine.
   */
  private characterHealth = 1;
  /** Where `place()` put the body. Roaming is measured from here. */
  private roamAnchor = new THREE.Vector3();
  /**
   * Where `layoutSparring` seated the opponent. The opponent is anchored, and
   * a dash is the only thing that ever moves it — so it needs somewhere to go
   * back to once the dash is done.
   */
  private partnerAnchor = new THREE.Vector3();
  /**
   * Where the opponent was *seated*, as opposed to where it currently means to
   * stand. Footwork moves the seat with the body — the opponent choosing a new
   * spot is not something to be walked back from, and `partnerOffSeatM` has to
   * keep meaning "displaced from where it wants to be" rather than "has taken
   * a step". So the leash footwork is held on is measured from here, and the
   * seat itself can only ever wander this far.
   */
  private partnerHome = new THREE.Vector3();

  /**
   * The totals of the last dash each side finished, for the checks to read,
   * each stamped with which run it was. The stamp is what tells one run's
   * totals from the run before it, so nothing reads a stale dash as the
   * current one.
   */
  private lastDashPlayer: { travelled: number; recoiled: number; run: number } | null = null;

  private lastDashPartner: { travelled: number; recoiled: number; run: number } | null = null;

  private dashRuns = { player: 0, partner: 0 };
  /** The dashes in flight, one per body. Null when nobody is dashing. */
  private dashPlayer: DashRun | null = null;
  private dashPartner: DashRun | null = null;
  private facingMode: FacingMode = "idle";
  /** When the settle ease expires, in `performance.now()` ms. */
  private settleUntil = 0;
  /**
   * While this is in the future the body is mid-move and looks at its opponent
   * no matter where it is walking.
   */
  private attackLockUntil = 0;
  /** Last frame's timestamp, for the movement step's delta. */
  private lastFrameAt = 0;
  /** When the stick last asked for anything, for the idle re-centre. */
  private lastDriveAt = 0;

  /* ----------------------------------------------------------------- impact */

  /**
   * While this is in the future the whole scene is frozen on the frame a blow
   * landed on: hitstop. Both bodies hold their pose, the walk and the dashes
   * stop mid-stride, and the camera keeps rendering — the freeze is the point,
   * so it has to be visible.
   */
  private hitstopUntil = 0;

  /**
   * Total milliseconds the stage has spent frozen in hitstop, ever. Read as a
   * difference between two moments, which is what lets anything on the wall
   * clock discount the part of it that was held.
   */
  private heldMs = 0;
  /**
   * The camera's own reaction to an impact: an angular kick on all three axes
   * with a positional shove behind it, each on a return spring, plus a decaying
   * handheld rattle. Zero at rest, so a camera that has seen no hits is
   * untouched by any of this.
   */
  private kickApplied = new THREE.Vector3();
  private kick = {
    yaw: 0,
    pitch: 0,
    roll: 0,
    yawV: 0,
    pitchV: 0,
    rollV: 0,
    push: 0,
    pushV: 0,
    shake: 0,
  };
  /**
   * Ground each body is still being thrown across, in room space, metres a
   * second. Decays to nothing; integrated in the render loop so a knockback
   * survives the frame it was dealt on and reads as travel.
   */
  private throwPlayer = new THREE.Vector3();
  private throwPartner = new THREE.Vector3();
  /** The opponent's footwork, and when it next gets to choose again. */
  private footwork: FootworkMode = "hold";
  private footworkUntil = 0;
  /** Which way round it is circling: 1 or -1. */
  private footworkTurn = 1;
  /**
   * When either body last threw a move. Footwork runs during an exchange and
   * settles once one is over, so this is what tells it the difference.
   */
  private lastActionAt = 0;
  private markers = new Map<string, MarkerObject>();
  private placed = false;
  private combatPaused = false;
  private reticleVisible = false;
  private mode: StageMode = "preview";

  private hitTestSource: XRHitTestSource | null = null;
  private session: XRSession | null = null;
  private stream: MediaStream | null = null;

  private lookYaw = 0;
  private lookPitch = RESTING_PITCH;
  private orientationQuat = new THREE.Quaternion();
  private useOrientation = false;
  private disposed = false;

  constructor(
    private canvas: HTMLCanvasElement,
    private video: HTMLVideoElement | null,
    private events: StageEvents = {},
  ) {
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      alpha: true,
      antialias: true,
      preserveDrawingBuffer: false,
    });
    this.renderer.setClearColor(0x000000, 0);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.xr.enabled = true;

    this.camera.position.set(0, 0, 0);
    this.scene.add(this.camera);
    this.scene.add(this.roomGroup, this.worldGroup);
    this.roomGroup.position.y = FLOOR_Y;
    this.worldGroup.position.y = FLOOR_Y;

    // Three-point rig with a shadow catcher, shared with the character lab so
    // a creature reads in the arena exactly as it read when it was made. The
    // key follows the bodies every frame (see `stepLighting`), which is what
    // lets its shadow camera stay tight enough for a sharp contact shadow.
    // Over a camera feed the shadow lands a little lighter than in the lab.
    this.lights = installLightRig(this.renderer, this.scene, {
      floorY: FLOOR_Y,
      shadowOpacity: 0.28,
    });

    this.reticle = buildReticle();
    this.reticle.visible = false;
    this.scene.add(this.reticle);

    this.grid = new THREE.GridHelper(40, 40, 0x2c3442, 0x1d2430);
    this.grid.position.y = FLOOR_Y;
    this.scene.add(this.grid);

    this.resize();
    window.addEventListener("resize", this.resize);
    canvas.addEventListener("pointerdown", this.onPointerDown);
    canvas.addEventListener("pointermove", this.onPointerMove);
    canvas.addEventListener("pointerup", this.onPointerUp);
    window.addEventListener("deviceorientation", this.onDeviceOrientation, true);

    this.renderer.setAnimationLoop(this.tick);
  }

  /* ------------------------------------------------------------------ modes */

  getMode() {
    return this.mode;
  }

  private setMode(mode: StageMode) {
    if (this.mode === mode) return;
    this.mode = mode;
    this.grid.visible = mode === "preview";
    this.events.onModeChange?.(mode);
  }

  /** WebXR session. Hit-test is optional so 3DoF headsets still get in. */
  async enterXR(overlayRoot?: HTMLElement | null): Promise<boolean> {
    if (!navigator.xr) {
      this.events.onError?.("This browser has no WebXR support.");
      return false;
    }
    try {
      const init: XRSessionInit = {
        requiredFeatures: ["local"],
        optionalFeatures: ["hit-test", "local-floor", "dom-overlay", "anchors"],
      };
      if (overlayRoot) {
        (init as XRSessionInit & { domOverlay?: { root: HTMLElement } }).domOverlay = {
          root: overlayRoot,
        };
      }
      const session = await navigator.xr.requestSession("immersive-ar", init);
      this.session = session;
      this.renderer.xr.setReferenceSpaceType("local-floor");
      await this.renderer.xr.setSession(session);

      // Hit-test is a request, not an assumption: XREAL-class glasses will
      // reject it and we carry on with fixed-distance placement.
      try {
        const viewerSpace = await session.requestReferenceSpace("viewer");
        this.hitTestSource = (await session.requestHitTestSource?.({ space: viewerSpace })) ?? null;
      } catch {
        this.hitTestSource = null;
      }

      session.addEventListener("select", this.onXRSelect);
      session.addEventListener("end", () => {
        this.hitTestSource = null;
        this.session = null;
        this.reticle.visible = false;
        this.emitReticle(false);
        this.setMode(this.stream ? "camera" : "preview");
      });

      // In XR the headset owns the pose; our own look controls step aside, and
      // the floor groups sit at true floor level rather than eye-relative.
      this.roomGroup.position.y = 0;
      this.worldGroup.position.y = 0;
      this.setMode("xr");
      return true;
    } catch (error) {
      this.events.onError?.(error instanceof Error ? error.message : "Could not start AR.");
      return false;
    }
  }

  exitXR() {
    void this.session?.end();
  }

  hasHitTest() {
    return this.hitTestSource !== null;
  }

  /** Camera passthrough without WebXR — the iOS and no-WebXR path. */
  async startCamera(): Promise<boolean> {
    if (!this.video || !navigator.mediaDevices?.getUserMedia) {
      this.events.onError?.("No camera available on this device.");
      return false;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: "environment" }, width: { ideal: 1280 } },
        audio: false,
      });
      this.stream = stream;
      this.video.srcObject = stream;
      await this.video.play().catch(() => {});
      this.roomGroup.position.y = FLOOR_Y;
      this.worldGroup.position.y = FLOOR_Y;
      this.setMode("camera");
      return true;
    } catch (error) {
      this.events.onError?.(
        error instanceof Error && error.name === "NotAllowedError"
          ? "Camera permission was declined."
          : "Could not open the camera.",
      );
      return false;
    }
  }

  stopCamera() {
    for (const track of this.stream?.getTracks() ?? []) track.stop();
    this.stream = null;
    if (this.video) this.video.srcObject = null;
    if (this.mode === "camera") this.setMode("preview");
  }

  /* ------------------------------------------------------------- scene data */

  setCharacter(config: CharacterConfig | null) {
    // Where the outgoing body was standing. A swap keeps the ground the player
    // is holding: the character is the player's position in this fight, and
    // handing it back to the scene origin would give away the reach they walked
    // in for — and read as the body teleporting out of the exchange.
    const standing = this.character
      ? {
          position: this.character.group.position.clone(),
          yaw: this.character.group.rotation.y,
        }
      : null;
    if (this.character) {
      this.roomGroup.remove(this.character.group);
      this.character.dispose();
      this.character = null;
    }
    if (!config) {
      this.placed = false;
      this.events.onPlaced?.(false);
      return;
    }
    this.character = createCharacter(config);
    // A new body starts standing still, whatever the last one was doing.
    this.resetDrive();
    if (standing && this.placed) {
      this.character.group.position.copy(standing.position);
      this.character.group.rotation.y = standing.yaw;
    }
    // A fresh mesh is built at full health, so the damage already taken has to
    // go back on it or a swap would look like a heal.
    this.character.setHealth(this.characterHealth);
    this.character.group.visible = this.placed;
    this.roomGroup.add(this.character.group);
    // The partner stands relative to the character, so a rebuilt character
    // re-seats it rather than leaving it squared up against nothing.
    this.layoutSparring();
  }

  /**
   * Put a training partner next to the placed character, or clear it.
   *
   * Nothing about this body is special: same procedural mesh, same animation
   * channels, same move list. It only differs in who drives it — a local timer
   * instead of the match feed — and in that nothing it does resolves.
   */
  setSparringPartner(config: CharacterConfig | null) {
    if (this.sparring) {
      this.roomGroup.remove(this.sparring.group);
      this.sparring.dispose();
      this.sparring = null;
    }
    if (!config) {
      // Nobody to square up against any more: turn the character back to the
      // player rather than leaving it staring at where the partner stood.
      this.layoutSparring();
      return;
    }
    this.sparring = createCharacter(config);
    this.roomGroup.add(this.sparring.group);
    this.layoutSparring();
  }

  playSparringAnimation(state: AnimationState) {
    if (!this.sparring) return;
    this.sparring.play(state);
    // Taking a hit gets the red flash and the twitch on top of the reaction:
    // the flash is the damage, the flinch is the body registering it, and the
    // flinch lands even when the reaction itself was refused because a longer
    // move was still finishing.
    if (state === "hit_react") {
      this.sparring.flash(0xff3b30);
      this.sparring.flinch();
    }
    // An exchange is live, which is what the opponent's footwork waits for: it
    // shuffles between blows and stands still when there are none.
    this.lastActionAt = performance.now();
    // The bot dashes with the same machinery the player does, only slower, and
    // from its seat rather than from a roamed position.
    if (isDashState(state)) {
      this.dashPartner = this.startDash(state, DASH_BOT_SPEED_MPS);
    }
    // Every move ends with both bodies looking at each other again.
    this.faceCombatants();
  }

  saySparringLine(text: string, ttl?: number) {
    this.sparring?.say(text, ttl);
  }

  /**
   * Which framing the second character stands in. Setting it re-seats them
   * immediately, so switching from a spar into a fight squares the two bodies
   * up without waiting for the next move.
   */
  setOpponentStance(stance: OpponentStance) {
    if (this.stance === stance) return;
    this.stance = stance;
    this.layoutSparring();
  }

  /**
   * Seat the second character relative to the player's, then square them up.
   *
   * Placement of the *player's* character is not this method's business — that
   * is `place()`, and it is left exactly as it is. This only decides where the
   * other body stands and which way each of them looks.
   */
  private layoutSparring() {
    const partner = this.sparring;
    if (!partner) {
      // Nobody to square up against: the character goes back to facing the
      // player, which is what it does when it is standing on its own.
      this.faceCombatants();
      return;
    }
    const anchor = this.character;
    if (!anchor || !this.placed) {
      partner.group.visible = false;
      return;
    }

    const base = anchor.group.position;
    const right = new THREE.Vector3(1, 0, 0).applyQuaternion(this.camera.quaternion);
    right.y = 0;
    if (right.lengthSq() < 1e-4) right.set(1, 0, 0);
    right.normalize();
    const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(this.camera.quaternion);
    forward.y = 0;
    if (forward.lengthSq() < 1e-4) forward.set(0, 0, -1);
    forward.normalize();

    if (this.stance === "duel") {
      // Straight across, and inside striking distance. A spar's end-to-end gap
      // framed the two bodies nicely and sat outside the reach of all but the
      // longest moves, so a fight opened with most of the pad refusing — the
      // player had to walk in before the round could start. A duel seats at
      // `DUEL_GAP_M` instead: the short jabs still want a step in, everything
      // else can be thrown from where the fight begins.
      partner.group.position.set(
        base.x + forward.x * DUEL_GAP_M,
        base.y,
        base.z + forward.z * DUEL_GAP_M,
      );
    } else {
      partner.group.position.set(
        base.x + right.x * SPAR_SIDE_M + forward.x * SPAR_DEPTH_M,
        base.y,
        base.z + right.z * SPAR_SIDE_M + forward.z * SPAR_DEPTH_M,
      );
    }
    partner.group.visible = true;
    // Re-seating is also the opponent's new home: a dash that was in flight
    // when the stance changed has nothing left to return to.
    this.partnerAnchor.copy(partner.group.position);
    this.partnerHome.copy(partner.group.position);
    this.footwork = "hold";
    this.footworkUntil = 0;
    this.throwPartner.set(0, 0, 0);
    this.dashPartner = null;
    this.faceCombatants();
  }

  /**
   * Turn both characters to look at each other — and, with nobody to look at,
   * turn the player's character back to the camera.
   *
   * Facing is a separate step from standing somewhere on purpose. Placement
   * happens once, when the player drops their character on the floor; facing
   * has to happen again after every move, because a procedural animation can
   * leave a body having lurched a few degrees off its opponent and two
   * creatures fighting past each other is the one thing that breaks the shot.
   */
  private faceCombatants(snapPartner = true) {
    const anchor = this.character;
    if (!anchor) return;
    anchor.group.rotation.y = this.desiredYaw();
    // Only when facing changed because something happened. Called from a
    // per-frame path the opponent is left to `stepPartnerFacing`, which turns
    // it at a rate instead of pointing it.
    if (snapPartner) this.facePartnerBack();
  }

  /**
   * The yaw the player's character wants to be at right now.
   *
   * One function, three rules, in priority order. Mid-swing it looks at its
   * opponent — that is the lock-on, and it holds for the length of the move
   * whatever the stick is doing. Walking, it looks where it is walking.
   * Otherwise it is squared up: at its opponent if it has one, at the player if
   * it does not.
   *
   * Positions are read in room space for both bodies and in world space for the
   * camera, and `roomGroup` only ever translates — so a yaw computed in either
   * space is the same yaw.
   */
  private desiredYaw(): number {
    const anchor = this.character!;
    const partner = this.sparring;
    const squaredUp = Boolean(partner && this.placed && partner.group.visible);
    const locked = performance.now() < this.attackLockUntil;

    if (!locked && this.facingMode !== "idle" && this.walking()) {
      return this.walkYaw + this.aimYaw;
    }
    if (squaredUp) {
      const here = anchor.group.position;
      const there = partner!.group.position;
      return Math.atan2(there.x - here.x, there.z - here.z) + this.aimYaw;
    }
    const toCamera = this.camera.position
      .clone()
      .sub(anchor.group.getWorldPosition(new THREE.Vector3()));
    return Math.atan2(toCamera.x, toCamera.z) + this.aimYaw;
  }

  /** The heading the last movement step walked in. */
  private walkYaw = 0;

  /** Whether there is real movement intent, past the stick's deadzone. */
  private walking(): boolean {
    return Math.hypot(this.driveSmooth.x, this.driveSmooth.y) >= DRIVE_DEADZONE;
  }

  /** The opponent always looks back. It is anchored, so this is all it does. */
  private facePartnerBack() {
    const anchor = this.character;
    const partner = this.sparring;
    if (!anchor || !partner || !this.placed || !partner.group.visible) return;
    const here = anchor.group.position;
    const there = partner.group.position;
    partner.group.rotation.y = Math.atan2(here.x - there.x, here.z - there.z);
  }

  /**
   * Walk the character, from whatever the stick is asking for.
   *
   * The body moves, the rig does not: animation drives `rig`, which hangs off
   * `group`, so translating `group` walks the character without touching a
   * single move curve — and the ground ring, health bar and speech bubble stay
   * planted under its feet because they hang off `group` too.
   *
   * No physics and no collisions, by design. What there is instead: a cap on
   * pace, a radius around where the character was placed so it cannot walk out
   * of frame, and a minimum gap from the opponent so the two bodies cannot
   * occupy the same spot. The opponent never moves — it is anchored where
   * `layoutSparring` seated it.
   */
  private stepMovement(dt: number) {
    const body = this.character;
    if (!body || !this.placed) return;
    const now = performance.now();

    // Ease toward the stick, so a thumb slammed to the rim accelerates into a
    // walk instead of teleporting a step.
    const k = Math.min(1, dt * DRIVE_EASE);
    this.driveSmooth.x += (this.drive.x - this.driveSmooth.x) * k;
    this.driveSmooth.y += (this.drive.y - this.driveSmooth.y) * k;

    if (Math.hypot(this.drive.x, this.drive.y) >= DRIVE_DEADZONE) this.lastDriveAt = now;

    if (!this.walking()) {
      // Let go: ease the facing back to squared-up rather than snapping, then
      // hand facing back to the normal rule.
      if (this.facingMode === "walk") {
        this.facingMode = "settle";
        this.settleUntil = now + SETTLE_MS;
      } else if (this.facingMode === "settle" && now >= this.settleUntil) {
        this.facingMode = "idle";
        this.faceCombatants();
      }
      this.recentre(dt, now);
      return;
    }

    // Camera-relative basis: pushing the stick away from you walks the body
    // away from you, whichever way the phone is pointing.
    const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(this.camera.quaternion);
    forward.y = 0;
    if (forward.lengthSq() < 1e-4) forward.set(0, 0, -1);
    forward.normalize();
    const right = new THREE.Vector3(1, 0, 0).applyQuaternion(this.camera.quaternion);
    right.y = 0;
    if (right.lengthSq() < 1e-4) right.set(1, 0, 0);
    right.normalize();

    const direction = new THREE.Vector3(
      forward.x * this.driveSmooth.y + right.x * this.driveSmooth.x,
      0,
      forward.z * this.driveSmooth.y + right.z * this.driveSmooth.x,
    );
    if (direction.lengthSq() < 1e-6) return;
    const throttle = Math.min(1, Math.hypot(this.driveSmooth.x, this.driveSmooth.y));
    direction.normalize();

    const next = body.group.position
      .clone()
      .addScaledVector(direction, throttle * MOVE_SPEED_MPS * dt);
    this.clampRoam(next);
    body.group.position.x = next.x;
    body.group.position.z = next.z;

    this.walkYaw = Math.atan2(direction.x, direction.z);
    this.facingMode = "walk";
  }

  /**
   * Cover the ground a dash promises.
   *
   * This is the half of a dash strike that an animation curve cannot do. The
   * curve leans the body and swings the arm; this walks the whole body at its
   * opponent through the move's closing window, holds it still for the strike,
   * and stumbles it back through the recovery — then squares both bodies up
   * again, because a move that ends with the two of them facing past each other
   * is the one failure that still looks almost right.
   *
   * Runs off the clock rather than off the animation, so it stays in step with
   * a move whose reaction was refused by priority, and stops on its own when
   * the move's own duration is up.
   */
  private stepDash(dt: number) {
    if (!this.dashPlayer && !this.dashPartner) {
      this.returnPartner(dt);
      return;
    }
    // Both, always — `||` would short-circuit the second body out of its own
    // dash on any frame the first one moved.
    const playerMoved = this.advanceDash("player");
    const partnerMoved = this.advanceDash("partner");
    const moved = playerMoved || partnerMoved;
    // One of them moved, so neither is looking at the right place any more.
    if (moved) this.faceCombatants(false);
    if (!this.dashPartner) this.returnPartner(dt);
  }

  /**
   * Walk one body through one frame of its dash. Returns whether it actually
   * moved, so facing is only recomputed when something changed.
   *
   * The frame is charged for the part of the run it spanned, not for its own
   * length: a body covers the ground its move says it covers whether that
   * took the renderer three frames or thirty.
   */
  private advanceDash(side: "player" | "partner"): boolean {
    const run = side === "player" ? this.dashPlayer : this.dashPartner;
    if (!run) return false;

    const mover = side === "player" ? this.character : this.sparring;
    const target = side === "player" ? this.sparring : this.character;
    const clear = () => {
      // The numbers outlive the run. What a dash covered and gave back is only
      // true once it is over, and a run that is over has no telemetry left to
      // read — so the last one's totals stay readable in `facingProbe`.
      if (side === "player") {
        this.dashPlayer = null;
        this.dashRuns.player += 1;
        this.lastDashPlayer = {
          travelled: run.travelled,
          recoiled: run.recoiled,
          run: this.dashRuns.player,
        };
      } else {
        this.dashPartner = null;
        this.dashRuns.partner += 1;
        this.lastDashPartner = {
          travelled: run.travelled,
          recoiled: run.recoiled,
          run: this.dashRuns.partner,
        };
      }
    };

    // Nothing to dash at, or nothing placed to dash with: drop the run rather
    // than leaving it to expire, so the body never lurches later.
    if (!mover || !target || !this.placed || !mover.group.visible || !target.group.visible) {
      clear();
      return false;
    }

    const held = this.heldMs - run.heldAtStart;
    const t = Math.min(1, (performance.now() - run.startedAt - held) / run.durationMs);
    const from = run.phase;
    run.phase = t;
    const ended = t >= 1;
    /** Seconds of this frame that fell inside the window `a`..`b` of the run. */
    const inside = (a: number, b: number) =>
      (Math.max(0, Math.min(t, b) - Math.max(from, a)) * run.durationMs) / 1_000;
    // One frame can span both windows — on a slow renderer it can span the
    // whole run — so they are added, not chosen between.
    const closing = inside(DASH_WINDOW.closeFrom, DASH_WINDOW.closeTo);
    const recovering = inside(DASH_WINDOW.recoverFrom, 1);

    const toTarget = target.group.position.clone().sub(mover.group.position);
    toTarget.y = 0;
    const gap = toTarget.length();
    if (gap < 1e-4) {
      if (ended) clear();
      return false;
    }
    toTarget.divideScalar(gap);

    let step = 0;
    if (closing > 0) {
      // Closing. Capped three ways: pace, the per-dash distance cap, and what
      // is left of the gap before the two bodies would be inside each other.
      const close = Math.min(
        run.speedMps * closing,
        Math.max(0, run.closesM - run.travelled),
        Math.max(0, gap - CLOSE_GUARD_M),
      );
      run.travelled += close;
      step += close;
    }
    if (recovering > 0) {
      // Recovering: give back a little of what was closed, never more than was
      // closed in the first place, so a dash that landed short does not end up
      // further away than it started.
      const back = Math.min(
        run.speedMps * DASH_RECOIL_SPEED * recovering,
        Math.max(0, run.travelled * DASH_RECOIL_SHARE - run.recoiled),
      );
      run.recoiled += back;
      step -= back;
    }
    if (ended) clear();
    if (Math.abs(step) < 1e-6) return false;

    const next = mover.group.position.clone().addScaledVector(toTarget, step);
    // The player's dash obeys the same frame and the same guard its walk does.
    // The opponent's is bounded by the cap and the guard alone, because it is
    // dashing from its seat and has nowhere to roam out of.
    if (side === "player") this.clampRoam(next);
    else this.clampPartnerDash(next);
    mover.group.position.x = next.x;
    mover.group.position.z = next.z;
    return true;
  }

  /**
   * Keep a dashing opponent off the player and inside its own leash. Same
   * shape as `clampRoam`, measured from the seat `layoutSparring` gave it.
   */
  private clampPartnerDash(next: THREE.Vector3) {
    const offset = next.clone().sub(this.partnerAnchor);
    offset.y = 0;
    if (offset.length() > DASH_MAX_M) {
      offset.setLength(DASH_MAX_M);
      next.x = this.partnerAnchor.x + offset.x;
      next.z = this.partnerAnchor.z + offset.z;
    }
    const body = this.character;
    if (!body || !this.placed) return;
    const away = next.clone().sub(body.group.position);
    away.y = 0;
    if (away.length() >= CLOSE_GUARD_M) return;
    if (away.lengthSq() < 1e-6) away.set(0, 0, 1);
    away.setLength(CLOSE_GUARD_M);
    next.x = body.group.position.x + away.x;
    next.z = body.group.position.z + away.z;
  }

  /**
   * Walk the opponent back to its seat between dashes.
   *
   * The opponent is anchored — that is what lets the rest of the scene assume
   * it is standing still — so whatever ground a dash left it holding is given
   * back at a stroll, and a spar of twenty dashes ends with it where it began
   * rather than pressed against the player.
   */
  private returnPartner(dt: number) {
    const partner = this.sparring;
    if (!partner || !this.placed || !partner.group.visible) return;
    const back = this.partnerAnchor.clone().sub(partner.group.position);
    back.y = 0;
    const distance = back.length();
    if (distance < 0.02) return;
    const step = Math.min(distance, MOVE_SPEED_MPS * RECENTRE_SPEED * dt);
    back.setLength(step);
    partner.group.position.x += back.x;
    partner.group.position.z += back.z;
  }

  /**
   * Keep a walked position in shot and out of the opponent. Mutates in place;
   * height is never touched, because the floor is the floor.
   */
  private clampRoam(next: THREE.Vector3) {
    const offset = next.clone().sub(this.roamAnchor);
    offset.y = 0;
    if (offset.length() > ROAM_RADIUS_M) {
      offset.setLength(ROAM_RADIUS_M);
      next.x = this.roamAnchor.x + offset.x;
      next.z = this.roamAnchor.z + offset.z;
    }

    const partner = this.sparring;
    if (!partner || !partner.group.visible) return;
    const away = next.clone().sub(partner.group.position);
    away.y = 0;
    if (away.length() >= CLOSE_GUARD_M) return;
    if (away.lengthSq() < 1e-6) away.set(0, 0, 1);
    away.setLength(CLOSE_GUARD_M);
    next.x = partner.group.position.x + away.x;
    next.z = partner.group.position.z + away.z;
  }

  /**
   * Drift a standing character back to where it was placed.
   *
   * Only in a real match, and only after it has been still for a while: two
   * players squared up should be centred between them when neither is doing
   * anything, and a walk that ended off to one side should not leave the rest
   * of the round framed badly. Slow enough to read as the character settling
   * rather than as the stick being taken away from the player.
   */
  private recentre(dt: number, now: number) {
    if (this.stance !== "duel") return;
    const body = this.character;
    if (!body || !this.placed) return;
    // Not while the fight is live. Drifting back to the placement anchor is a
    // framing courtesy for a lull, and handing back the ground the player just
    // walked in for — mid-exchange, while a blow is in the air — is the scene
    // taking the reach off them a second after they earned it.
    if (now - Math.max(this.lastDriveAt, this.lastActionAt) < RECENTRE_AFTER_MS) return;
    const offset = this.roamAnchor.clone().sub(body.group.position);
    offset.y = 0;
    const distance = offset.length();
    if (distance < 0.02) return;
    const step = Math.min(distance, MOVE_SPEED_MPS * RECENTRE_SPEED * dt);
    offset.setLength(step);
    body.group.position.x += offset.x;
    body.group.position.z += offset.z;
    this.faceCombatants(false);
  }

  /**
   * Turn the body toward the yaw it wants, at a turn rate rather than in one
   * frame. Snapping is fine when facing changes because something happened —
   * a move, a re-seat — but a character pivoting on the spot as the stick
   * sweeps around has to be watchable.
   */
  private stepFacing(dt: number) {
    const body = this.character;
    if (!body) return;
    const target = this.desiredYaw();
    const current = body.group.rotation.y;
    const delta = Math.atan2(Math.sin(target - current), Math.cos(target - current));
    const limit = TURN_RATE * dt;
    body.group.rotation.y = current + Math.max(-limit, Math.min(limit, delta));
  }

  /**
   * Turn the opponent toward the player over time, rather than in one frame.
   *
   * The opponent used to be the one body that always snapped: it was anchored,
   * so pointing it at the player was a single assignment and nothing ever moved
   * enough for that to show. Now that it dashes, shuffles and gets knocked
   * about, an instant pivot is the most mechanical thing left in the scene —
   * so it turns at the same rate the player's body does.
   *
   * Ran unconditionally, unlike the player's, because the opponent has no stick
   * and nothing else competing for where it looks.
   */
  private stepPartnerFacing(dt: number) {
    const anchor = this.character;
    const partner = this.sparring;
    if (!anchor || !partner || !this.placed || !partner.group.visible) return;
    const here = anchor.group.position;
    const there = partner.group.position;
    const target = Math.atan2(here.x - there.x, here.z - there.z);
    const current = partner.group.rotation.y;
    const delta = Math.atan2(Math.sin(target - current), Math.cos(target - current));
    const limit = TURN_RATE * dt;
    partner.group.rotation.y = current + Math.max(-limit, Math.min(limit, delta));
  }

  /* ----------------------------------------------------------------- impact */

  /**
   * How far past the close guard a given move can actually touch: what it
   * swings, plus the ground it eats on the way in.
   *
   * Both numbers are the hit check's own, so the scene and the server agree on
   * what a dash buys. A state that is not an attack — a guard, a hit reaction,
   * a celebration — reaches nothing, because nothing about it is a blow.
   */
  private reach(state: AnimationState): number {
    const profile = ATTACK_PROFILE[state];
    if (!profile) return 0;
    return profile.reachM + profile.closesM;
  }

  /** Metres between the two bodies on the floor, or null with nobody to fight. */
  private gapBetween(): number | null {
    const anchor = this.character;
    const partner = this.sparring;
    if (!anchor || !partner || !this.placed || !partner.group.visible) return null;
    return Math.hypot(
      anchor.group.position.x - partner.group.position.x,
      anchor.group.position.z - partner.group.position.z,
    );
  }

  /**
   * The floor gap, for the request that reports it.
   *
   * Public because both sides of an exchange send their own reading and the
   * server takes the larger of the two — the honest one, since a client that
   * under-reports its distance is claiming a hit it did not close for.
   */
  gapM(): number | null {
    return this.gapBetween();
  }

  /**
   * How much room this body has behind it, in metres, before it runs out of
   * floor it is allowed to stand on.
   *
   * Measured straight back along the line away from the opponent, because that
   * is the direction a blow shoves it: ray from where it stands to where the
   * roam clamp stops it. A body in the middle of its space has metres to give
   * ground with and sheds part of every hit into that ground; one that has
   * backed itself to the edge of the frame has nothing left to give and eats
   * the difference, which is `corneredMultiplier` on the server.
   *
   * The roam radius is the bound rather than the detected plane because it is
   * the bound that actually holds the body — the clamp that keeps the fight in
   * shot is the wall the player can back into.
   */
  spaceBehindM(): number | null {
    const body = this.character;
    if (!body || !this.placed) return null;
    const here = new THREE.Vector3(body.group.position.x, 0, body.group.position.z);
    const partner = this.sparring;
    // Away from the opponent. With nobody to back away from, the honest answer
    // is the room in the worst direction there is: the nearest edge.
    const back = new THREE.Vector3();
    if (partner && partner.group.visible) {
      back.set(here.x - partner.group.position.x, 0, here.z - partner.group.position.z);
    }
    const offset = here.clone().sub(new THREE.Vector3(this.roamAnchor.x, 0, this.roamAnchor.z));
    if (back.lengthSq() < 1e-6) return Math.max(0, ROAM_RADIUS_M - offset.length());
    back.normalize();
    // Ray/circle: how far along `back` before |offset + t·back| = ROAM_RADIUS_M.
    // The ray starts inside the circle, so the positive root always exists.
    const b = offset.dot(back);
    const c = offset.lengthSq() - ROAM_RADIUS_M * ROAM_RADIUS_M;
    const disc = Math.max(0, b * b - c);
    return Math.max(0, -b + Math.sqrt(disc));
  }

  /** Whether this body is backed against the edge of its own space. */
  cornered(): boolean {
    const space = this.spaceBehindM();
    return space !== null && space <= CORNERED_SPACE_M;
  }

  /**
   * Whether a move thrown right now is close enough to touch anything.
   *
   * Public because the pads read it to tell the player a swing will find air
   * before they throw it, which is the difference between a miss that feels
   * like distance and one that feels like a bug. It runs the server's own
   * `inReach`, not a restatement of it, so the pad cannot promise a hit the
   * hit check will refuse.
   */
  inReach(state: AnimationState): boolean {
    if (!ATTACK_PROFILE[state]) return false;
    const gap = this.gapBetween();
    // The server reads an unknown gap as "do not punish what you cannot
    // measure". The scene reads it as nothing to hit, because with no placed
    // body and no visible opponent there is not one.
    if (gap === null) return false;
    return profileInReach({ move: state, gapM: gap });
  }

  /**
   * Land a blow, visually.
   *
   * The one entry point for everything an impact does to the scene: the freeze,
   * the reel, the ground given, the camera. It decides none of the combat —
   * `blocked` and, for a real match, whether there was a hit at all, are the
   * server's calls and arrive here already made. What this owns is what the
   * player *sees* of a decision already taken.
   *
   * Returns what it rendered, because the caller has a sound to pick and the
   * three outcomes need three different ones.
   */
  registerImpact(hit: {
    /** Which body threw it. */
    from: "player" | "partner";
    /** The move thrown, for its strike weight. */
    state: AnimationState;
    /** Whether the struck body caught it on a guard. The server's call. */
    blocked?: boolean;
    /**
     * Whether contact is already decided elsewhere.
     *
     * A real match is resolved on the server and arrives here settled: the blow
     * landed, and range is not allowed to overrule that — a hit the server
     * counted must never render as a miss. Training has no server in the loop
     * and nothing is riding on it, so there range does decide, and a swing
     * thrown from too far away genuinely finds air.
     */
    resolved?: boolean;
  }): { landed: boolean; blocked: boolean; whiffed: boolean; weight: number; gapM: number | null } {
    const attacker = hit.from === "player" ? this.character : this.sparring;
    const struck = hit.from === "player" ? this.sparring : this.character;
    const gap = this.gapBetween();
    const weight = strikeWeight(hit.state);
    const blocked = hit.blocked === true;
    this.lastActionAt = performance.now();

    if (!attacker || !struck || weight <= 0) {
      return { landed: false, blocked: false, whiffed: false, weight: 0, gapM: gap };
    }

    // Out of range and nobody has said otherwise: the swing finds air. The
    // attacker still committed to it, so it pays for that — the body carries
    // through further than it meant to and has to recover, which is what a
    // whiff looks like from the outside.
    if (!hit.resolved && !this.inReach(hit.state)) {
      attacker.reel({ fromX: 0, fromZ: -1, weight: weight * 0.3 });
      return { landed: false, blocked: false, whiffed: true, weight, gapM: gap };
    }

    // Which way the blow arrived, in the struck body's own local space — the
    // channels it will be written into are local axes, so the direction has to
    // be too. World yaw out, body yaw off, and what is left is the bearing of
    // the attacker as the struck body experiences it.
    const dx = attacker.group.position.x - struck.group.position.x;
    const dz = attacker.group.position.z - struck.group.position.z;
    const bearing = Math.atan2(dx, dz) - struck.group.rotation.y;
    const fromX = Math.sin(bearing);
    const fromZ = Math.cos(bearing);

    struck.reel({ fromX, fromZ, weight, blocked });
    if (!blocked) struck.flash(0xff3b30);

    // Both bodies freeze, not just the one that was hit: a blow that stops its
    // target and not the fist that threw it reads as the target flinching at
    // nothing. This is the whole of hitstop.
    const freeze =
      (HITSTOP_MIN_S + (HITSTOP_MAX_S - HITSTOP_MIN_S) * weight) *
      (blocked ? HITSTOP_BLOCK_SCALE : 1);
    attacker.hold(freeze);
    struck.hold(freeze);
    this.hitstopUntil = Math.max(this.hitstopUntil, performance.now() + freeze * 1_000);

    // Ground given, away from the blow. In room space this time, because this
    // is the body actually travelling rather than the pose it travels in.
    const away = new THREE.Vector3(-dx, 0, -dz);
    if (away.lengthSq() < 1e-6) away.set(0, 0, 1);
    const charging = hit.from === "player" ? this.dashPlayer : this.dashPartner;
    away.setLength(
      KNOCKBACK_SPEED_MPS *
        weight *
        (blocked ? KNOCKBACK_BLOCK_SCALE : 1) *
        (charging ? KNOCKBACK_DASH_SCALE : 1),
    );
    if (hit.from === "player") this.throwPartner.copy(away);
    else this.throwPlayer.copy(away);

    this.kickCamera(weight, hit.from === "partner", blocked);
    return { landed: true, blocked, whiffed: false, weight, gapM: gap };
  }

  /**
   * Throw the camera. `taken` is whether it was the player's own character on
   * the receiving end, which is felt harder than a blow it dealt.
   *
   * The direction is deliberately arbitrary per hit rather than derived from
   * where the blow came from: the camera is a held phone, not a body in the
   * fight, and a kick that consistently tracked the geometry would read as the
   * viewer being hit instead of as the viewer reacting.
   */
  private kickCamera(weight: number, taken: boolean, blocked: boolean) {
    const scale =
      weight * (taken ? CAMERA_TAKEN_SCALE : CAMERA_DEALT_SCALE) * (blocked ? 0.6 : 1);
    const spin = Math.random() < 0.5 ? -1 : 1;
    // Mostly pitch — a hit drops the frame — with a lesser yaw and roll so the
    // kick is never twice the same shape.
    this.kick.pitchV += CAMERA_KICK_RAD * scale * 26 * (0.7 + Math.random() * 0.5);
    this.kick.yawV += CAMERA_KICK_RAD * scale * 12 * spin * (0.4 + Math.random() * 0.7);
    this.kick.rollV += CAMERA_KICK_RAD * scale * 15 * -spin * (0.4 + Math.random() * 0.7);
    this.kick.pushV += CAMERA_KICK_M * scale * 24;
    this.kick.shake = Math.min(1, this.kick.shake + scale);
  }

  /**
   * Integrate the camera's kick back to rest, and the handheld rattle down to
   * nothing. Both run on wall time through hitstop — the freeze holds the
   * bodies, and a camera that froze with them would turn an impact into a
   * dropped frame instead of a hit.
   */
  private stepCamera(dt: number) {
    const k = this.kick;
    // Fixed sub-steps: the spring is stiff enough that one 100ms frame
    // integrated whole is unstable, and a dropped frame must not be able to
    // fling the camera.
    const steps = Math.max(1, Math.min(8, Math.ceil(dt / (1 / 120))));
    const step = dt / steps;
    for (let n = 0; n < steps; n += 1) {
      k.pitchV += (-k.pitch * CAMERA_KICK_STIFFNESS - k.pitchV * CAMERA_KICK_DAMPING) * step;
      k.yawV += (-k.yaw * CAMERA_KICK_STIFFNESS - k.yawV * CAMERA_KICK_DAMPING) * step;
      k.rollV += (-k.roll * CAMERA_KICK_STIFFNESS - k.rollV * CAMERA_KICK_DAMPING) * step;
      k.pushV += (-k.push * CAMERA_KICK_STIFFNESS - k.pushV * CAMERA_KICK_DAMPING) * step;
      k.pitch += k.pitchV * step;
      k.yaw += k.yawV * step;
      k.roll += k.rollV * step;
      k.push += k.pushV * step;
    }
    k.shake = Math.max(0, k.shake - CAMERA_SHAKE_DECAY * dt * k.shake);
    if (!Number.isFinite(k.pitch) || !Number.isFinite(k.yaw) || !Number.isFinite(k.roll)) {
      this.kick = {
        yaw: 0,
        pitch: 0,
        roll: 0,
        yawV: 0,
        pitchV: 0,
        rollV: 0,
        push: 0,
        pushV: 0,
        shake: 0,
      };
    }
  }

  /**
   * Lay the kick over whatever is already aiming the camera.
   *
   * Applied as a local rotation on top of the pose, never mixed into
   * `lookYaw`/`lookPitch`: the player's own aim has to come back exactly where
   * they left it once the kick decays, and in XR the pose belongs to the
   * headset and is not ours to edit at all — which is why the whole thing is
   * skipped there rather than fought with.
   */
  private applyCameraKick(elapsed: number) {
    // Whatever last frame's shove added comes back off first. The rotation can
    // be multiplied on freely — the pose is rebuilt from the look angles every
    // frame, so it carries nothing over — but the position is set once when the
    // view is built, and a shove added to it every frame and never taken off
    // would walk the camera out of the room.
    this.camera.position.sub(this.kickApplied);
    this.kickApplied.set(0, 0, 0);
    if (this.mode === "xr") return;
    const k = this.kick;
    const rattle = k.shake * CAMERA_SHAKE_RAD;
    // Two frequencies an octave and a bit apart, so the rattle never falls into
    // a hum the eye can follow.
    const jitterX = rattle * Math.sin(elapsed * CAMERA_SHAKE_HZ * Math.PI * 2);
    const jitterY = rattle * Math.sin(elapsed * CAMERA_SHAKE_HZ * 2.7 * Math.PI * 2 + 1.1);
    if (Math.abs(k.pitch) + Math.abs(k.yaw) + Math.abs(k.roll) + rattle < 1e-5) return;
    KICK_EULER.set(k.pitch + jitterX, k.yaw + jitterY, k.roll, "YXZ");
    KICK_QUAT.setFromEuler(KICK_EULER);
    this.camera.quaternion.multiply(KICK_QUAT);
    // A shove along the camera's own forward axis: the frame lurches at the
    // impact rather than only tilting at it.
    if (Math.abs(k.push) > 1e-5) {
      KICK_VEC.set(0, 0, 1).applyQuaternion(this.camera.quaternion).multiplyScalar(k.push);
      this.kickApplied.copy(KICK_VEC);
      this.camera.position.add(this.kickApplied);
    }
  }

  /**
   * Walk both bodies along whatever knockback they are still carrying, then
   * decay it. Each is clamped by the same rules its walk is: the shove can
   * give real ground but it cannot push a body out of frame, through its
   * opponent, or off its leash.
   */
  private stepKnockback(dt: number) {
    const move = (body: Character | null, velocity: THREE.Vector3, side: "player" | "partner") => {
      if (velocity.lengthSq() < 1e-6) {
        velocity.set(0, 0, 0);
        return false;
      }
      if (!body || !this.placed || !body.group.visible) {
        velocity.set(0, 0, 0);
        return false;
      }
      const next = body.group.position.clone().addScaledVector(velocity, dt);
      if (side === "player") this.clampRoam(next);
      else this.clampPartnerKnock(next);
      body.group.position.x = next.x;
      body.group.position.z = next.z;
      // Exponential, so the shove is fast at the moment of the hit and gone
      // shortly after rather than sliding to a halt.
      velocity.multiplyScalar(Math.exp(-KNOCKBACK_DECAY * dt));
      return true;
    };
    const a = move(this.character, this.throwPlayer, "player");
    const b = move(this.sparring, this.throwPartner, "partner");
    return a || b;
  }

  /**
   * Keep a knocked-back opponent in the scene. Looser than the dash leash —
   * being hit is allowed to move it further from its seat than its own move
   * would take it — and it still cannot be shoved into the player.
   */
  private clampPartnerKnock(next: THREE.Vector3) {
    const offset = next.clone().sub(this.partnerAnchor);
    offset.y = 0;
    const leash = DASH_MAX_M + FOOTWORK_LEASH_M;
    if (offset.length() > leash) {
      offset.setLength(leash);
      next.x = this.partnerAnchor.x + offset.x;
      next.z = this.partnerAnchor.z + offset.z;
    }
    const body = this.character;
    if (!body || !this.placed) return;
    const away = next.clone().sub(body.group.position);
    away.y = 0;
    if (away.length() >= CLOSE_GUARD_M) return;
    if (away.lengthSq() < 1e-6) away.set(0, 0, 1);
    away.setLength(CLOSE_GUARD_M);
    next.x = body.group.position.x + away.x;
    next.z = body.group.position.z + away.z;
  }

  /**
   * The opponent's feet between blows: close, give ground, circle, or hold.
   *
   * Only while an exchange is live, and never while either body is mid-dash —
   * a dash is already moving somebody deliberately, and two systems arguing
   * over the same position is how a body ends up vibrating. Once the exchange
   * goes quiet this hands back to `returnPartner`, which walks it home.
   *
   * Training only. In a real match the opponent is another player, and where
   * their character stands is theirs to decide and the server's to relay —
   * inventing footwork for it would be this client making up someone else's
   * position, which is exactly what it is not allowed to do.
   */
  private stepFootwork(dt: number, now: number) {
    if (this.stance === "duel") return false;
    const anchor = this.character;
    const partner = this.sparring;
    if (!anchor || !partner || !this.placed || !partner.group.visible) return false;
    if (this.dashPlayer || this.dashPartner) return false;
    // Not while a blow is still moving it, and not until it is back on its
    // seat: footwork adopts wherever it steps to as the new seat, and adopting
    // a position it was *knocked* into would quietly cancel the walk home.
    if (this.throwPartner.lengthSq() > 1e-6) return false;
    if (
      Math.hypot(
        partner.group.position.x - this.partnerAnchor.x,
        partner.group.position.z - this.partnerAnchor.z,
      ) > 0.06
    ) {
      return false;
    }
    if (now - this.lastActionAt > FOOTWORK_IDLE_MS) {
      this.footwork = "hold";
      // The exchange is over, so the seat goes back to where the opponent was
      // placed and `returnPartner` strolls it there. Without this the seat
      // stays wherever the last step left it, and a long session ratchets the
      // opponent out to the end of its leash and keeps it there.
      this.partnerAnchor.x = this.partnerHome.x;
      this.partnerAnchor.z = this.partnerHome.z;
      return false;
    }
    // Not while a swing is in the air. A fighter with a blow coming at it
    // reacts to the blow — that is the reel and the ground it gives — rather
    // than strolling through it, and footwork walking the target around
    // mid-strike would also argue with the shove that is about to land.
    if (now < this.attackLockUntil) {
      this.footwork = "hold";
      return false;
    }

    const here = partner.group.position;
    const toPlayer = new THREE.Vector3(
      anchor.group.position.x - here.x,
      0,
      anchor.group.position.z - here.z,
    );
    const gap = toPlayer.length();
    if (gap < 1e-4) return false;
    toPlayer.divideScalar(gap);

    if (now >= this.footworkUntil) {
      // The choice is weighted by where it is standing, so the opponent works
      // toward a range it can actually fight at instead of wandering: too far
      // and it comes in, too close and it gives ground, and in the pocket it
      // circles or sets its feet.
      const roll = Math.random();
      if (gap > FOOTWORK_FAR_M) this.footwork = roll < 0.75 ? "advance" : "circle";
      else if (gap < FOOTWORK_NEAR_M) this.footwork = roll < 0.65 ? "retreat" : "circle";
      else if (roll < 0.4) this.footwork = "circle";
      else if (roll < 0.62) this.footwork = "advance";
      else if (roll < 0.8) this.footwork = "retreat";
      else this.footwork = "hold";
      if (this.footwork === "circle" && Math.random() < 0.5) this.footworkTurn *= -1;
      this.footworkUntil = now + FOOTWORK_MIN_MS + Math.random() * (FOOTWORK_MAX_MS - FOOTWORK_MIN_MS);
    }

    if (this.footwork === "hold") return false;
    const step = MOVE_SPEED_MPS * FOOTWORK_SPEED * dt;
    const next = here.clone();
    if (this.footwork === "advance") {
      // Closing stops at the range it means to fight at, not at the range two
      // bodies would collide at. An opponent that walks itself chest-to-chest
      // has nowhere left to throw anything from, and it leaves a lunge nothing
      // to close either.
      next.addScaledVector(toPlayer, Math.min(step, Math.max(0, gap - FOOTWORK_NEAR_M)));
    } else if (this.footwork === "retreat") {
      next.addScaledVector(toPlayer, -step);
    } else {
      // Circling is a step along the tangent — sideways around the player,
      // keeping its distance — which is what a fighter looking for an angle
      // does and what the old anchored opponent could never do.
      next.x += -toPlayer.z * this.footworkTurn * step;
      next.z += toPlayer.x * this.footworkTurn * step;
    }
    this.clampFootwork(next);
    const moved = Math.hypot(next.x - here.x, next.z - here.z) > 1e-5;
    here.x = next.x;
    here.z = next.z;
    // Where it stepped to is where it now means to stand, so the seat comes
    // with it and `returnPartner` has nothing to undo. The wandering is bounded
    // by `clampFootwork`, which leashes the step to the original seat.
    this.partnerAnchor.x = next.x;
    this.partnerAnchor.z = next.z;
    return moved;
  }

  /**
   * Hold footwork on a short leash around the opponent's seat, and off the
   * player. Tighter than the knockback leash on purpose: the opponent is free
   * to shuffle around where it was seated, not to walk off with the scene.
   */
  private clampFootwork(next: THREE.Vector3) {
    const offset = next.clone().sub(this.partnerHome);
    offset.y = 0;
    if (offset.length() > FOOTWORK_LEASH_M) {
      offset.setLength(FOOTWORK_LEASH_M);
      next.x = this.partnerHome.x + offset.x;
      next.z = this.partnerHome.z + offset.z;
    }
    const body = this.character;
    if (!body || !this.placed) return;
    const away = next.clone().sub(body.group.position);
    away.y = 0;
    if (away.length() >= CLOSE_GUARD_M) return;
    if (away.lengthSq() < 1e-6) away.set(0, 0, 1);
    away.setLength(CLOSE_GUARD_M);
    next.x = body.group.position.x + away.x;
    next.z = body.group.position.z + away.z;
  }

  /**
   * Square the two characters up again. Public because the moves that need it
   * are triggered from the match feed and from the pads, not from in here.
   */
  refaceCombatants() {
    this.faceCombatants();
  }

  /**
   * Where the two bodies are standing and which way they are looking.
   *
   * Facing is the one thing in here with no visible failure state — two
   * characters fighting past each other looks almost right in a screenshot —
   * so it is readable from outside, and the browser checks assert on it
   * instead of on pixels.
   */
  facingProbe() {
    const anchor = this.character;
    const partner = this.sparring;
    const read = (body: typeof anchor) =>
      body ? { x: body.group.position.x, z: body.group.position.z, yaw: body.group.rotation.y } : null;
    return {
      placed: this.placed,
      stance: this.stance,
      aimYaw: this.aimYaw,
      character: read(anchor),
      partner: partner && partner.group.visible ? read(partner) : null,
      // Movement has the same problem facing does — a character standing a
      // metre off looks fine in a screenshot — so the walk is readable too.
      drive: { x: this.drive.x, y: this.drive.y },
      facingMode: this.facingMode,
      attackLocked: performance.now() < this.attackLockUntil,
      // A dash is the one move that changes where a body is standing, so what
      // it covered is readable too — the browser checks assert on the gap it
      // closed and on the guard it did not cross.
      dash: {
        player: this.dashPlayer
          ? { travelledM: this.dashPlayer.travelled, recoiledM: this.dashPlayer.recoiled }
          : null,
        partner: this.dashPartner
          ? { travelledM: this.dashPartner.travelled, recoiledM: this.dashPartner.recoiled }
          : null,
        // The last finished run on each side. A dash's totals are only final
        // once it has ended, and by then the run itself is gone.
        lastPlayer: this.lastDashPlayer
          ? {
              travelledM: this.lastDashPlayer.travelled,
              recoiledM: this.lastDashPlayer.recoiled,
              run: this.lastDashPlayer.run,
            }
          : null,
        lastPartner: this.lastDashPartner
          ? {
              travelledM: this.lastDashPartner.travelled,
              recoiledM: this.lastDashPartner.recoiled,
              run: this.lastDashPartner.run,
            }
          : null,
        maxM: DASH_MAX_M,
        closeGuardM: CLOSE_GUARD_M,
        playerSpeedMps: DASH_SPEED_MPS,
        partnerSpeedMps: DASH_BOT_SPEED_MPS,
        // Where the opponent is seated, so a check can tell a body that walked
        // home from one that stopped near enough to look like it had.
        partnerAnchor: { x: this.partnerAnchor.x, z: this.partnerAnchor.z },
        partnerOffSeatM:
          partner && partner.group.visible
            ? Math.hypot(
                partner.group.position.x - this.partnerAnchor.x,
                partner.group.position.z - this.partnerAnchor.z,
              )
            : null,
      },
      gapM:
        anchor && partner && partner.group.visible
          ? Math.hypot(
              anchor.group.position.x - partner.group.position.x,
              anchor.group.position.z - partner.group.position.z,
            )
          : null,
      // The room behind the player's own back, and whether it has run out.
      // Reported because this is the one number in the scene that changes what
      // a blow costs, and a check that cannot read it cannot verify the
      // cornered rule from the outside.
      spaceBehindM: this.spaceBehindM(),
      cornered: this.cornered(),
      corneredSpaceM: CORNERED_SPACE_M,
      anchor: { x: this.roamAnchor.x, z: this.roamAnchor.z },
      roamRadiusM: ROAM_RADIUS_M,
      roamedM: anchor
        ? Math.hypot(
            anchor.group.position.x - this.roamAnchor.x,
            anchor.group.position.z - this.roamAnchor.z,
          )
        : 0,
      /**
       * What an impact is currently doing to the scene. Added for the same
       * reason the dash numbers were: a freeze, a kick and a shove are all a
       * few frames long and none of them is legible in a screenshot, so the
       * browser checks read them here instead of trying to see them.
       */
      impact: {
        hitstopMs: Math.max(0, this.hitstopUntil - performance.now()),
        cameraKickRad:
          Math.abs(this.kick.pitch) + Math.abs(this.kick.yaw) + Math.abs(this.kick.roll),
        cameraShake: this.kick.shake,
        knockbackMps: {
          player: this.throwPlayer.length(),
          partner: this.throwPartner.length(),
        },
      },
      /** The opponent's feet: what it is doing and how far it has wandered. */
      footwork: {
        mode: this.footwork,
        home: { x: this.partnerHome.x, z: this.partnerHome.z },
        offHomeM:
          partner && partner.group.visible
            ? Math.hypot(
                partner.group.position.x - this.partnerHome.x,
                partner.group.position.z - this.partnerHome.z,
              )
            : null,
        leashM: FOOTWORK_LEASH_M,
      },
    };
  }

  /**
   * Turn the player's character by hand — the left stick in landscape. The
   * offset is additive on the facing the scene already chose, so a player who
   * turns their character and then throws a move still ends up looking at
   * their opponent, rotated by however far they turned it.
   */
  setCharacterAim(yawRad: number) {
    const next = Number.isFinite(yawRad) ? yawRad : 0;
    if (Math.abs(next - this.aimYaw) < 1e-4) return;
    this.aimYaw = next;
    this.faceCombatants();
  }

  /**
   * What the movement stick is asking for. Intent only: nothing moves in here,
   * because a stick held still has to keep walking the character and the render
   * loop is the only thing that ticks. Both axes -1..1, `y` away from the
   * camera, and out-of-range or junk readings are clamped rather than trusted.
   */
  setCharacterDrive(x: number, y: number) {
    const clamp = (value: number) =>
      Number.isFinite(value) ? Math.max(-1, Math.min(1, value)) : 0;
    this.drive.x = clamp(x);
    this.drive.y = clamp(y);
  }

  /**
   * Update the equipped-booster level driving animation intensity, without
   * rebuilding the mesh — a booster that levels mid-session takes effect on the
   * next reaction instead of popping the character out of the scene.
   */
  setCharacterLevel(level: number) {
    this.character?.setLevel(level);
  }

  /** Place the character: on the reticle if we have one, else straight ahead. */
  place(): boolean {
    if (!this.character) return false;
    const group = this.character.group;

    if (this.reticleVisible) {
      // The reticle lives in the scene root and the character hangs off
      // `roomGroup`, which is itself dropped to floor level — so the reticle's
      // world point has to come back into room space or the character is
      // planted a floor's height underground and renders off the bottom of
      // the frame.
      const spot = new THREE.Vector3().setFromMatrixPosition(this.reticle.matrix);
      this.roomGroup.worldToLocal(spot);
      group.position.copy(spot);
      // In XR the reticle's height is a real detected plane, so keep it. In
      // the fallback there is one floor and it is this group's own, so feet at
      // zero rather than the reticle's hover offset.
      if (this.mode !== "xr") group.position.y = 0;
    } else {
      // 3DoF / no-plane path: project the view direction onto the floor plane.
      const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(this.camera.quaternion);
      forward.y = 0;
      if (forward.lengthSq() < 1e-4) forward.set(0, 0, -1);
      forward.normalize().multiplyScalar(FALLBACK_DISTANCE_M);
      const eye = this.roomGroup.worldToLocal(this.camera.position.clone());
      group.position.set(eye.x + forward.x, 0, eye.z + forward.z);
    }

    group.visible = true;
    this.placed = true;
    // Where it was put is what roaming is measured from, and a fresh placement
    // starts from a standstill rather than inheriting the last stick reading.
    this.roamAnchor.copy(group.position);
    this.resetDrive();
    // Facing comes last and comes from one place: the opponent if there is
    // one, the player otherwise.
    this.layoutSparring();
    this.events.onPlaced?.(true);
    return true;
  }

  isPlaced() {
    return this.placed;
  }

  clearPlacement() {
    this.placed = false;
    this.resetDrive();
    if (this.character) this.character.group.visible = false;
    if (this.sparring) this.sparring.group.visible = false;
    this.events.onPlaced?.(false);
  }

  /** Back to a standstill: no intent, no lock, facing by the normal rule. */
  private resetDrive() {
    this.drive.x = 0;
    this.drive.y = 0;
    this.driveSmooth.x = 0;
    this.driveSmooth.y = 0;
    this.facingMode = "idle";
    this.attackLockUntil = 0;
    this.dashPlayer = null;
    this.dashPartner = null;
    this.lastDriveAt = performance.now();
  }

  setCombatPaused(paused: boolean) {
    this.combatPaused = paused;
  }

  setCharacterHealth(ratio: number) {
    this.characterHealth = Number.isFinite(ratio) ? Math.max(0, Math.min(1, ratio)) : 1;
    this.character?.setHealth(this.characterHealth);
  }

  flashCharacter() {
    this.character?.flash(0xff3b30);
  }

  /** Play a procedural reaction. A hit also reddens the chassis. */
  playCharacterAnimation(state: AnimationState) {
    if (!this.character) return;
    this.character.play(state);
    if (state === "hit_react") this.character.flash(0xff3b30);
    // A swing locks onto the opponent for as long as it lasts: the player can
    // keep walking through it, and the body still hits what it is aiming at.
    const now = performance.now();
    this.attackLockUntil = now + animationDuration(state) * 1_000;
    this.lastActionAt = now;
    // A dash is the same move as any other to the server and to the pad; the
    // only thing it adds is that the body actually covers the ground, which is
    // started here and integrated in the render loop.
    this.dashPlayer = isDashState(state)
      ? this.startDash(state, DASH_SPEED_MPS)
      : this.dashPlayer;
    this.faceCombatants();
  }

  /**
   * Book a dash for the render loop to walk. Refused when the move is too
   * short to have windows worth integrating, which keeps a zero-duration state
   * off the wire from parking a run that never expires.
   */
  private startDash(state: AnimationState, speedMps: number): DashRun | null {
    const durationMs = animationDuration(state) * 1_000;
    if (durationMs < 100) return null;
    // A move that closes nothing has no ground to walk, so there is no run to
    // book — the pose leans and the body stays where it is.
    if (dashCloseM(state) <= 0) return null;
    return {
      startedAt: performance.now(),
      heldAtStart: this.heldMs,
      phase: 0,
      durationMs,
      speedMps,
      closesM: dashCloseM(state),
      travelled: 0,
      recoiled: 0,
    };
  }

  /** Put a line in the bubble over the character's head. */
  sayCharacterLine(text: string, ttl?: number) {
    this.character?.say(text, ttl);
  }

  /** True heading of the device's forward axis, in degrees from north. */
  setHeading(headingDeg: number) {
    this.worldGroup.rotation.y = (headingDeg * Math.PI) / 180;
  }

  /** Reconcile the marker set — add, move and remove by id. */
  setMarkers(next: Marker[]) {
    const seen = new Set<string>();
    for (const marker of next) {
      seen.add(marker.id);
      const existing = this.markers.get(marker.id);
      if (existing) {
        existing.marker.east = marker.east;
        existing.marker.north = marker.north;
        existing.marker.inRange = marker.inRange;
        existing.marker.distanceM = marker.distanceM;
        existing.marker.label = marker.label;
        placeOnGround(existing.object, existing.marker);
        continue;
      }
      const created = createMarker(marker);
      this.markers.set(marker.id, created);
      this.worldGroup.add(created.object);
    }
    for (const [id, marker] of this.markers) {
      if (seen.has(id)) continue;
      this.worldGroup.remove(marker.object);
      marker.dispose();
      this.markers.delete(id);
    }
  }

  /* ------------------------------------------------------------------ input */

  private dragging = false;
  private lastPointer = { x: 0, y: 0 };
  private pointerMoved = false;

  private onPointerDown = (event: PointerEvent) => {
    this.dragging = true;
    this.pointerMoved = false;
    this.lastPointer = { x: event.clientX, y: event.clientY };
  };

  private onPointerMove = (event: PointerEvent) => {
    if (!this.dragging || this.mode === "xr") return;
    const dx = event.clientX - this.lastPointer.x;
    const dy = event.clientY - this.lastPointer.y;
    if (Math.abs(dx) + Math.abs(dy) > 6) this.pointerMoved = true;
    // Drag-to-look only matters where there is no sensor driving the camera.
    if (!this.useOrientation) {
      this.lookYaw -= dx * 0.005;
      this.lookPitch = Math.max(-1.2, Math.min(1.2, this.lookPitch - dy * 0.005));
    }
    this.lastPointer = { x: event.clientX, y: event.clientY };
  };

  private onPointerUp = (event: PointerEvent) => {
    this.dragging = false;
    if (this.pointerMoved || this.mode === "xr") return;
    const rect = this.canvas.getBoundingClientRect();
    const ndc = new THREE.Vector2(
      ((event.clientX - rect.left) / rect.width) * 2 - 1,
      -((event.clientY - rect.top) / rect.height) * 2 + 1,
    );
    this.pickMarker(ndc);
  };

  private onXRSelect = () => {
    // In an XR session a controller/tap select means "place here".
    if (!this.placed) this.place();
  };

  private pickMarker(ndc: THREE.Vector2) {
    if (!this.events.onMarkerTap) return;
    this.raycaster.setFromCamera(ndc, this.camera);
    const hits = this.raycaster.intersectObjects(this.worldGroup.children, true);
    for (const hit of hits) {
      let node: THREE.Object3D | null = hit.object;
      while (node && !node.userData.markerId) node = node.parent;
      const id = node?.userData.markerId as string | undefined;
      const marker = id ? this.markers.get(id) : undefined;
      if (marker) {
        this.events.onMarkerTap(marker.marker);
        return;
      }
    }
  }

  private onDeviceOrientation = (event: DeviceOrientationEvent) => {
    if (event.alpha == null || event.beta == null || event.gamma == null) return;
    this.useOrientation = true;
    this.orientationQuat.copy(orientationToQuaternion(event));
  };

  /* ------------------------------------------------------------------- loop */

  private emitReticle(visible: boolean) {
    if (this.reticleVisible === visible) return;
    this.reticleVisible = visible;
    this.events.onReticle?.(visible);
  }

  private tick = (_time: number, frame?: XRFrame) => {
    if (this.disposed) return;
    const elapsed = (performance.now() - this.startedAt) / 1_000;

    if (this.mode === "xr" && frame && this.hitTestSource) {
      const referenceSpace = this.renderer.xr.getReferenceSpace();
      const results = referenceSpace ? frame.getHitTestResults(this.hitTestSource) : [];
      const pose = results.length > 0 ? results[0]!.getPose(referenceSpace!) : null;
      if (pose && !this.placed) {
        this.reticle.visible = true;
        this.reticle.matrix.fromArray(pose.transform.matrix);
        this.reticle.matrixAutoUpdate = false;
        this.reticle.position.setFromMatrixPosition(this.reticle.matrix);
        this.emitReticle(true);
      } else {
        this.reticle.visible = false;
        this.emitReticle(false);
      }
    } else if (this.mode !== "xr") {
      // Outside XR the camera is ours to drive.
      if (this.useOrientation) {
        this.camera.quaternion.copy(this.orientationQuat);
      } else {
        this.camera.quaternion.setFromEuler(
          new THREE.Euler(this.lookPitch, this.lookYaw, 0, "YXZ"),
        );
      }
      // A floating reticle 2 m ahead: the placement affordance when there are
      // no detected planes to snap to.
      if (!this.placed) {
        const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(this.camera.quaternion);
        forward.y = 0;
        if (forward.lengthSq() < 1e-4) forward.set(0, 0, -1);
        forward.normalize().multiplyScalar(FALLBACK_DISTANCE_M);
        this.reticle.matrixAutoUpdate = true;
        this.reticle.position.set(forward.x, FLOOR_Y + 0.01, forward.z);
        this.reticle.rotation.set(-Math.PI / 2, 0, 0);
        this.reticle.visible = true;
        this.emitReticle(true);
      } else {
        this.reticle.visible = false;
        this.emitReticle(false);
      }
    }

    const material = this.reticle.material as THREE.MeshBasicMaterial;
    material.opacity = 0.45 + Math.sin(elapsed * 4) * 0.2;

    // Walk the character before it is drawn, and turn it toward whatever the
    // walk left it wanting to look at. The frame delta is clamped so a tab
    // coming back from the background does not fling the body across the room
    // on one enormous step.
    const now = performance.now();
    const previous = this.lastFrameAt === 0 ? now : Math.max(this.lastFrameAt, now - 100);
    const dt = (now - previous) / 1_000;
    this.lastFrameAt = now;
    if (dt > 0) {
      // Hitstop takes the frozen *part* of the frame off the step rather than
      // dropping the whole frame. A 45ms freeze must cost 45ms of movement even
      // on a machine rendering 250ms frames, or a freeze turns into a body
      // teleporting somewhere else once it lifts.
      const heldS = Math.max(0, Math.min(now, this.hitstopUntil) - previous) / 1_000;
      const moveDt = Math.max(0, dt - heldS);
      this.heldMs += heldS * 1_000;
      if (moveDt > 0) {
        this.stepMovement(moveDt);
        // After the stick, before facing: a dash overrides where the walk left
        // the body, and facing then answers to both.
        this.stepDash(moveDt);
        // The opponent's own feet, and then whatever ground either body is
        // still being shoved across. Both after the dash, which owns a body
        // outright while it is running.
        this.stepFootwork(moveDt, now);
        this.stepKnockback(moveDt);
        // Easing facing every frame would have the character slowly swivelling
        // to follow the camera as the player pans the phone, which is not what
        // a standing creature does. So it only runs while something is actually
        // asking facing to change.
        if (this.facingMode !== "idle" || now < this.attackLockUntil) this.stepFacing(moveDt);
        // The opponent turns unconditionally: nothing else is competing for
        // where it looks, and everything above may have moved what it is
        // looking at.
        this.stepPartnerFacing(moveDt);
      }
      // The camera is the one thing that keeps moving through a freeze. Holding
      // it too would render an impact as a dropped frame instead of a hit.
      this.stepCamera(dt);
    }

    this.character?.update(elapsed, this.combatPaused);
    // The partner is never paused: it exists to be watched, and a training
    // zone is the one place combat animation runs while combat does not.
    this.sparring?.update(elapsed, false);
    for (const marker of this.markers.values()) marker.update(elapsed);

    this.stepLighting();
    // Last, over the top of the look angles: the kick is something that happens
    // to the view, not something the player aimed.
    this.applyCameraKick(elapsed);
    this.renderer.render(this.scene, this.camera);
  };

  /**
   * Keep the key light over whoever is standing. The shadow camera is only a
   * few metres wide, so instead of widening it to cover a room the player can
   * walk their character around in, the light and its target ride along at a
   * fixed offset and the shadow stays sharp wherever the bodies end up.
   */
  private stepLighting() {
    const bodies: THREE.Object3D[] = [];
    if (this.character?.group.visible) bodies.push(this.character.group);
    if (this.sparring?.group.visible) bodies.push(this.sparring.group);
    if (bodies.length === 0) return;

    const focus = LIGHT_FOCUS.set(0, 0, 0);
    for (const body of bodies) focus.add(body.getWorldPosition(LIGHT_SCRATCH));
    focus.divideScalar(bodies.length);

    this.lights.focus(focus);
  }

  private resize = () => {
    const width = this.canvas.clientWidth || window.innerWidth;
    const height = this.canvas.clientHeight || window.innerHeight;
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / Math.max(1, height);
    this.camera.updateProjectionMatrix();
  };

  dispose() {
    this.disposed = true;
    this.renderer.setAnimationLoop(null);
    window.removeEventListener("resize", this.resize);
    window.removeEventListener("deviceorientation", this.onDeviceOrientation, true);
    this.canvas.removeEventListener("pointerdown", this.onPointerDown);
    this.canvas.removeEventListener("pointermove", this.onPointerMove);
    this.canvas.removeEventListener("pointerup", this.onPointerUp);
    this.stopCamera();
    void this.session?.end().catch(() => {});
    for (const marker of this.markers.values()) marker.dispose();
    this.markers.clear();
    this.character?.dispose();
    this.sparring?.dispose();
    this.lights.dispose();
    this.renderer.dispose();
  }
}

/* ---------------------------------------------------------------- internals */

function buildReticle() {
  const geometry = new THREE.RingGeometry(0.12, 0.17, 40).rotateX(-Math.PI / 2);
  const material = new THREE.MeshBasicMaterial({
    color: 0xb6f03c,
    transparent: true,
    opacity: 0.6,
    side: THREE.DoubleSide,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.matrixAutoUpdate = false;
  return mesh;
}

const zee = new THREE.Vector3(0, 0, 1);
const euler = new THREE.Euler();
const q0 = new THREE.Quaternion();
const q1 = new THREE.Quaternion(-Math.sqrt(0.5), 0, 0, Math.sqrt(0.5));
const scratch = new THREE.Quaternion();

/**
 * Device orientation (alpha/beta/gamma, screen-relative) to a camera
 * quaternion, with the screen-rotation correction. Same construction as
 * three's retired DeviceOrientationControls, kept local so the app does not
 * depend on a deprecated addon.
 */
function orientationToQuaternion(event: DeviceOrientationEvent): THREE.Quaternion {
  const alpha = ((event.alpha ?? 0) * Math.PI) / 180;
  const beta = ((event.beta ?? 0) * Math.PI) / 180;
  const gamma = ((event.gamma ?? 0) * Math.PI) / 180;
  const screenAngle = ((screen.orientation?.angle ?? 0) * Math.PI) / 180;

  euler.set(beta, alpha, -gamma, "YXZ");
  scratch.setFromEuler(euler);
  scratch.multiply(q1);
  scratch.multiply(q0.setFromAxisAngle(zee, -screenAngle));
  return scratch;
}
