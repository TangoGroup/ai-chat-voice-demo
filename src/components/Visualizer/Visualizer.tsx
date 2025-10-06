"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { Canvas } from "@react-three/fiber";
import { SphereWaveform } from "./SphereWaveform";
import { STATE_CONFIGS, TRANSITION_MS, type VoiceState } from "./stateConfigs";
import { useMicAnalyzer } from "./useMicAnalyzer";
import { useTheme } from "@/components/Theme/ThemeProvider";

type Tweened<T> = { current: T; target: T; start: number; duration: number };

function lerp(a: number, b: number, t: number): number { return a + (b - a) * t; }
function easeInOutCubic(t: number): number { return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2; }

export function Visualizer({ logsRef, onHud }: { logsRef?: React.MutableRefObject<(msg: string) => void>; onHud?: (h: { state: string; mic: number; tts: number; eff: number }) => void }) {
  const [voiceState, setVoiceState] = useState<VoiceState>("passive");
  const { volume, start: startMic } = useMicAnalyzer({ smoothingTimeConstant: 0.8, fftSize: 1024 });
  const { theme } = useTheme();
  const [ttsVolume, setTtsVolume] = useState<number>(0);

  // Global mic start on mount
  useEffect(() => { void startMic(); }, [startMic]);

  // Allow external drivers to dispatch state changes
  useEffect(() => {
    function onState(e: CustomEvent<{ state?: VoiceState; ttsVolume?: number }>) {
      if (e.detail?.state) setVoiceState(e.detail.state);
      if (typeof e.detail?.ttsVolume === "number") setTtsVolume(e.detail.ttsVolume);
    }
    window.addEventListener("voice-state", onState as EventListener);
    return () => window.removeEventListener("voice-state", onState as EventListener);
  }, []);

  const [tween, setTween] = useState<Tweened<VoiceState>>({ current: "passive", target: "passive", start: 0, duration: TRANSITION_MS });
  const [tick, setTick] = useState<number>(0);
  useEffect(() => {
    setTween((prev) => ({ current: prev.target, target: voiceState, start: performance.now(), duration: TRANSITION_MS }));
  }, [voiceState]);

  // Drive a per-frame render tick and finalize tween.current when done
  useEffect(() => {
    let raf = 0;
    const step = () => {
      setTick(performance.now());
      const t = (performance.now() - tween.start) / tween.duration;
      if (t >= 1 && tween.current !== tween.target) {
        setTween((s) => ({ ...s, current: s.target }));
      }
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [tween.start, tween.duration, tween.current, tween.target]);

  // Compute blended config every render using eased progress
  const configNow = useMemo(() => {
    void tick; // dependency to recompute each frame
    const from = STATE_CONFIGS[tween.current];
    const to = STATE_CONFIGS[tween.target];
    const rawT = Math.min(1, Math.max(0, (performance.now() - tween.start) / tween.duration));
    const t = easeInOutCubic(rawT);
    const mix = (a: number | undefined, b: number | undefined) => lerp(a ?? 0, b ?? 0, t);
    return {
      // Global controls
      vertexCount: Math.round(mix(from.vertexCount, to.vertexCount)),
      pointSize: mix(from.pointSize, to.pointSize),
      shellCount: Math.max(1, Math.round(mix(from.shellCount, to.shellCount))),
      volume: mix(from.volume, to.volume),
      // Transforms/presentation
      size: mix(from.size, to.size),
      opacity: mix(from.opacity, to.opacity),
      rotationX: mix(from.rotationX, to.rotationX),
      rotationY: mix(from.rotationY, to.rotationY),
      rotationZ: mix(from.rotationZ, to.rotationZ),
      sizeRandomness: mix(from.sizeRandomness, to.sizeRandomness),
      // Toggles
      enableRandomishNoise: rawT < 1 ? ((from.enableRandomishNoise ?? false) || (to.enableRandomishNoise ?? false)) : (to.enableRandomishNoise ?? false),
      randomishAmount: mix(from.randomishAmount, to.randomishAmount),
      enableSineNoise: rawT < 1 ? ((from.enableSineNoise ?? false) || (to.enableSineNoise ?? false)) : (to.enableSineNoise ?? false),
      sineAmount: mix(from.sineAmount, to.sineAmount),
      sineScale: mix(from.sineScale, to.sineScale),
      sineSpeed: mix(from.sineSpeed, to.sineSpeed),
      randomishSpeed: mix(from.randomishSpeed, to.randomishSpeed),
      pulseSize: mix(from.pulseSize, to.pulseSize),
      enableSpin: rawT < 1 ? ((from.enableSpin ?? false) || (to.enableSpin ?? false)) : (to.enableSpin ?? false),
      spinSpeed: mix(from.spinSpeed, to.spinSpeed),
      spinAxisX: mix(from.spinAxisX, to.spinAxisX),
      spinAxisY: mix(from.spinAxisY, to.spinAxisY),
      maskEnabled: rawT < 1 ? ((from.maskEnabled ?? false) || (to.maskEnabled ?? false)) : (to.maskEnabled ?? false),
      maskRadius: mix(from.maskRadius, to.maskRadius),
      maskFeather: mix(from.maskFeather, to.maskFeather),
      maskInvert: (rawT < 1 ? ((from.maskInvert ?? false) || (to.maskInvert ?? false)) : (to.maskInvert ?? false)) ? 1 : 0,
      // Ripple and surface ripple
      enableRippleNoise: rawT < 1 ? ((from.enableRippleNoise ?? false) || (to.enableRippleNoise ?? false)) : (to.enableRippleNoise ?? false),
      rippleAmount: mix(from.rippleAmount, to.rippleAmount),
      rippleSpeed: mix(from.rippleSpeed, to.rippleSpeed),
      rippleScale: mix(from.rippleScale, to.rippleScale),
      enableSurfaceRipple: rawT < 1 ? ((from.enableSurfaceRipple ?? false) || (to.enableSurfaceRipple ?? false)) : (to.enableSurfaceRipple ?? false),
      surfaceRippleAmount: mix(from.surfaceRippleAmount, to.surfaceRippleAmount),
      surfaceRippleSpeed: mix(from.surfaceRippleSpeed, to.surfaceRippleSpeed),
      surfaceRippleScale: mix(from.surfaceRippleScale, to.surfaceRippleScale),
      // Arcs
      enableArcs: rawT < 1 ? ((from.enableArcs ?? false) || (to.enableArcs ?? false)) : (to.enableArcs ?? false),
      arcMaxCount: Math.round(mix(from.arcMaxCount, to.arcMaxCount)),
      arcSpawnRate: mix(from.arcSpawnRate, to.arcSpawnRate),
      arcDuration: mix(from.arcDuration, to.arcDuration),
      arcSpeed: mix(from.arcSpeed, to.arcSpeed),
      arcSpanDeg: mix(from.arcSpanDeg, to.arcSpanDeg),
      arcThickness: mix(from.arcThickness, to.arcThickness),
      arcFeather: mix(from.arcFeather, to.arcFeather),
      arcBrightness: mix(from.arcBrightness, to.arcBrightness),
      arcAltitude: mix(from.arcAltitude, to.arcAltitude),
      // Appearance (colors are not eased here; use target state)
      pointColor: (to.pointColor ?? from.pointColor ?? "#ffffff"),
      glowColor: (to.glowColor ?? from.glowColor ?? "#ffffff"),
      glowStrength: mix(from.glowStrength, to.glowStrength),
      glowRadiusFactor: mix(from.glowRadiusFactor, to.glowRadiusFactor),
      enableGradient: rawT < 1 ? ((from.enableGradient ?? false) || (to.enableGradient ?? false)) : (to.enableGradient ?? false),
      gradientColor2: (to.gradientColor2 ?? from.gradientColor2 ?? "#ffffff"),
      gradientAngle: mix(from.gradientAngle, to.gradientAngle),
      randomishMicModAmount: mix(from.randomishMicModAmount, to.randomishMicModAmount),
      sineMicModAmount: mix(from.sineMicModAmount, to.sineMicModAmount),
      rippleMicModAmount: mix(from.rippleMicModAmount, to.rippleMicModAmount),
      surfaceRippleMicModAmount: mix(from.surfaceRippleMicModAmount, to.surfaceRippleMicModAmount),
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tween.current, tween.target, tween.start, tween.duration, tick]);

  // Theme-based color overrides
  const displayPointColor = useMemo(() => (theme === "dark" ? "#ffffff" : "#171717"), [theme]);
  const displayGlowColor = useMemo(() => (theme === "dark" ? "#ffffff" : "#171717"), [theme]);
  // Use TTS volume only while speaking; otherwise use mic volume. Avoid overriding with near-silence.
  const effectiveVolume = voiceState === "speaking" && ttsVolume > 0.02 ? ttsVolume : volume;

  // On-screen HUD for debugging visual response
  // Emit HUD to the in-app console sheet via callback
  useEffect(() => {
    const id = setInterval(() => {
      try { onHud?.({ state: voiceState, mic: volume, tts: ttsVolume, eff: effectiveVolume }); } catch {}
    }, 250);
    return () => clearInterval(id);
  }, [onHud, voiceState, volume, ttsVolume, effectiveVolume]);

  const containerRef = useRef<HTMLDivElement | null>(null);

  return (
    <div ref={containerRef} className="fixed inset-0">
      <Canvas gl={{ antialias: true }} camera={{ fov: 60, position: [0, 0, 2.6] }}>
        <ambientLight intensity={0.2} />
        <group position={[0, 0, 0]}> 
          <SphereWaveform
            volume={effectiveVolume}
            size={configNow.size ?? 1.0}
            vertexCount={configNow.vertexCount ?? 480}
            pointSize={configNow.pointSize ?? 0.04}
            shellCount={configNow.shellCount ?? 1}
            opacity={configNow.opacity ?? 1}
            rotationX={configNow.rotationX ?? 0}
            rotationY={configNow.rotationY ?? 0}
            rotationZ={configNow.rotationZ ?? 0}
            sizeRandomness={configNow.sizeRandomness ?? 0}
            enableRandomishNoise={configNow.enableRandomishNoise}
            randomishAmount={configNow.randomishAmount}
            enableSineNoise={configNow.enableSineNoise}
            sineAmount={configNow.sineAmount}
            sineScale={configNow.sineScale}
            sineSpeed={configNow.sineSpeed}
            randomishSpeed={configNow.randomishSpeed}
            pulseSize={configNow.pulseSize}
            enableSpin={configNow.enableSpin}
            spinSpeed={configNow.spinSpeed}
            spinAxisX={configNow.spinAxisX}
            spinAxisY={configNow.spinAxisY}
            maskEnabled={configNow.maskEnabled}
            maskRadius={configNow.maskRadius}
            maskFeather={configNow.maskFeather}
            maskInvert={Boolean(configNow.maskInvert)}
            enableRippleNoise={configNow.enableRippleNoise}
            rippleAmount={configNow.rippleAmount}
            rippleSpeed={configNow.rippleSpeed}
            rippleScale={configNow.rippleScale}
            enableSurfaceRipple={configNow.enableSurfaceRipple}
            surfaceRippleAmount={configNow.surfaceRippleAmount}
            surfaceRippleSpeed={configNow.surfaceRippleSpeed}
            surfaceRippleScale={configNow.surfaceRippleScale}
            enableArcs={configNow.enableArcs}
            arcMaxCount={configNow.arcMaxCount}
            arcSpawnRate={configNow.arcSpawnRate}
            arcDuration={configNow.arcDuration}
            arcSpeed={configNow.arcSpeed}
            arcSpanDeg={configNow.arcSpanDeg}
            arcThickness={configNow.arcThickness}
            arcFeather={configNow.arcFeather}
            arcBrightness={configNow.arcBrightness}
            arcAltitude={configNow.arcAltitude}
            pointColor={displayPointColor}
            glowColor={displayGlowColor}
            glowStrength={configNow.glowStrength}
            glowRadiusFactor={configNow.glowRadiusFactor}
            enableGradient={configNow.enableGradient}
            gradientColor2={configNow.gradientColor2}
            gradientAngle={configNow.gradientAngle}
            randomishMicModAmount={configNow.randomishMicModAmount}
            sineMicModAmount={configNow.sineMicModAmount}
            micEnvelope={effectiveVolume}
            rippleMicModAmount={configNow.rippleMicModAmount}
            surfaceRippleMicModAmount={configNow.surfaceRippleMicModAmount}
          />
        </group>
      </Canvas>
    </div>
  );
}

export default Visualizer;


