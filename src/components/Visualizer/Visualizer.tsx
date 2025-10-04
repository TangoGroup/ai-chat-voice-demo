"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { Canvas } from "@react-three/fiber";
import { SphereWaveform } from "./SphereWaveform";
import { STATE_CONFIGS, TRANSITION_MS, type VoiceState } from "./stateConfigs";
import { useMicAnalyzer } from "./useMicAnalyzer";

type Tweened<T> = { current: T; target: T; start: number; duration: number };

function lerp(a: number, b: number, t: number): number { return a + (b - a) * t; }

export function Visualizer({ logsRef }: { logsRef?: React.MutableRefObject<(msg: string) => void> }) {
  const [voiceState, setVoiceState] = useState<VoiceState>("passive");
  const { volume, start: startMic } = useMicAnalyzer({ smoothingTimeConstant: 0.8, fftSize: 1024 });

  // Global mic start on mount
  useEffect(() => { void startMic(); }, [startMic]);

  // Allow external drivers to dispatch state changes
  useEffect(() => {
    function onState(e: CustomEvent<{ state: VoiceState }>) { setVoiceState(e.detail.state); }
    window.addEventListener("voice-state", onState as EventListener);
    return () => window.removeEventListener("voice-state", onState as EventListener);
  }, []);

  const [tween, setTween] = useState<Tweened<VoiceState>>({ current: "passive", target: "passive", start: 0, duration: TRANSITION_MS });
  useEffect(() => {
    setTween({ current: tween.target, target: voiceState, start: performance.now(), duration: TRANSITION_MS });
  }, [voiceState]);

  const configNow = useMemo(() => {
    const from = STATE_CONFIGS[tween.current];
    const to = STATE_CONFIGS[tween.target];
    const t = Math.min(1, (performance.now() - tween.start) / tween.duration);
    const mix = (a: number, b: number) => lerp(a, b, t);
    return {
      enableRandomishNoise: t < 1 ? (from.enableRandomishNoise || to.enableRandomishNoise) : to.enableRandomishNoise,
      randomishAmount: mix(from.randomishAmount, to.randomishAmount),
      enableSineNoise: t < 1 ? (from.enableSineNoise || to.enableSineNoise) : to.enableSineNoise,
      sineAmount: mix(from.sineAmount, to.sineAmount),
      sineScale: mix(from.sineScale, to.sineScale),
      sineSpeed: mix(from.sineSpeed, to.sineSpeed),
      randomishSpeed: mix(from.randomishSpeed, to.randomishSpeed),
      pulseSize: mix(from.pulseSize, to.pulseSize),
      enableSpin: t < 1 ? (from.enableSpin || to.enableSpin) : to.enableSpin,
      spinSpeed: mix(from.spinSpeed, to.spinSpeed),
      spinAxisX: mix(from.spinAxisX, to.spinAxisX),
      spinAxisY: mix(from.spinAxisY, to.spinAxisY),
      maskEnabled: t < 1 ? (from.maskEnabled || to.maskEnabled) : to.maskEnabled,
      maskRadius: mix(from.maskRadius, to.maskRadius),
      maskFeather: mix(from.maskFeather, to.maskFeather),
      randomishMicModAmount: mix(from.randomishMicModAmount, to.randomishMicModAmount),
      sineMicModAmount: mix(from.sineMicModAmount, to.sineMicModAmount),
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tween]);

  // Animation loop to update tween.current when transition ends
  useEffect(() => {
    let raf = 0;
    const step = () => {
      const t = (performance.now() - tween.start) / tween.duration;
      if (t >= 1 && tween.current !== tween.target) setTween((s) => ({ ...s, current: s.target }));
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [tween]);

  const containerRef = useRef<HTMLDivElement | null>(null);

  return (
    <div ref={containerRef} className="fixed inset-0">
      <Canvas gl={{ antialias: true }} camera={{ fov: 60, position: [0, 0, 2.6] }}>
        <ambientLight intensity={0.2} />
        <group position={[0, 0, 0]}> 
          <SphereWaveform
            volume={volume}
            size={1.0}
            vertexCount={480}
            pointSize={0.04}
            shellCount={1}
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
            pointColor="#ffffff"
            glowColor="#ffffff"
            glowStrength={0.0}
            glowRadiusFactor={0}
            enableGradient={false}
            gradientColor2="#ffffff"
            gradientAngle={0}
            randomishMicModAmount={configNow.randomishMicModAmount}
            sineMicModAmount={configNow.sineMicModAmount}
          />
        </group>
      </Canvas>
    </div>
  );
}

export default Visualizer;


