"use client";
import { useMemo, useRef } from "react";
import * as THREE from "three";
import { useFrame } from "@react-three/fiber";
import { generateFibonacciSpherePoints } from "./fibonacciSphere";

export interface SphereWaveformProps {
  vertexCount?: number;
  volume: number;
  radius?: number;
  pointSize?: number;
  shellCount?: number;
  seed?: number;
  freezeTime?: boolean;
  advanceCount?: number;
  advanceAmount?: number;
  size?: number;
  opacity?: number;
  rotationX?: number;
  rotationY?: number;
  rotationZ?: number;
  enableRandomishNoise?: boolean;
  randomishAmount?: number;
  enableSineNoise?: boolean;
  sineAmount?: number;
  randomishSpeed?: number;
  pulseSize?: number;
  enableRippleNoise?: boolean;
  rippleAmount?: number;
  rippleSpeed?: number;
  rippleScale?: number;
  enableSurfaceRipple?: boolean;
  surfaceRippleAmount?: number;
  surfaceRippleSpeed?: number;
  surfaceRippleScale?: number;
  enableSpin?: boolean;
  spinSpeed?: number;
  spinAxisX?: number;
  spinAxisY?: number;
  maskEnabled?: boolean;
  maskRadius?: number;
  maskFeather?: number;
  maskInvert?: boolean;
  sineSpeed?: number;
  sineScale?: number;
  pointColor?: string;
  glowColor?: string;
  glowStrength?: number;
  glowRadiusFactor?: number;
  enableGradient?: boolean;
  gradientColor2?: string;
  gradientAngle?: number;
  sizeRandomness?: number;
  enableArcs?: boolean;
  arcMaxCount?: number;
  arcSpawnRate?: number;
  arcDuration?: number;
  arcSpeed?: number;
  arcSpanDeg?: number;
  arcThickness?: number;
  arcFeather?: number;
  arcBrightness?: number;
  arcAltitude?: number;
  micEnvelope?: number;
  randomishMicModAmount?: number;
  sineMicModAmount?: number;
  rippleMicModAmount?: number;
  surfaceRippleMicModAmount?: number;
}

type NumericUniform = { value: number };
type ColorUniform = { value: THREE.Color };
type Vec2Uniform = { value: THREE.Vector2 };
type Vec3Uniform = { value: THREE.Vector3 };
type FloatArrayUniform = { value: Float32Array };

interface Uniforms {
  uTime: NumericUniform;
  uVolume: NumericUniform;
  uRadius: NumericUniform;
  uPointSize: NumericUniform;
  uPixelRatio: NumericUniform;
  uViewportWidth: NumericUniform;
  uViewportHeight: NumericUniform;
  uFov: NumericUniform;
  uShellPhase: NumericUniform;
  uSizeRandomness: NumericUniform;
  uEnableRandomish: NumericUniform;
  uRandomishAmount: NumericUniform;
  uEnableSine: NumericUniform;
  uSineAmount: NumericUniform;
  uRandomishSpeed: NumericUniform;
  uPulseSize: NumericUniform;
  uOpacity: NumericUniform;
  uEnableRipple: NumericUniform;
  uRippleAmount: NumericUniform;
  uRippleSpeed: NumericUniform;
  uRippleScale: NumericUniform;
  uEnableSurfaceRipple: NumericUniform;
  uSurfaceRippleAmount: NumericUniform;
  uSurfaceRippleSpeed: NumericUniform;
  uSurfaceRippleScale: NumericUniform;
  uSurfaceCenter: Vec3Uniform;
  uEnableSpin: NumericUniform;
  uSpinSpeed: NumericUniform;
  uSpinAxisX: NumericUniform;
  uSpinAxisY: NumericUniform;
  uMaskEnabled: NumericUniform;
  uMaskRadiusPx: NumericUniform;
  uMaskFeatherPx: NumericUniform;
  uMaskInvert: NumericUniform;
  uMaskCenterNdc: Vec2Uniform;
  uSineSpeed: NumericUniform;
  uSineScale: NumericUniform;
  uColor: ColorUniform;
  uColor2: ColorUniform;
  uEnableGradient: NumericUniform;
  uGradientAngle: NumericUniform;
  uGlowColor: ColorUniform;
  uGlowStrength: NumericUniform;
  uGlowRadiusFactor: NumericUniform;
  uExpandHalo: NumericUniform;
  uArcsActive: NumericUniform;
  uArcCenters: FloatArrayUniform;
  uArcTangents: FloatArrayUniform;
  uArcT0: FloatArrayUniform;
  uArcDur: FloatArrayUniform;
  uArcSpeed: FloatArrayUniform;
  uArcSpan: FloatArrayUniform;
  uArcThick: FloatArrayUniform;
  uArcFeather: FloatArrayUniform;
  uArcBright: FloatArrayUniform;
  uArcAltitude: NumericUniform;
}

