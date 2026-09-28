import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { Link } from "wouter";
import {
  Dumbbell,
  Loader2,
  RotateCcw,
  Save,
  Sparkles,
  Swords,
  Terminal,
  Trash2,
  TriangleAlert,
  Wand2,
  Zap,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { SiteHeader } from "@/components/site-header";
import { MoveRow } from "@/components/play/move-pad";
import { createCharacter, type AnimationState, type Character } from "@/ar/character";
import { webglSupported } from "@/ar/stage";
import { installLightRig } from "@/ar/lighting";
import {
  CATEGORY_LABELS,
  CREATURE_CATEGORIES,
  MOVE_LABELS,
  movesForForm,
  parseCreatureDescription,
  parseStoredForm,
  type CreatureCategory,
  type CreatureForm,
} from "../../api/lib/creature-form";
import { errorMessage } from "@/lib/format";
import {
  useGenerateFromDescription,
  useMyAvatars,
  useReleaseAvatar,
  useSetAvatarCategory,
} from "@/queries/play";
import { useSession } from "@/queries/session";

/**
 * Character lab: the procedural creature on a plain canvas, off the AR path.
 *
 * Two jobs now. It still drives `createCharacter` directly — no camera, no GPS,
 * no WebXR — so silhouettes, the reaction curves and the level hardware can be
 * judged in a laptop browser. And it is the summoning bench: type what the
 * creature is, the server parses the words into body parameters, and the same
 * parameters that get stored on the row are what this canvas builds from. What
 * is previewed here is exactly what walks into the arena.
 */

const RARITIES = ["common", "uncommon", "rare", "epic", "legendary"] as const;

const CORE_ANIMATIONS: Array<{ state: AnimationState; label: string; icon: typeof Swords }> = [
  { state: "attack_lurch", label: "Attack", icon: Swords },
  { state: "hit_react", label: "Take a hit", icon: Zap },
  { state: "celebrate", label: "Celebrate", icon: Sparkles },
  { state: "idle", label: "Back to idle", icon: RotateCcw },
];

/** What each level bolts on, so the slider can be checked against intent. */
const TIERS = [
  { level: 1, adds: "base body — shape, limbs and colour from the description" },
  { level: 2, adds: "flank plating over the trunk" },
  { level: 3, adds: "shoulder crests + hotter glow" },
  { level: 4, adds: "a second row of spines down the back" },
  { level: 5, adds: "turning crest halo + glow at full" },
];

/** A handful of ids that hash to different builds, for silhouette checking. */
const PRESET_IDS = ["proc_heavy_01", "proc_standard_01", "proc_skirmish_01", "proc_v1"];

/**
 * Trait words the parser understands, one tap each. They edit the sentence
 * rather than bypassing it: the description stays the single source of the
 * creature, so what is typed by hand and what is tapped in behave identically.
 */
const TRAIT_GROUPS: Array<{ label: string; words: readonly string[]; hint?: string }> = [
  {
    label: "Theme",
    words: ["dragon-like", "beast", "insectoid", "elemental", "bird", "construct"],
  },
  { label: "Silhouette", words: ["towering", "squat", "long", "rounded", "serpentine"] },
  { label: "Parts", words: ["wings", "spikes", "horns", "long tail", "plume tail", "no tail"] },
  { label: "Palette", words: ["pink", "crimson", "teal", "gold", "obsidian", "emerald", "violet"] },
  { label: "Glow", words: ["glowing", "radiant", "dim"] },
  { label: "Scale", words: ["huge", "tiny", "bulky", "lithe"] },
  {
    label: "Grandness",
    words: ["ancient", "legendary", "mythic"],
    hint: "better rarity odds, not a body change",
  },
];

/** Ready-made sentences — one tap to a creature that is nothing like the last. */
const PRESET_DESCRIPTIONS = [
  // The first three reach the mesh block sets — a cat, a dragon and a sprite
  // word each switch the matching slots from primitives to mesh blocks.
  "bipedal cat mascot, two legs, arms, long tail, gem",
  "dragon-like, pink, wings, spikes",
  "tiny leaf sprite with a tuft tail",
  "cute fox with a glowing tail",
  "rock golem with blue crystals",
  "ancient serpentine wyrm, six legs, no wings",
  "tiny radiant insect swarm-leader with four wings",
];

export default function CharacterLab() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const characterRef = useRef<Character | null>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  /** Turntable state lives in a ref: the render loop reads it every frame. */
  const viewRef = useRef({ yaw: 0.6, pitch: 0.18, distance: 3.1, spin: true });

  const [supported] = useState(() => webglSupported());
  const [modelId, setModelId] = useState("proc_heavy_01");
  const [rarity, setRarity] = useState<string>("rare");
  const [level, setLevel] = useState(1);
  const [health, setHealth] = useState(100);
  const [paused, setPaused] = useState(false);
  const [spin, setSpin] = useState(true);
  const [line, setLine] = useState("Boosters singing. Line up the next one.");
  const [active, setActive] = useState<AnimationState>("idle");

  /* -------------------------------------------------------------- summoning */

  const [description, setDescription] = useState("dragon-like, pink, wings, spikes");
  const [seed, setSeed] = useState(0);
  /** The generated body on the canvas, or null when driving it by model id. */
  const [form, setForm] = useState<CreatureForm | null>(null);
  const [summonedName, setSummonedName] = useState<string | null>(null);
  const [summonedId, setSummonedId] = useState<string | null>(null);
  /**
   * The category the picker is asking for, or null for "read it off the words".
   *
   * Deliberately separate from `form.category`: this is the request, that is
   * the result. Keeping them apart is what lets the panel tell the player their
   * pick has not been applied to the loaded character yet — and lets null mean
   * something real, rather than being indistinguishable from whatever the
   * sentence happened to parse into.
   */
  const [pickedCategory, setPickedCategory] = useState<CreatureCategory | null>(null);
  const [savedId, setSavedId] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  const session = useSession();
  const signedIn = Boolean(session.data?.user);
  const avatars = useMyAvatars(signedIn);
  const generate = useGenerateFromDescription();
  const release = useReleaseAvatar();
  const retrain = useSetAvatarCategory();

  /**
   * Generate, or re-generate. The same words with a different seed re-roll only
   * what the sentence left unsaid, which is what makes "Regenerate" feel like a
   * variation on the idea rather than a different idea.
   */
  const summon = useCallback(
    (nextSeed: number, persist = false) => {
      setNote(null);
      generate.mutate(
        { description, seed: nextSeed, persist, category: pickedCategory ?? undefined },
        {
          onSuccess: (result) => {
            setSeed(result.seed);
            setForm(result.form);
            setSummonedName(result.avatar.name);
            setSummonedId(result.avatar.id);
            setRarity(result.avatar.rarity);
            setModelId(result.avatar.modelId);
            setSavedId(result.saved ? result.avatar.id : null);
            setHealth(100);
            setNote(
              result.saved
                ? `Saved ${result.avatar.name} — it is selectable in the arena now.`
                : `${result.avatar.name} — preview only, nothing written yet.`,
            );
          },
          onError: (error) => setNote(errorMessage(error)),
        },
      );
    },
    [description, generate, pickedCategory],
  );

  /**
   * Show a category on the canvas the instant it is tapped.
   *
   * This runs the *same* parser the server runs — one shared module, same seed,
   * same pure function — so the body it puts on the canvas is byte-for-byte the
   * one a summon would store. Nothing is written and no round-trip is made,
   * which is the point: comparing body plans is the job this picker exists for,
   * and re-generating to see each one would re-roll the seed and hand back a
   * different creature every time instead of the same one rebuilt.
   *
   * A saved character is left alone — that one is a row on the server, and
   * changing it is `applyPickedCategory`'s job, not a preview's.
   */
  const previewCategory = useCallback(
    (next: CreatureCategory | null) => {
      setPickedCategory(next);
      if (savedId || description.trim().length < 3) return;
      setForm(parseCreatureDescription(description, seed, next));
      setHealth(100);
      setNote(
        next
          ? `Previewing ${CATEGORY_LABELS[next].label} — local only, nothing written. Generate to keep it.`
          : "Previewing the body plan the words alone ask for.",
      );
    },
    [description, savedId, seed],
  );

  /**
   * Re-train the loaded character into the picked category.
   *
   * The server is the one that re-plans the body, so the canvas is rebuilt from
   * the form it returns rather than from a local guess — a swap changes stats,
   * the special and the moveset too, and only the server knows what those
   * became.
   */
  const applyPickedCategory = useCallback(() => {
    if (!savedId || !pickedCategory) return;
    setNote(null);
    retrain.mutate(
      { avatarId: savedId, category: pickedCategory },
      {
        onSuccess: (result) => {
          setForm(result.form);
          setModelId(result.avatar.modelId);
          setHealth(100);
          setNote(
            result.changed
              ? `Re-trained into ${result.label} — new body, stats and moveset. Name, rarity and boosters kept.`
              : "Already that category — nothing changed.",
          );
        },
        onError: (error) => setNote(errorMessage(error)),
      },
    );
  }, [pickedCategory, retrain, savedId]);

  /** Put a character the player already owns back on the canvas. */
  const loadSaved = useCallback(
    (row: { id: string; name: string; rarity: string; modelId: string; form: string | null; formDescription: string | null }) => {
      const loaded = parseStoredForm(row.form);
      setForm(loaded);
      // The picker follows the character onto the canvas, so it reads as what
      // this one *is* rather than as a stale pick from the last summon.
      setPickedCategory(loaded?.category ?? null);
      setSummonedName(row.name);
      setSummonedId(row.id);
      setSavedId(row.id);
      setRarity(row.rarity);
      setModelId(row.modelId);
      if (row.formDescription) setDescription(row.formDescription);
      setNote(`Loaded ${row.name}.`);
    },
    [],
  );

  /**
   * Delete goes through the avatar system's existing release procedure — the
   * same one the arena uses to free a slot — so there is one way to destroy a
   * character and one set of rules about when it is allowed.
   */
  const destroy = useCallback(() => {
    if (!savedId) return;
    const target = savedId;
    setNote(null);
    release.mutate(
      { avatarId: target },
      {
        onSuccess: () => {
          setSavedId(null);
          setNote("Released. The slot is free.");
        },
        onError: (error) => setNote(errorMessage(error)),
      },
    );
  }, [release, savedId]);

  /* ------------------------------------------------------------- renderer */

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !supported) return;

    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setClearColor(0x0b0f16, 1);

    const scene = new THREE.Scene();
    sceneRef.current = scene;
    // Literally the same rig as the AR stage — one shared module, not a copy
    // of it — so the character reads here the way it reads in the arena
    // rather than under lab lighting of its own.
    const lights = installLightRig(renderer, scene, { floorY: 0 });
    // Nothing walks around in the lab, so the key is aimed once.
    lights.focus(new THREE.Vector3(0, 0, 0));
    const grid = new THREE.GridHelper(12, 24, 0x2c3442, 0x1d2430);
    scene.add(grid);

    const camera = new THREE.PerspectiveCamera(50, 1, 0.05, 100);
    const target = new THREE.Vector3(0, 0.78, 0);

    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      const width = Math.max(1, Math.floor(rect.width));
      const height = Math.max(1, Math.floor(rect.height));
      renderer.setSize(width, height, false);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
    };
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(canvas);

    /* ------------------------------------------------------ drag + zoom */

    let dragging = false;
    let lastX = 0;
    let lastY = 0;
    const onDown = (event: PointerEvent) => {
      dragging = true;
      lastX = event.clientX;
      lastY = event.clientY;
      canvas.setPointerCapture(event.pointerId);
    };
    const onMove = (event: PointerEvent) => {
      if (!dragging) return;
      const view = viewRef.current;
      view.yaw -= (event.clientX - lastX) * 0.008;
      // Clamped so the turntable never flips under the floor.
      view.pitch = Math.max(-0.4, Math.min(1.1, view.pitch + (event.clientY - lastY) * 0.005));
      lastX = event.clientX;
      lastY = event.clientY;
    };
    const onUp = (event: PointerEvent) => {
      dragging = false;
      if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
    };
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      const view = viewRef.current;
      view.distance = Math.max(1.2, Math.min(8, view.distance + event.deltaY * 0.002));
    };
    canvas.addEventListener("pointerdown", onDown);
    canvas.addEventListener("pointermove", onMove);
    canvas.addEventListener("pointerup", onUp);
    canvas.addEventListener("pointercancel", onUp);
    canvas.addEventListener("wheel", onWheel, { passive: false });

    const clock = new THREE.Clock();
    renderer.setAnimationLoop(() => {
      const elapsed = clock.getElapsedTime();
      const view = viewRef.current;
      // The turntable is a slow drift on top of the dragged yaw, so a static
      // silhouette still gets seen from every side without touching anything.
      const yaw = view.yaw + (view.spin ? elapsed * 0.25 : 0);
      camera.position.set(
        target.x + Math.sin(yaw) * Math.cos(view.pitch) * view.distance,
        target.y + Math.sin(view.pitch) * view.distance,
        target.z + Math.cos(yaw) * Math.cos(view.pitch) * view.distance,
      );
      camera.lookAt(target);
      characterRef.current?.update(elapsed, paused);
      renderer.render(scene, camera);
    });

    return () => {
      renderer.setAnimationLoop(null);
      observer.disconnect();
      canvas.removeEventListener("pointerdown", onDown);
      canvas.removeEventListener("pointermove", onMove);
      canvas.removeEventListener("pointerup", onUp);
      canvas.removeEventListener("pointercancel", onUp);
      canvas.removeEventListener("wheel", onWheel);
      grid.geometry.dispose();
      lights.dispose();
      renderer.dispose();
      sceneRef.current = null;
    };
    // `paused` is read by the loop through the closure, so it has to re-bind.
  }, [supported, paused]);

  /* ------------------------------------------------------------ character */

  // Rebuilt only when the identity changes — a generated form counts as an
  // identity, so a regenerate swaps the body. Level is passed at build time so
  // a fresh character starts with the right hardware, then updated in place.
  useEffect(() => {
    const scene = sceneRef.current;
    if (!scene) return;
    const character = createCharacter({
      modelId,
      name: summonedName ?? "Lab Subject",
      rarity,
      level,
      form,
    });
    characterRef.current = character;
    scene.add(character.group);
    return () => {
      scene.remove(character.group);
      character.dispose();
      characterRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [modelId, rarity, supported, paused, form, summonedName]);

  // In-place level change: this is the path the game actually uses when a
  // booster levels mid-session, so it is the one worth eyeballing.
  useEffect(() => {
    characterRef.current?.setLevel(level);
  }, [level]);

  useEffect(() => {
    characterRef.current?.setHealth(health / 100);
  }, [health]);

  useEffect(() => {
    viewRef.current.spin = spin;
  }, [spin]);

  const play = useCallback((state: AnimationState) => {
    setActive(state);
    characterRef.current?.play(state);
    if (state === "hit_react") characterRef.current?.flash(0xff3b30);
  }, []);

  const tier = useMemo(() => TIERS.find((row) => row.level === level)!, [level]);

  /**
   * Which moves this body can actually perform at this level. A creature with
   * no wings never gusts and never wing-shields; combos only appear once the
   * booster level unlocks them — the same rules the battle engine picks by.
   */
  const moves = useMemo(() => {
    const body = form ?? characterRef.current?.form ?? null;
    if (!body) return null;
    return movesForForm(body, level);
  }, [form, level]);

  const appendTrait = useCallback((word: string) => {
    setDescription((current) => {
      const trimmed = current.trim();
      if (!trimmed) return word;
      if (trimmed.toLowerCase().includes(word.toLowerCase())) return trimmed;
      return `${trimmed.replace(/[,\s]+$/, "")}, ${word}`;
    });
  }, []);

  const busy = generate.isPending;

  if (!supported) {
    return (
      <div className="min-h-dvh bg-background text-foreground">
        <SiteHeader current="play" />
        <div className="mx-auto max-w-2xl px-4 py-16 sm:px-6">
          <div className="rounded-lg border border-destructive/50 bg-destructive/10 p-4">
            <div className="flex items-center gap-2 text-sm font-semibold text-destructive">
              <TriangleAlert className="size-4" />
              This browser cannot give us a WebGL context
            </div>
            <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
              The lab needs one to draw the character. Open it in a normal desktop or mobile
              browser with hardware acceleration on — a headless or GPU-less browser will always
              land here.
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-dvh bg-background text-foreground">
      <SiteHeader current="play" />
      <div className="mx-auto max-w-6xl px-4 py-6 sm:px-6">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="font-display text-xl font-semibold uppercase tracking-[0.14em]">
            Character Lab
          </h1>
          <Badge tone="info">no camera · no location</Badge>
          <Link href="/admin" className="ml-auto">
            <Button variant="outline" size="sm">
              <Terminal className="size-4" />
              Console
            </Button>
          </Link>
        </div>
        <p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted-foreground">
          Describe a creature and it gets built from primitives — no assets, no model download.
          Every silhouette, reaction, attack and defence below is the same code the arena runs.
          Drag to orbit, scroll to zoom.
        </p>

        <div className="mt-5 grid gap-4 lg:grid-cols-[minmax(0,1fr)_22rem]">
          <div className="space-y-4">
            <div className="overflow-hidden rounded-lg border border-border bg-[#0b0f16]">
              <canvas
                ref={canvasRef}
                aria-label="Creature preview — drag to turn, scroll to zoom"
                className="block h-[62dvh] w-full touch-none"
              />
            </div>

            {/* ------------------------------------------------- move sets */}
            <section className="rounded-lg border border-border bg-card p-3">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                  Moves
                </span>
                {moves ? (
                  <Badge tone="neutral">
                    {moves.attacks.length} attacks · {moves.defenses.length} defences ·{" "}
                    {moves.combos.length} combos
                  </Badge>
                ) : null}
                <span className="ml-auto text-[11px] text-muted-foreground">
                  playing: {MOVE_LABELS[active as keyof typeof MOVE_LABELS] ?? active}
                </span>
              </div>

              <div className="mt-3 space-y-3">
                <MoveRow
                  title="Attacks"
                  states={moves?.attacks ?? []}
                  active={active}
                  onPlay={play}
                />
                <MoveRow
                  title="Defences"
                  states={moves?.defenses ?? []}
                  active={active}
                  onPlay={play}
                />
                <MoveRow
                  title={`Combinations — booster lv ${level}`}
                  states={moves?.combos ?? []}
                  active={active}
                  onPlay={play}
                  empty="Nothing unlocked at this level for this body — raise the booster level."
                />
                <div>
                  <span className="text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                    Core states
                  </span>
                  <div className="mt-1.5 grid grid-cols-2 gap-2 sm:grid-cols-4">
                    {CORE_ANIMATIONS.map(({ state, label, icon: Icon }) => (
                      <Button
                        key={state}
                        size="sm"
                        variant={active === state ? "default" : "outline"}
                        onClick={() => play(state)}
                      >
                        <Icon className="size-4" />
                        {label}
                      </Button>
                    ))}
                  </div>
                </div>
              </div>
            </section>
          </div>

          <div className="space-y-4">
            {/* ------------------------------------------------- summoning */}
            <section className="rounded-lg border border-primary/40 bg-card p-3">
              <div className="flex items-center justify-between">
                <span className="inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                  <Wand2 className="size-3.5" />
                  Summon
                </span>
                {summonedName ? (
                  <Badge tone={savedId ? "live" : "warn"}>
                    {savedId ? "saved" : "preview"}
                  </Badge>
                ) : null}
              </div>

              <textarea
                value={description}
                onChange={(event) => setDescription(event.target.value)}
                aria-label="What the creature is"
                rows={3}
                placeholder="dragon-like, pink, wings, spikes"
                className="mt-2 w-full resize-y rounded-md border border-input bg-background/60 px-3 py-2 text-[12px] leading-relaxed outline-none transition-colors placeholder:text-muted-foreground/70 focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/30"
              />

              <div className="mt-2 flex flex-wrap gap-1.5">
                {PRESET_DESCRIPTIONS.map((preset) => (
                  <Button
                    key={preset}
                    size="sm"
                    variant="ghost"
                    className="h-6 px-2 text-[10px]"
                    onClick={() => setDescription(preset)}
                  >
                    {preset.length > 26 ? `${preset.slice(0, 26)}…` : preset}
                  </Button>
                ))}
              </div>

              <div className="mt-2 grid grid-cols-2 gap-2">
                <Button
                  size="sm"
                  disabled={busy || description.trim().length < 3}
                  onClick={() => summon(Math.floor(Math.random() * 1_000_000))}
                >
                  {busy ? <Loader2 className="size-4 animate-spin" /> : <Wand2 className="size-4" />}
                  Generate
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={busy || !form}
                  onClick={() => summon(Math.floor(Math.random() * 1_000_000))}
                >
                  <RotateCcw className="size-4" />
                  Regenerate
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={busy || !form || Boolean(savedId)}
                  onClick={() => summon(seed, true)}
                >
                  <Save className="size-4" />
                  {savedId ? "Saved" : "Save character"}
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className="text-destructive"
                  disabled={release.isPending || !savedId}
                  onClick={destroy}
                >
                  {release.isPending ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : (
                    <Trash2 className="size-4" />
                  )}
                  Delete
                </Button>
              </div>

              {!signedIn ? (
                <p className="mt-2 text-[11px] leading-relaxed text-accent">
                  Sign in on the play page to summon, save or delete — the canvas below still runs
                  on the model id alone.
                </p>
              ) : null}
              {note ? (
                <p className="mt-2 text-[11px] leading-relaxed text-foreground/80">{note}</p>
              ) : null}
              {form ? (
                <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
                  <Fact label="Name" value={summonedName ?? "—"} />
                  <Fact label="Category" value={CATEGORY_LABELS[form.category].label} />
                  <Fact label="Theme" value={form.theme} />
                  <Fact label="Body" value={`${form.bodyShape} · ${form.silhouette}`} />
                  <Fact label="Legs" value={String(form.limbCount)} />
                  <Fact label="Arms" value={form.arms ? `yes · reach ${form.armSpan.toFixed(2)}` : "none"} />
                  <Fact label="Wings" value={String(form.wings)} />
                  <Fact label="Horns" value={String(form.horns)} />
                  <Fact label="Spikes" value={String(form.spikes)} />
                  <Fact label="Tail" value={form.tail} />
                  <Fact label="Glow" value={form.glow.toFixed(2)} />
                  <Fact label="Scale" value={form.scale.toFixed(2)} />
                  <Fact label="Seed" value={String(seed)} />
                  <Fact label="Rarity" value={rarity} />
                </dl>
              ) : null}
              {form ? (
                <div className="mt-2 flex gap-1.5">
                  {[form.palette.base, form.palette.accent, form.palette.glowColor].map((hex) => (
                    <span
                      key={hex}
                      className="size-5 rounded border border-border"
                      style={{ background: hex }}
                      title={hex}
                    />
                  ))}
                </div>
              ) : null}
            </section>

            {/* -------------------------------------------------- category */}
            {/*
              One picker, two jobs. Before a character exists it steers the
              summon; after one is loaded the same row re-trains it, because a
              category is not a creation-time lock — the player who built a
              beast and then wanted to see it throw hands should not have to
              release it and start over.
            */}
            <section className="rounded-lg border border-border bg-card p-3">
              <div className="flex items-center justify-between">
                <span className="inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                  <Dumbbell className="size-3.5" />
                  Body plan
                </span>
                {form ? (
                  <Badge tone={pickedCategory && pickedCategory !== form.category ? "warn" : "live"}>
                    {pickedCategory && pickedCategory !== form.category ? "not applied" : "on canvas"}
                  </Badge>
                ) : null}
              </div>
              <p className="mt-1 text-[10px] leading-relaxed text-muted-foreground">
                Decides the moveset, the stat identity and the silhouette. Everyone gets the
                universal strikes on top.
              </p>

              <div className="mt-2 flex flex-wrap gap-1.5">
                <Button
                  size="sm"
                  variant={pickedCategory === null ? "default" : "ghost"}
                  className="h-6 px-2 text-[10px]"
                  onClick={() => previewCategory(null)}
                >
                  from the words
                </Button>
                {CREATURE_CATEGORIES.map((key) => (
                  <Button
                    key={key}
                    size="sm"
                    variant={pickedCategory === key ? "default" : "ghost"}
                    className="h-6 px-2 text-[10px]"
                    onClick={() => previewCategory(key)}
                  >
                    {CATEGORY_LABELS[key].label}
                  </Button>
                ))}
              </div>

              <p className="mt-2 text-[11px] leading-relaxed text-foreground/80">
                {pickedCategory
                  ? CATEGORY_LABELS[pickedCategory].blurb
                  : "The parser reads the body plan out of the sentence — pick one to override it."}
              </p>

              {/* The re-train only exists once there is a saved row to re-train. */}
              {savedId && pickedCategory ? (
                <Button
                  size="sm"
                  className="mt-2 w-full"
                  variant="outline"
                  disabled={retrain.isPending || pickedCategory === form?.category}
                  onClick={applyPickedCategory}
                >
                  {retrain.isPending ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : (
                    <Dumbbell className="size-4" />
                  )}
                  {pickedCategory === form?.category
                    ? `Already ${CATEGORY_LABELS[pickedCategory].label}`
                    : `Re-train into ${CATEGORY_LABELS[pickedCategory].label}`}
                </Button>
              ) : null}
              {savedId && pickedCategory && pickedCategory !== form?.category ? (
                <p className="mt-1.5 text-[10px] leading-relaxed text-muted-foreground">
                  Keeps the name, rarity and equipped boosters. Re-derives body, stats, special and
                  moves. Blocked mid-match.
                </p>
              ) : null}
            </section>

            {/* ---------------------------------------------------- traits */}
            <section className="rounded-lg border border-border bg-card p-3">
              <span className="text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                Traits
              </span>
              <p className="mt-1 text-[10px] leading-relaxed text-muted-foreground">
                Each one appends a word the parser reads. Generate after tapping.
              </p>
              <div className="mt-2 space-y-2">
                {TRAIT_GROUPS.map((group) => (
                  <div key={group.label}>
                    <span className="text-[10px] uppercase tracking-[0.12em] text-muted-foreground/70">
                      {group.label}
                      {group.hint ? (
                        <span className="ml-1.5 normal-case tracking-normal text-muted-foreground/60">
                          {group.hint}
                        </span>
                      ) : null}
                    </span>
                    <div className="mt-1 flex flex-wrap gap-1.5">
                      {group.words.map((word) => (
                        <Button
                          key={word}
                          size="sm"
                          variant="ghost"
                          className="h-6 px-2 text-[10px]"
                          onClick={() => appendTrait(word)}
                        >
                          {word}
                        </Button>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </section>

            {/* --------------------------------------------------- level */}
            <section className="rounded-lg border border-border bg-card p-3">
              <div className="flex items-center justify-between">
                <span className="inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                  <Dumbbell className="size-3.5" />
                  Booster level
                </span>
                <Badge tone={level >= 5 ? "warn" : level >= 3 ? "live" : "neutral"}>
                  lv {level}
                </Badge>
              </div>
              <input
                type="range"
                min={1}
                max={5}
                step={1}
                value={level}
                onChange={(event) => setLevel(Number(event.target.value))}
                className="mt-3 w-full accent-primary"
                aria-label="Booster level"
              />
              <div className="mt-1 flex justify-between text-[10px] text-muted-foreground">
                {[1, 2, 3, 4, 5].map((step) => (
                  <span key={step}>{step}</span>
                ))}
              </div>
              <p className="mt-2 text-[11px] leading-relaxed text-foreground/80">
                <span className="text-primary">Adds at this level:</span> {tier.adds}
              </p>
              <ul className="mt-2 space-y-1 text-[11px] text-muted-foreground">
                {TIERS.filter((row) => row.level > 1).map((row) => (
                  <li
                    key={row.level}
                    className={level >= row.level ? "text-foreground/80" : "opacity-45"}
                  >
                    {level >= row.level ? "✓" : "·"} lv{row.level} — {row.adds}
                  </li>
                ))}
              </ul>
            </section>

            {/* ------------------------------------------------ speech */}
            <section className="rounded-lg border border-border bg-card p-3">
              <span className="text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                Voice + playback
              </span>
              <div className="mt-2 flex gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  className="flex-1"
                  onClick={() => characterRef.current?.say(line, 4000)}
                >
                  Say line
                </Button>
                <Button
                  size="sm"
                  variant={paused ? "default" : "outline"}
                  onClick={() => setPaused((value) => !value)}
                >
                  {paused ? "Resume" : "Freeze"}
                </Button>
              </div>
              <Input
                value={line}
                onChange={(event) => setLine(event.target.value)}
                className="mt-2 h-8 text-[11px]"
                placeholder="Speech bubble text"
              />
            </section>

            {/* -------------------------------------------- saved roster */}
            {signedIn ? (
              <section className="rounded-lg border border-border bg-card p-3">
                <span className="text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                  Your characters
                </span>
                {avatars.data && avatars.data.length > 0 ? (
                  <ul className="mt-2 space-y-1.5">
                    {avatars.data.map((row) => (
                      <li key={row.id}>
                        <button
                          type="button"
                          onClick={() => loadSaved(row)}
                          className={`w-full rounded border px-2 py-1.5 text-left text-[11px] transition-colors ${
                            summonedId === row.id
                              ? "border-primary/50 bg-primary/10"
                              : "border-border hover:bg-secondary"
                          }`}
                        >
                          <span className="font-medium text-foreground">{row.name}</span>
                          <span className="ml-1 text-muted-foreground">
                            · {row.rarity}
                            {row.form ? " · generated" : " · classic"}
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="mt-2 text-[11px] text-muted-foreground">
                    {avatars.isLoading ? "Loading…" : "None yet — summon one above."}
                  </p>
                )}
              </section>
            ) : null}

            {/* -------------------------------------------------- identity */}
            <section className="rounded-lg border border-border bg-card p-3">
              <span className="text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                Identity fallback
              </span>
              <p className="mt-1 text-[10px] leading-relaxed text-muted-foreground">
                What a character made before descriptions existed looks like: the body is hashed
                from its model id.
              </p>
              <Input
                value={modelId}
                onChange={(event) => {
                  setModelId(event.target.value);
                  setForm(null);
                  setSavedId(null);
                  setSummonedId(null);
                }}
                className="mt-2 h-8 text-[11px]"
                placeholder="modelId — hashes to the build"
              />
              <div className="mt-2 flex flex-wrap gap-1.5">
                {PRESET_IDS.map((id) => (
                  <Button
                    key={id}
                    size="sm"
                    variant={modelId === id && !form ? "default" : "ghost"}
                    className="h-7 px-2 text-[11px]"
                    onClick={() => {
                      setModelId(id);
                      setForm(null);
                      setSavedId(null);
                      setSummonedId(null);
                      setSummonedName(null);
                    }}
                  >
                    {id}
                  </Button>
                ))}
              </div>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {RARITIES.map((value) => (
                  <Button
                    key={value}
                    size="sm"
                    variant={rarity === value ? "default" : "ghost"}
                    className="h-7 px-2 text-[11px] capitalize"
                    onClick={() => setRarity(value)}
                  >
                    {value}
                  </Button>
                ))}
              </div>
            </section>

            {/* ----------------------------------------------------- view */}
            <section className="rounded-lg border border-border bg-card p-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                  Health {health}%
                </span>
                <Button
                  size="sm"
                  variant={spin ? "default" : "outline"}
                  className="h-7 px-2 text-[11px]"
                  onClick={() => setSpin((value) => !value)}
                >
                  {spin ? "Turntable on" : "Turntable off"}
                </Button>
              </div>
              <input
                type="range"
                min={0}
                max={100}
                step={5}
                value={health}
                onChange={(event) => setHealth(Number(event.target.value))}
                className="mt-2 w-full accent-primary"
                aria-label="Health"
              />
            </section>
          </div>
        </div>
      </div>
    </div>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-2">
      <dt className="shrink-0">{label}</dt>
      <dd className="truncate text-right font-medium text-foreground/85">{value}</dd>
    </div>
  );
}
