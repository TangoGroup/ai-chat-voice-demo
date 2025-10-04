export type VoiceState = "passive" | "listening" | "thinking" | "speaking";

export interface StateConfig {
  // subset of SphereWaveformProps we intend to animate
  enableRandomishNoise: boolean;
  randomishAmount: number;
  enableSineNoise: boolean;
  sineAmount: number;
  sineScale: number;
  sineSpeed: number;
  randomishSpeed: number;
  pulseSize: number;
  enableSpin: boolean;
  spinSpeed: number;
  spinAxisX: number;
  spinAxisY: number;
  maskEnabled: boolean;
  maskRadius: number;
  maskFeather: number;
  // mic modulation knobs
  randomishMicModAmount: number;
  sineMicModAmount: number;
  // global size/opacity mapping for 62% viewport feel will be handled by Canvas/camera, size kept 1
}

export const BASE_PERSISTENT = {
  // High scale stays constant across states per requirements
  // We implement high "scale value" by using higher sineScale / surface dynamics
} as const;

export const STATE_CONFIGS: Record<VoiceState, StateConfig> = {
  passive: {
    enableRandomishNoise: true,
    randomishAmount: 0.2,
    enableSineNoise: false,
    sineAmount: 0.0,
    sineScale: 1.2,
    sineSpeed: 0.6,
    randomishSpeed: 0.6,
    pulseSize: 0.35,
    enableSpin: false,
    spinSpeed: 0.0,
    spinAxisX: 0,
    spinAxisY: 0,
    maskEnabled: false,
    maskRadius: 0.7,
    maskFeather: 0.15,
    randomishMicModAmount: 0.0,
    sineMicModAmount: 0.0,
  },
  listening: {
    enableRandomishNoise: false,
    randomishAmount: 0.0,
    enableSineNoise: true,
    sineAmount: 0.45,
    sineScale: 0.6,
    sineSpeed: 1.8,
    randomishSpeed: 1.2,
    pulseSize: 0.55,
    enableSpin: false,
    spinSpeed: 0.0,
    spinAxisX: 0,
    spinAxisY: 0,
    maskEnabled: false,
    maskRadius: 0.7,
    maskFeather: 0.15,
    randomishMicModAmount: 0.0,
    sineMicModAmount: 0.9,
  },
  thinking: {
    enableRandomishNoise: false,
    randomishAmount: 0.0,
    enableSineNoise: true,
    sineAmount: 0.8,
    sineScale: 1.6,
    sineSpeed: 1.2,
    randomishSpeed: 1.0,
    pulseSize: 0.7,
    enableSpin: true,
    spinSpeed: 0.6,
    spinAxisX: 0,
    spinAxisY: 25,
    maskEnabled: true,
    maskRadius: 0.85,
    maskFeather: 0.2,
    randomishMicModAmount: 0.0,
    sineMicModAmount: 0.0,
  },
  speaking: {
    enableRandomishNoise: true,
    randomishAmount: 0.65,
    enableSineNoise: false,
    sineAmount: 0.0,
    sineScale: 1.2,
    sineSpeed: 1.2,
    randomishSpeed: 1.6,
    pulseSize: 0.8,
    enableSpin: false,
    spinSpeed: 0.0,
    spinAxisX: 0,
    spinAxisY: 0,
    maskEnabled: false,
    maskRadius: 0.7,
    maskFeather: 0.15,
    randomishMicModAmount: 0.9,
    sineMicModAmount: 0.0,
  },
};

export const TRANSITION_MS = 600;