type UniformParams = Required<Pick<
  SphereWaveformProps,
  | "radius"
  | "pointSize"
  | "sizeRandomness"
  | "enableRandomishNoise"
  | "randomishAmount"
  | "enableSineNoise"
  | "sineAmount"
  | "randomishSpeed"
  | "pulseSize"
  | "opacity"
  | "enableRippleNoise"
  | "rippleAmount"
  | "rippleSpeed"
  | "rippleScale"
  | "enableSurfaceRipple"
  | "surfaceRippleAmount"
  | "surfaceRippleSpeed"
  | "surfaceRippleScale"
  | "enableSpin"
  | "spinSpeed"
  | "spinAxisX"
  | "spinAxisY"
  | "maskEnabled"
  | "maskFeather"
  | "maskInvert"
  | "sineSpeed"
  | "sineScale"
  | "pointColor"
  | "glowColor"
  | "glowStrength"
  | "glowRadiusFactor"
  | "enableGradient"
  | "gradientColor2"
  | "arcAltitude"
  | "gradientAngle"
>> & { seed: number };

// Uniforms interface defined above

function makeUniforms(params: UniformParams) {
  return {
    uTime: { value: 0 },
    uVolume: { value: 0 },
    uRadius: { value: params.radius },
    uPointSize: { value: params.pointSize },
    uPixelRatio: { value: Math.min(typeof window !== "undefined" ? window.devicePixelRatio : 1, 2) },
    uViewportWidth: { value: typeof window !== "undefined" ? window.innerWidth : 0 },
    uViewportHeight: { value: typeof window !== "undefined" ? window.innerHeight : 0 },
    uFov: { value: (60 * Math.PI) / 180 },
    uShellPhase: { value: 0 },
    uSizeRandomness: { value: params.sizeRandomness },
    uEnableRandomish: { value: params.enableRandomishNoise ? 1 : 0 },
    uRandomishAmount: { value: params.randomishAmount },
    uEnableSine: { value: params.enableSineNoise ? 1 : 0 },
    uSineAmount: { value: params.sineAmount },
    uRandomishSpeed: { value: params.randomishSpeed },
    uPulseSize: { value: params.pulseSize },
    uOpacity: { value: 1 },
    uEnableRipple: { value: params.enableRippleNoise ? 1 : 0 },
    uRippleAmount: { value: params.rippleAmount },
    uRippleSpeed: { value: params.rippleSpeed },
    uRippleScale: { value: params.rippleScale },
    uEnableSurfaceRipple: { value: params.enableSurfaceRipple ? 1 : 0 },
    uSurfaceRippleAmount: { value: params.surfaceRippleAmount },
    uSurfaceRippleSpeed: { value: params.surfaceRippleSpeed },
    uSurfaceRippleScale: { value: params.surfaceRippleScale },
    uSurfaceCenter: { value: new THREE.Vector3(0, 0, 1) },
    uEnableSpin: { value: params.enableSpin ? 1 : 0 },
    uSpinSpeed: { value: params.spinSpeed },
    uSpinAxisX: { value: params.spinAxisX },
    uSpinAxisY: { value: params.spinAxisY },
    uMaskEnabled: { value: params.maskEnabled ? 1 : 0 },
    uMaskRadiusPx: { value: 0 },
    uMaskFeatherPx: { value: 0 },
    uMaskInvert: { value: 0 },
    uMaskCenterNdc: { value: new THREE.Vector2(0, 0) },
    uSineSpeed: { value: params.sineSpeed },
    uSineScale: { value: params.sineScale },
    uColor: { value: new THREE.Color(params.pointColor) },
    uColor2: { value: new THREE.Color(params.gradientColor2) },
    uEnableGradient: { value: params.enableGradient ? 1 : 0 },
    uGradientAngle: { value: THREE.MathUtils.degToRad(params.gradientAngle) },
    uGlowColor: { value: new THREE.Color(params.glowColor) },
    uGlowStrength: { value: params.glowStrength },
    uGlowRadiusFactor: { value: params.glowRadiusFactor },
    uExpandHalo: { value: 1 },
    uArcsActive: { value: 0 },
    uArcCenters: { value: new Float32Array(8 * 3) },
    uArcTangents: { value: new Float32Array(8 * 3) },
    uArcT0: { value: new Float32Array(8) },
    uArcDur: { value: new Float32Array(8) },
    uArcSpeed: { value: new Float32Array(8) },
    uArcSpan: { value: new Float32Array(8) },
    uArcThick: { value: new Float32Array(8) },
    uArcFeather: { value: new Float32Array(8) },
    uArcBright: { value: new Float32Array(8) },
    uArcAltitude: { value: params.arcAltitude },
  } satisfies Uniforms;
}

