import * as React from "react";
import {
  ARStage,
  probeCapabilities,
  webglSupported,
  type StageCapabilities,
  type StageMode,
} from "@/ar/stage";
import type { Marker } from "@/ar/markers";
import { motionPermissionNeeded, requestMotionAccess, watchHeading, type HeadingSample } from "@/ar/heading";

/**
 * React lifecycle around `ARStage`.
 *
 * The stage owns an imperative render loop and a WebGL context, so it is built
 * once per mount and never re-created by a render. Everything React wants to
 * push into it (markers, character, heading, pause state) goes through imperative
 * setters, which is what keeps a 60 fps loop from being coupled to a component
 * tree that re-renders on every GPS fix.
 */

export type ArStageApi = {
  canvasRef: React.RefObject<HTMLCanvasElement | null>;
  videoRef: React.RefObject<HTMLVideoElement | null>;
  overlayRef: React.RefObject<HTMLDivElement | null>;
  stage: ARStage | null;
  mode: StageMode;
  capabilities: StageCapabilities | null;
  reticleVisible: boolean;
  placed: boolean;
  error: string | null;
  heading: HeadingSample | null;
  /** True once motion sensors are usable (always true off iOS). */
  motionGranted: boolean;
  enterXR: () => Promise<void>;
  exitXR: () => void;
  startCamera: () => Promise<void>;
  stopCamera: () => void;
  place: () => void;
  clearPlacement: () => void;
  enableSensors: () => Promise<void>;
};

export function useArStage(options: { onMarkerTap?: (marker: Marker) => void }): ArStageApi {
  const canvasRef = React.useRef<HTMLCanvasElement | null>(null);
  const videoRef = React.useRef<HTMLVideoElement | null>(null);
  const overlayRef = React.useRef<HTMLDivElement | null>(null);
  const stageRef = React.useRef<ARStage | null>(null);
  const tapRef = React.useRef(options.onMarkerTap);
  tapRef.current = options.onMarkerTap;

  const [stage, setStage] = React.useState<ARStage | null>(null);
  const [mode, setMode] = React.useState<StageMode>("preview");
  const [capabilities, setCapabilities] = React.useState<StageCapabilities | null>(null);
  const [reticleVisible, setReticleVisible] = React.useState(false);
  const [placed, setPlaced] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [heading, setHeading] = React.useState<HeadingSample | null>(null);
  const [motionGranted, setMotionGranted] = React.useState(() => !motionPermissionNeeded());

  React.useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    void probeCapabilities().then(setCapabilities);

    // No GL context, no stage — and no crash either. The rest of the client
    // (safety, boosters, matchmaking) is useful without a rendered scene, so a
    // device that cannot render one gets the 2D game instead of a blank page.
    if (!webglSupported()) {
      setError("This browser cannot render 3D — the AR view is unavailable here.");
      return;
    }

    let instance: ARStage;
    try {
      instance = new ARStage(canvas, videoRef.current, {
        onReticle: setReticleVisible,
        onPlaced: setPlaced,
        onModeChange: setMode,
        onError: setError,
        onMarkerTap: (marker) => tapRef.current?.(marker),
      });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The AR view failed to start.");
      return;
    }
    stageRef.current = instance;
    setStage(instance);
    // Dev only: the scene is otherwise unreachable from a console or a browser
    // check, and facing, stance and placement are exactly the things worth
    // reading back while working on them.
    if (import.meta.env.DEV) {
      (window as unknown as { __stage?: ARStage }).__stage = instance;
    }
    return () => {
      instance.dispose();
      stageRef.current = null;
      setStage(null);
    };
  }, []);

  // Heading feeds the world group, so GPS markers sit on the right bearing.
  React.useEffect(() => {
    if (!motionGranted) return;
    return watchHeading((sample) => {
      setHeading(sample);
      stageRef.current?.setHeading(sample.headingDeg);
    });
  }, [motionGranted]);

  const enableSensors = React.useCallback(async () => {
    const granted = await requestMotionAccess();
    setMotionGranted(granted);
    if (!granted) setError("Motion access was declined — compass alignment is off.");
  }, []);

  const enterXR = React.useCallback(async () => {
    setError(null);
    await stageRef.current?.enterXR(overlayRef.current);
  }, []);

  const startCamera = React.useCallback(async () => {
    setError(null);
    await stageRef.current?.startCamera();
  }, []);

  return {
    canvasRef,
    videoRef,
    overlayRef,
    stage,
    mode,
    capabilities,
    reticleVisible,
    placed,
    error,
    heading,
    motionGranted,
    enterXR,
    exitXR: () => stageRef.current?.exitXR(),
    startCamera,
    stopCamera: () => stageRef.current?.stopCamera(),
    place: () => stageRef.current?.place(),
    clearPlacement: () => stageRef.current?.clearPlacement(),
    enableSensors,
  };
}
