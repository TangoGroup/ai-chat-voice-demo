export type VoiceState = 'passive' | 'listening' | 'thinking' | 'speaking';

interface VisualizerConfig {
  // Schema version
  version: 24;

  // Global controls
  vertexCount: number;
  pointSize: number;
  shellCount: number;
  volume: number;

  // Global transform and presentation
  size: number; // overall scene scale multiplier
  opacity: number; // 0..1 global alpha multiplier
  rotationX: number; // degrees
  rotationY: number; // degrees
  rotationZ: number; // degrees

  // Effect toggles
  enableSpin: boolean;

  // Effect parameters
  spinSpeed: number;
  pulseSize: number;
  spinAxisX: number;
  spinAxisY: number;

  // Screen-space circular gradient mask controls
  maskEnabled: boolean;
  maskRadius: number; // 0..1 relative to half min(screenW, screenH)
  maskFeather: number; // 0..1 relative to half min(screenW, screenH)
  maskInvert: boolean;

  // Composable noise controls
  enableRandomishNoise: boolean;
  randomishAmount: number; // 0..1 weight
  enableSineNoise: boolean;
  sineAmount: number; // 0..1 weight
  randomishSpeed: number;
  sineSpeed: number;
  sineScale: number;

  // Appearance
  pointColor: string; // hex color, e.g. '#ffffff'
  glowColor: string; // hex color for glow contribution
  glowRadiusFactor: number; // 0..2, per-side thickness as multiple of core radius
  shellPhaseJitter: number; // 0..2; per-shell temporal offset magnitude
  backgroundTheme: 'dark' | 'light';
  sizeRandomness: number; // 0..1
  glowStrength: number; // 0..3
  glowRadiusPx: number; // 0..10
  glowSoftness: number; // 0..1

  // Gradient coloring across dots
  enableGradient: boolean;
  gradientColor2: string; // hex color
  gradientAngle: number; // degrees 0..360, direction in XY plane

  // Microphone
  micVolume: number; // 1..5
  micEnabled: boolean;
  micSmoothing: number; // 0..0.98
  micAffectsGlobal: boolean; // If true, mic multiplies global effect power

  // Ripple noise (surface XY)
  enableRippleNoise: boolean;
  rippleAmount: number; // 0..1
  rippleSpeed: number; // 0.1..10
  rippleScale: number; // 0.1..10

  // Surface ripple (tangent displacement)
  enableSurfaceRipple: boolean;
  surfaceRippleAmount: number; // 0..1
  surfaceRippleSpeed: number; // 0.1..10
  surfaceRippleScale: number; // 0.1..10

  // Arc ejections (great-circle segments)
  enableArcs: boolean;
  arcMaxCount: number; // 0..8
  arcSpawnRate: number; // arcs per second
  arcDuration: number; // seconds
  arcSpeed: number; // radians per second
  arcSpanDeg: number; // degrees of visible arc segment
  arcThickness: number; // 0..0.25 (plane distance threshold)
  arcFeather: number; // 0..0.25 (soften edges)
  arcBrightness: number; // 0..3 multiplier for alpha/color
  arcAltitude: number; // 0..0.2 radial puff amount

  // Debug controls
  freezeTime: boolean;
  advanceCount: number;

  // Modulation amounts (mic → effect)
  randomishMicModAmount: number; // 0..1
  sineMicModAmount: number; // 0..1
  rippleMicModAmount: number; // 0..1
  surfaceRippleMicModAmount: number; // 0..1
}

export type StateConfig = Partial<VisualizerConfig>;

export const BASE_PERSISTENT = {
  // High scale stays constant across states per requirements
  // We implement high "scale value" by using higher sineScale / surface dynamics
} as const;