const vertexShader = `
precision highp float;
attribute float aSeed;
uniform float uTime; uniform float uVolume; uniform float uRadius; uniform float uPointSize; uniform float uPixelRatio; uniform float uViewportWidth; uniform float uViewportHeight; uniform float uFov; uniform float uShellPhase; uniform float uSizeRandomness; uniform float uGlowRadiusFactor; uniform int uEnableRandomish; uniform float uRandomishAmount; uniform int uEnableSine; uniform float uSineAmount; uniform float uRandomishSpeed; uniform float uSineSpeed; uniform float uSineScale; uniform float uPulseSize; uniform int uEnableRipple; uniform float uRippleAmount; uniform float uRippleSpeed; uniform float uRippleScale; uniform int uEnableSurfaceRipple; uniform float uSurfaceRippleAmount; uniform float uSurfaceRippleSpeed; uniform float uSurfaceRippleScale; uniform vec3 uSurfaceCenter; const int MAX_ARCS = 8; uniform int uArcsActive; uniform vec3 uArcCenters[MAX_ARCS]; uniform vec3 uArcTangents[MAX_ARCS]; uniform float uArcT0[MAX_ARCS]; uniform float uArcDur[MAX_ARCS]; uniform float uArcSpeed[MAX_ARCS]; uniform float uArcSpan[MAX_ARCS]; uniform float uArcThick[MAX_ARCS]; uniform float uArcFeather[MAX_ARCS]; uniform float uArcBright[MAX_ARCS]; uniform float uArcAltitude; uniform int uEnableSpin; uniform float uSpinSpeed; uniform float uSpinAxisX; uniform float uSpinAxisY; uniform int uEnableGradient; uniform float uGradientAngle; varying vec2 vNdc; varying float vArcBoost; varying float vSizeRand; varying float vCoreRadiusNorm; varying float vGradT; float hash(float n){return fract(sin(n)*43758.5453);} float hash3(vec3 p){return hash(dot(p, vec3(127.1,311.7,74.7)));} float smoothNoise(vec3 p){ vec3 i=floor(p); vec3 f=fract(p); f=f*f*(3.0-2.0*f); float a=hash3(i); float b=hash3(i+vec3(1.0,0.0,0.0)); float c=hash3(i+vec3(0.0,1.0,0.0)); float d=hash3(i+vec3(1.0,1.0,0.0)); float e=hash3(i+vec3(0.0,0.0,1.0)); float f1=hash3(i+vec3(1.0,0.0,1.0)); float g=hash3(i+vec3(0.0,1.0,1.0)); float h=hash3(i+vec3(1.0,1.0,1.0)); return mix( mix(mix(a,b,f.x), mix(c,d,f.x), f.y), mix(mix(e,f1,f.x), mix(g,h,f.x), f.y), f.z ); }
void main(){ vec3 initialBase=normalize(position); vec3 base=initialBase; if(uEnableSpin>0){ float spinAngle=uTime*uSpinSpeed; float xRad=radians(uSpinAxisX); float yRad=radians(uSpinAxisY); vec3 axis=normalize(vec3(sin(yRad), sin(xRad), cos(xRad)*cos(yRad))); float c=cos(spinAngle); float s=sin(spinAngle); float omc=1.0-c; mat3 R=mat3( axis.x*axis.x*omc+c, axis.x*axis.y*omc-axis.z*s, axis.x*axis.z*omc+axis.y*s, axis.y*axis.x*omc+axis.z*s, axis.y*axis.y*omc+c, axis.y*axis.z*omc-axis.x*s, axis.z*axis.x*omc-axis.y*s, axis.z*axis.y*omc+axis.x*s, axis.z*axis.z*omc+c ); base=R*base; }
 float t=uTime*0.4+uShellPhase; float nRandomish=0.0; if(uEnableRandomish>0){ float spatialScale=mix(0.5,10.0,uPulseSize); float tR=t*uRandomishSpeed; vec3 p=base*spatialScale+vec3(aSeed*0.1,aSeed*0.2,tR); nRandomish=(smoothNoise(p)*2.0-1.0)*uRandomishAmount; } float nSine=0.0; if(uEnableSine>0){ nSine=sin(t*uSineSpeed + aSeed*6.2831853*uSineScale)*uSineAmount; } float nRipple=0.0; if(uEnableRipple>0){ float tR=t*uRippleSpeed; float longitude=atan(base.y, base.x); float wave=sin(longitude*uRippleScale - tR); nRipple=wave*uRippleAmount; } vec3 tangentDisplaced=vec3(0.0); if(uEnableSurfaceRipple>0){ vec3 N=normalize(base); float angle=acos(clamp(dot(N, normalize(uSurfaceCenter)), -1.0, 1.0)); float phase=angle*uSurfaceRippleScale - t*uSurfaceRippleSpeed; float wave=sin(phase); vec3 toCenterTangent=normalize(uSurfaceCenter - dot(uSurfaceCenter,N)*N); if(!all(greaterThan(abs(toCenterTangent), vec3(1e-6)))){ vec3 alt=vec3(1.0,0.0,0.0); toCenterTangent=normalize(cross(N, cross(alt,N))); } vec3 offset=toCenterTangent*(wave*uSurfaceRippleAmount*0.25); vec3 surf=normalize(base+offset); tangentDisplaced=surf-base; }
 float n=nRandomish + nSine + nRipple; float radialFactor=1.0 + n*clamp(uVolume,0.0,1.0); radialFactor=clamp(radialFactor,0.0,2.5); vec3 displaced=(base + tangentDisplaced) * (uRadius * radialFactor);
 vArcBoost=0.0; for(int i=0;i<MAX_ARCS;i++){}
 vec4 mvPosition=modelViewMatrix*vec4(displaced,1.0); gl_Position=projectionMatrix*mvPosition; vNdc=gl_Position.xy/gl_Position.w; float scale=uViewportHeight/(2.0*tan(uFov*0.5)); float rand01=hash(aSeed); float sizeFactor=mix(1.0, rand01*2.0, clamp(uSizeRandomness,0.0,1.0)); vSizeRand=sizeFactor; float basePx=(uPointSize*sizeFactor)*uPixelRatio*scale/-mvPosition.z; float haloPx=max(0.0, uGlowRadiusFactor)*basePx; float expanded=basePx + 2.0*haloPx; vCoreRadiusNorm=(expanded>0.0)?clamp(basePx/expanded,0.0,1.0):1.0; gl_PointSize=clamp(expanded,0.0,2048.0); if(uEnableGradient>0){ float ang=uGradientAngle; vec3 dir3=normalize(vec3(cos(ang),0.0,sin(ang))); float proj=dot(normalize(initialBase), dir3); vGradT=clamp(proj*0.5+0.5,0.0,1.0);} else { vGradT=0.0; } }
`;

