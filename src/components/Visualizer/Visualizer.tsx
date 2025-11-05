"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { Canvas } from "@react-three/fiber";
import { SphereWaveform, useMorphAnimator, type WaveformConfig } from "dot-sphere-visualizer";
import { STATE_CONFIGS, TRANSITION_MS, type VoiceState } from "./stateConfigs";
import { useMicAnalyzer } from "./useMicAnalyzer";
import { useTheme } from "@/components/Theme/ThemeProvider";

export function Visualizer({ voiceState, inputStream }: { voiceState: VoiceState; inputStream?: MediaStream }) {
  const { volume, start: startMic, isActive, error } = useMicAnalyzer({ smoothingTimeConstant: 0.8, fftSize: 1024, inputStream });
  const { theme } = useTheme();
  const hasStartedRef = useRef<boolean>(false);

  // Global mic start on mount (only once)
  useEffect(() => {
    if (!hasStartedRef.current && !isActive) {
      hasStartedRef.current = true;
      void startMic();
    }
  }, [startMic, isActive]);

  // Current config state - this is the source of truth (as per README pattern)
  const [currentConfig, setCurrentConfig] = useState<WaveformConfig>(STATE_CONFIGS[voiceState]);
  const currentConfigRef = useRef<WaveformConfig>(STATE_CONFIGS[voiceState]);
  const targetStateRef = useRef<VoiceState>(voiceState);

  // Keep ref in sync with state
  useEffect(() => {
    currentConfigRef.current = currentConfig;
  }, [currentConfig]);

  // Use the package's morph animator
  const { morph, play } = useMorphAnimator({
    ease: 'power2.inOut',
    onComplete: (finalConfig: WaveformConfig) => {
      // Update the config state when animation completes (as per README pattern)
      setCurrentConfig(finalConfig);
    },
  });

  // Handle state changes and trigger morphing
  useEffect(() => {
    const targetConfig = STATE_CONFIGS[voiceState];
    // Only animate if state actually changed (compare against ref, not currentConfig)
    if (targetStateRef.current !== voiceState) {
      targetStateRef.current = voiceState;
      play({
        duration: TRANSITION_MS / 1000, // convert to seconds
        to: targetConfig
      }, currentConfigRef.current); // Use ref to avoid stale closure
    }
  }, [voiceState, play]); // Removed currentConfig from deps to prevent loop

  // Theme-based color overrides
  const displayPointColor = useMemo(() => (theme === "dark" ? "#ffffff" : "#171717"), [theme]);
  const displayGlowColor = useMemo(() => (theme === "dark" ? "#ffffff" : "#171717"), [theme]);

  // Use mic volume directly as per README pattern
  const visualVolume = Math.max(0, Math.min(1, (currentConfig?.volume ?? 0) + volume));

  return (
    <div className="fixed inset-0">
      <Canvas gl={{ antialias: true }} camera={{ fov: 60, position: [0, 0, 2.6] }}>
        <ambientLight intensity={0.2} />
        <group position={[0, 0, 0]}>
          <SphereWaveform
            morph={morph}
            {...currentConfig}
            volume={visualVolume}
            pointColor={displayPointColor}
            glowColor={displayGlowColor}
            micEnvelope={volume}
            seed={1}
          />
        </group>
      </Canvas>
    </div>
  );
}

export default Visualizer;