export const STATE_CONFIGS: Record<VoiceState, StateConfig> = {
  passive: {
    vertexCount: 1200,
    pointSize: 0.016,
    shellCount: 1,
    volume: 0.2,
    enableSpin: true,
    spinSpeed: 0.05,
    pulseSize: 10,
    spinAxisX: 24,
    spinAxisY: 35,
    maskEnabled: false,
    maskRadius: 0.5,
    maskFeather: 0.2,
    maskInvert: false,
    enableRandomishNoise: true,
    randomishAmount: 0,
    randomishMicModAmount: 0,
    enableSineNoise: true,
    sineAmount: 0.11,
    randomishSpeed: 3.8999999999999995,
    sineSpeed: 6.7,
    sineScale: 0.1,
    sineMicModAmount: 0,
    pointColor: '#171717',
    micVolume: 0,
    micEnabled: false,
    micSmoothing: 0.8,
    enableRippleNoise: true,
    rippleAmount: 0,
    rippleSpeed: 0.1,
    rippleScale: 0.1,
    freezeTime: false,
    advanceCount: 18,
    enableSurfaceRipple: true,
    surfaceRippleAmount: 0,
    surfaceRippleSpeed: 10,
    surfaceRippleScale: 4,
    enableArcs: false,
    arcMaxCount: 0,
    arcSpawnRate: 2,
    arcDuration: 10,
    arcSpeed: 1.5,
    arcSpanDeg: 180,
    arcThickness: 0.05,
    arcFeather: 0.095,
    arcBrightness: 1,
    arcAltitude: 0.18,
    backgroundTheme: 'light',
    size: 1,
    opacity: 1,
    rotationX: 0,
    rotationY: 0,
    rotationZ: 0,
    sizeRandomness: 0,
    glowStrength: 0,
    glowColor: '#ffffff',
    glowRadiusPx: 0,
    glowRadiusFactor: 0,
    glowSoftness: 0,
  },
  listening: {
    vertexCount: 1200,
    pointSize: 0.016,
    shellCount: 1,
    volume: 0.2,
    enableSpin: true,
    spinSpeed: 0.05,
    pulseSize: 10,
    spinAxisX: 24,
    spinAxisY: 35,
    maskEnabled: false,
    maskRadius: 0.5,
    maskFeather: 0.2,
    maskInvert: false,
    enableRandomishNoise: true,
    randomishAmount: 0,
    enableSineNoise: true,
    sineAmount: 0.44,
    randomishSpeed: 3.8999999999999995,
    sineSpeed: 6.7,
    sineScale: 3.1,
    pointColor: '#171717',
    micVolume: 3.4,
    micEnabled: true,
    micSmoothing: 0.98,
    enableRippleNoise: true,
    rippleAmount: 0,
    rippleSpeed: 0.1,
    rippleScale: 0.1,
    freezeTime: false,
    advanceCount: 18,
    enableSurfaceRipple: true,
    surfaceRippleAmount: 0,
    surfaceRippleSpeed: 10,
    surfaceRippleScale: 4,
    enableArcs: false,
    arcMaxCount: 0,
    arcSpawnRate: 2,
    arcDuration: 10,
    arcSpeed: 1.5,
    arcSpanDeg: 180,
    arcThickness: 0.05,
    arcFeather: 0.095,
    arcBrightness: 1,
    arcAltitude: 0.18,
    backgroundTheme: 'light',
    size: 1,
    opacity: 1,
    rotationX: 0,
    rotationY: 0,
    rotationZ: 0,
    sizeRandomness: 0,
    glowStrength: 0,
    glowColor: '#ffffff',
    glowRadiusPx: 0,
    glowRadiusFactor: 0,
    glowSoftness: 0,
  },
  thinking: {
    vertexCount: 1200,
    pointSize: 0.016,
    shellCount: 1,
    volume: 0.2,
    enableSpin: true,
    spinSpeed: 1,
    pulseSize: 10,
    spinAxisX: 47,
    spinAxisY: 35,
    maskEnabled: false,
    maskRadius: 0.5,
    maskFeather: 0.2,
    maskInvert: false,
    enableRandomishNoise: true,
    randomishAmount: 0,
    enableSineNoise: true,
    sineAmount: 0.11,
    randomishSpeed: 3.8999999999999995,
    sineSpeed: 6.7,
    sineScale: 0.1,
    pointColor: '#171717',
    micVolume: 1,
    micEnabled: true,
    micSmoothing: 0.8,
    enableRippleNoise: true,
    rippleAmount: 0,
    rippleSpeed: 0.1,
    rippleScale: 0.1,
    freezeTime: false,
    advanceCount: 18,
    enableSurfaceRipple: true,
    surfaceRippleAmount: 0.05,
    surfaceRippleSpeed: 10,
    surfaceRippleScale: 4,
    enableArcs: false,
    arcMaxCount: 0,
    arcSpawnRate: 2,
    arcDuration: 10,
    arcSpeed: 1.5,
    arcSpanDeg: 180,
    arcThickness: 0.05,
    arcFeather: 0.095,
    arcBrightness: 1,
    arcAltitude: 0.18,
    backgroundTheme: 'light',
    size: 0.72,
    opacity: 1,
    rotationX: 0,
    rotationY: 0,
    rotationZ: 0,
    sizeRandomness: 0,
    glowStrength: 0,
    glowColor: '#ffffff',
    glowRadiusPx: 0,
    glowRadiusFactor: 0,
    glowSoftness: 0,
    randomishMicModAmount: 1,
  },
  speaking: {
    vertexCount: 1200,
    pointSize: 0.016,
    shellCount: 1,
    volume: 0.2,
    enableSpin: true,
    spinSpeed: 0.05,
    pulseSize: 9.4,
    spinAxisX: 24,
    spinAxisY: 35,
    maskEnabled: false,
    maskRadius: 0.5,
    maskFeather: 0.2,
    maskInvert: false,
    enableRandomishNoise: true,
    randomishAmount: 0.08,
    enableSineNoise: true,
    sineAmount: 0,
    randomishSpeed: 3.8999999999999995,
    sineSpeed: 6.7,
    sineScale: 4,
    pointColor: '#171717',
    micVolume: 3.4,
    micEnabled: true,
    micSmoothing: 0.98,
    enableRippleNoise: true,
    rippleAmount: 0,
    rippleSpeed: 0.1,
    rippleScale: 0.1,
    freezeTime: false,
    advanceCount: 18,
    enableSurfaceRipple: true,
    surfaceRippleAmount: 0,
    surfaceRippleSpeed: 10,
    surfaceRippleScale: 4,
    enableArcs: false,
    arcMaxCount: 0,
    arcSpawnRate: 2,
    arcDuration: 10,
    arcSpeed: 1.5,
    arcSpanDeg: 180,
    arcThickness: 0.05,
    arcFeather: 0.095,
    arcBrightness: 1,
    arcAltitude: 0.18,
    backgroundTheme: 'light',
    size: 1,
    opacity: 1,
    rotationX: 0,
    rotationY: 0,
    rotationZ: 0,
    sizeRandomness: 0,
    glowStrength: 0,
    glowColor: '#ffffff',
    glowRadiusPx: 0,
    glowRadiusFactor: 0,
    glowSoftness: 0,
    randomishMicModAmount: 0,
    sineMicModAmount: 0.93,
  },
};

export const TRANSITION_MS = 600;