const fragmentShader = `
precision highp float; uniform float uViewportWidth; uniform float uViewportHeight; uniform int uMaskEnabled; uniform float uMaskRadiusPx; uniform float uMaskFeatherPx; uniform int uMaskInvert; uniform vec2 uMaskCenterNdc; uniform vec3 uColor; uniform vec3 uColor2; uniform int uEnableGradient; uniform float uOpacity; uniform vec3 uGlowColor; uniform float uGlowStrength; varying vec2 vNdc; varying float vArcBoost; varying float vSizeRand; varying float vCoreRadiusNorm; varying float vGradT; void main(){ vec2 uv=gl_PointCoord*2.0-1.0; float r2=dot(uv,uv); float r=sqrt(r2); if(r>1.0){ discard; } float alpha=1.0 - smoothstep(vCoreRadiusNorm, vCoreRadiusNorm+0.05, r); float screenMask=1.0; if(uMaskEnabled>0){ vec2 deltaPx=vec2((vNdc.x - uMaskCenterNdc.x) * 0.5 * uViewportWidth, (vNdc.y - uMaskCenterNdc.y) * 0.5 * uViewportHeight); float distPx=length(deltaPx); float inside = 1.0 - smoothstep(uMaskRadiusPx, uMaskRadiusPx + max(0.0001, uMaskFeatherPx), distPx); screenMask = (uMaskInvert>0) ? (1.0 - inside) : inside; alpha *= clamp(screenMask, 0.0, 1.0); } alpha *= min(3.0, 1.0 + vArcBoost); alpha *= clamp(uOpacity, 0.0, 1.0); float inner=vCoreRadiusNorm; float end=mix(inner,1.0,0.3); float ring=1.0 - smoothstep(inner, end, r); float emission=ring * clamp(uGlowStrength,0.0,3.0); vec3 baseColor=(uEnableGradient>0)? mix(uColor, uColor2, clamp(vGradT,0.0,1.0)) : uColor; vec3 color=(baseColor + uGlowColor * emission * 0.4) * screenMask; gl_FragColor=vec4(color, alpha); }
`;

export function SphereWaveform(props: SphereWaveformProps) {
  const {
    vertexCount = 400,
    volume,
    radius = 1,
    pointSize = 0.04,
    shellCount = 1,
    seed = 1,
    freezeTime = false,
    advanceCount = 0,
    advanceAmount = 1 / 60,
    size = 1,
    opacity = 1,
    rotationX = 0,
    rotationY = 0,
    rotationZ = 0,
    enableRandomishNoise = true,
    randomishAmount = 1,
    enableSineNoise = false,
    sineAmount = 0,
    pulseSize = 1,
    enableSpin = false,
    spinSpeed = 0.35,
    randomishSpeed = 1.8,
    enableRippleNoise = false,
    rippleAmount = 0.0,
    rippleSpeed = 1.5,
    rippleScale = 3.0,
    enableSurfaceRipple = false,
    surfaceRippleAmount = 0.0,
    surfaceRippleSpeed = 1.5,
    surfaceRippleScale = 3.0,
    spinAxisX = 0,
    spinAxisY = 0,
    maskEnabled = false,
    maskRadius = 0.5,
    maskFeather = 0.2,
    maskInvert = false,
    sineSpeed = 1.7,
    sineScale = 1.0,
    pointColor = "#ffffff",
    glowColor = "#ffffff",
    glowStrength = 0.0,
    glowRadiusFactor = 0,
    enableGradient = false,
    gradientColor2 = "#ffffff",
    gradientAngle = 0,
    sizeRandomness = 0.0,
    enableArcs = false,
    arcMaxCount = 4,
    arcSpawnRate = 0.25,
    arcDuration = 4.0,
    arcSpeed = 1.5,
    arcSpanDeg = 60,
    arcThickness = 0.06,
    arcFeather = 0.04,
    arcBrightness = 1.0,
    arcAltitude = 0.02,
    micEnvelope = 0,
    randomishMicModAmount = 0,
    sineMicModAmount = 0,
    rippleMicModAmount = 0,
    surfaceRippleMicModAmount = 0,
  } = props;

  const uniformsRef = useRef<Uniforms[] | null>(null);
  const prevNowRef = useRef<number | null>(null);
  const timeAccRef = useRef<number>(0);
  const lastAdvanceRef = useRef<number>(advanceCount);

  const { positions, seeds } = useMemo(
    () => generateFibonacciSpherePoints(vertexCount, radius, seed),
    [vertexCount, radius, seed]
  );

  if (uniformsRef.current === null) {
    uniformsRef.current = [];
  }
  {
    const count = Math.max(1, Math.floor(shellCount));
    const arr = uniformsRef.current;
    for (let i = arr.length; i < count; i += 1) {
      arr.push(makeUniforms({
        radius: radius * (i === 0 ? 1 : 1 + i * 0.2),
        pointSize,
        sizeRandomness,
        enableRandomishNoise,
        randomishAmount,
        enableSineNoise,
        sineAmount,
        randomishSpeed,
        pulseSize,
        opacity,
        enableRippleNoise,
        rippleAmount,
        rippleSpeed,
        rippleScale,
        enableSurfaceRipple,
        surfaceRippleAmount,
        surfaceRippleSpeed,
        surfaceRippleScale,
        enableSpin,
        spinSpeed,
        spinAxisX,
        spinAxisY,
        maskEnabled,
        maskFeather,
        maskInvert,
        sineSpeed,
        sineScale,
        pointColor,
        glowColor,
        glowStrength,
        glowRadiusFactor,
        enableGradient,
        gradientColor2,
        gradientAngle,
        arcAltitude,
        seed,
      }));
    }
    if (arr.length > count) arr.length = count;
  }

  useFrame((stateFrame) => {
    const uniformsArray = uniformsRef.current!;
    const now = stateFrame.clock.getElapsedTime();
    if (prevNowRef.current === null) {
      prevNowRef.current = now;
      timeAccRef.current = now;
      lastAdvanceRef.current = advanceCount;
    }
    const dt = Math.max(0, now - prevNowRef.current);
    prevNowRef.current = now;

    if (freezeTime) {
      if (advanceCount !== lastAdvanceRef.current) {
        const diff = advanceCount - lastAdvanceRef.current;
        timeAccRef.current += diff * advanceAmount;
        lastAdvanceRef.current = advanceCount;
      }
    } else {
      timeAccRef.current += dt;
      lastAdvanceRef.current = advanceCount;
    }

    for (let i = 0; i < uniformsArray.length; i += 1) {
      const u = uniformsArray[i];
      u.uTime.value = timeAccRef.current;
      u.uRadius.value = radius * (1 + i * 0.2);
      u.uPointSize.value = pointSize;
      u.uViewportWidth.value = stateFrame.size.width;
      u.uViewportHeight.value = stateFrame.size.height;
      const cam = stateFrame.camera as THREE.PerspectiveCamera;
      if (cam && typeof (cam as any).fov === "number") {
        u.uFov.value = (cam.fov * Math.PI) / 180;
      }
      u.uVolume.value = THREE.MathUtils.clamp(volume, 0, 1);
      u.uEnableRandomish.value = enableRandomishNoise ? 1 : 0;
      const micEnv = THREE.MathUtils.clamp(micEnvelope, 0, 1);
      const randomishAmountFinal = THREE.MathUtils.clamp(
        (randomishAmount ?? 0) + micEnv * THREE.MathUtils.clamp(randomishMicModAmount ?? 0, 0, 1),
        0,
        1
      );
      u.uRandomishAmount.value = randomishAmountFinal;
      u.uEnableSine.value = enableSineNoise ? 1 : 0;
      const sineAmountFinal = THREE.MathUtils.clamp(
        (sineAmount ?? 0) + micEnv * THREE.MathUtils.clamp(sineMicModAmount ?? 0, 0, 1),
        0,
        1
      );
      u.uSineAmount.value = sineAmountFinal;
      u.uRandomishSpeed.value = randomishSpeed;
      u.uPulseSize.value = THREE.MathUtils.clamp(pulseSize, 0, 1);
      u.uOpacity.value = THREE.MathUtils.clamp(opacity, 0, 1);
      u.uSizeRandomness.value = THREE.MathUtils.clamp(sizeRandomness, 0, 1);
      u.uEnableRipple.value = enableRippleNoise ? 1 : 0;
      u.uRippleAmount.value = THREE.MathUtils.clamp(
        (rippleAmount ?? 0) + micEnv * THREE.MathUtils.clamp(rippleMicModAmount ?? 0, 0, 1),
        0,
        1
      );
      u.uRippleSpeed.value = rippleSpeed;
      u.uRippleScale.value = rippleScale;
      u.uEnableSurfaceRipple.value = enableSurfaceRipple ? 1 : 0;
      u.uSurfaceRippleAmount.value = THREE.MathUtils.clamp(
        (surfaceRippleAmount ?? 0) + micEnv * THREE.MathUtils.clamp(surfaceRippleMicModAmount ?? 0, 0, 1),
        0,
        1
      );
      u.uSurfaceRippleSpeed.value = surfaceRippleSpeed;
      u.uSurfaceRippleScale.value = surfaceRippleScale;
      u.uEnableSpin.value = enableSpin ? 1 : 0;
      u.uSpinSpeed.value = spinSpeed;
      u.uSpinAxisX.value = spinAxisX;
      u.uSpinAxisY.value = spinAxisY;
      u.uMaskEnabled.value = maskEnabled ? 1 : 0;
      u.uMaskInvert.value = maskInvert ? 1 : 0;
      const sphereCenter = new THREE.Vector3(0, 0, 0);
      const centerNdc = sphereCenter.clone().project(cam);
      u.uMaskCenterNdc.value.set(centerNdc.x, centerNdc.y);
      const minHalf = Math.min(stateFrame.size.width, stateFrame.size.height) * 0.5;
      u.uMaskRadiusPx.value = THREE.MathUtils.clamp(maskRadius, 0, 1) * minHalf * (1.0 / Math.max(1e-3, cam.zoom));
      u.uMaskFeatherPx.value = THREE.MathUtils.clamp(maskFeather, 0, 1) * minHalf * (1.0 / Math.max(1e-3, cam.zoom));
      u.uSineSpeed.value = sineSpeed;
      u.uSineScale.value = sineScale;
      u.uColor.value.set(pointColor);
      u.uColor2.value.set(gradientColor2);
      u.uEnableGradient.value = enableGradient ? 1 : 0;
      u.uGradientAngle.value = THREE.MathUtils.degToRad(gradientAngle);
      u.uGlowColor.value.set(glowColor);
      u.uGlowStrength.value = THREE.MathUtils.clamp(glowStrength, 0, 3);
      u.uGlowRadiusFactor.value = Math.max(0, glowRadiusFactor);
      const phaseBase = Math.sin((seed + i * 17.23) * 12.9898) * 43758.5453;
      const jitter = 1.0;
      u.uShellPhase.value = (phaseBase - Math.floor(phaseBase)) * jitter;
    }
  });

  const rotX = THREE.MathUtils.degToRad(rotationX);
  const rotY = THREE.MathUtils.degToRad(rotationY);
  const rotZ = THREE.MathUtils.degToRad(rotationZ);

  return (
    <group scale={[size, size, size]} rotation={[rotX, rotY, rotZ]}>
      {uniformsRef.current!.map((u, i) => (
        <group key={`shell-${i}`} renderOrder={i}>
          <points>
            <bufferGeometry key={`${vertexCount}-${radius}-${seed}-${i}`}>
              <bufferAttribute attach="attributes-position" args={[positions, 3]} />
              <bufferAttribute attach="attributes-aSeed" args={[seeds, 1]} />
            </bufferGeometry>
            <shaderMaterial
              vertexShader={vertexShader}
              fragmentShader={fragmentShader}
              uniforms={u as unknown as { [key: string]: THREE.IUniform }}
              transparent
              depthWrite={false}
              depthTest
              alphaTest={0.001}
              premultipliedAlpha={false}
              blending={THREE.NormalBlending}
            />
          </points>
        </group>
      ))}
    </group>
  );
}

export default SphereWaveform;


