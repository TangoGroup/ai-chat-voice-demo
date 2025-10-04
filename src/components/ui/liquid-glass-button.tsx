"use client";
import * as React from "react";
import { cn } from "@/lib/utils";

type LiquidGlassButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  active?: boolean;
  size?: "sm" | "md" | "lg";
  diameter?: number; // px override; if set, takes precedence over size
};

// WebGL1 shaders adapted to a background-refraction approach (inspired by https://bergice.github.io/liquidglass/)
const VERT = `
attribute vec2 a_position;
varying vec2 v_uv;
void main(){
  v_uv = a_position * 0.5 + 0.5;
  gl_Position = vec4(a_position, 0.0, 1.0);
}
`;

const FRAG = `
precision mediump float;
varying vec2 v_uv;
uniform sampler2D u_background;
uniform vec2 u_resolution;   // button canvas size in device px
uniform vec2 u_bgResolution; // background canvas size in device px
uniform vec2 u_btnTopLeft;   // top-left of button in background device px
uniform float u_active;

float roundedBox(vec2 uv, vec2 center, vec2 size, float radius) {
  vec2 q = abs(uv - center) - size + radius;
  return length(max(q, 0.0)) - radius;
}

vec3 blurBackground(vec2 baseUv, vec2 res) {
  vec3 result = vec3(0.0);
  float total = 0.0;
  float radius = 3.0;
  for (int x = -3; x <= 3; x++) {
    for (int y = -3; y <= 3; y++) {
      vec2 offset = vec2(float(x), float(y)) * 2.0 / res;
      float weight = exp(-(float(x * x + y * y)) / (2.0 * radius));
      result += texture2D(u_background, baseUv + offset).rgb * weight;
      total += weight;
    }
  }
  return result / total;
}

float roundedBoxSDF(vec2 p, vec2 b, float r) {
  vec2 d = abs(p) - b + vec2(r);
  return length(max(d, 0.0)) - r;
}

vec2 getNormal(vec2 pixelUV, vec2 center, vec2 size, float radius, vec2 res) {
  vec2 eps = vec2(1.0) / res * 2.0;
  vec2 p = pixelUV - center;
  float dx = (roundedBoxSDF(p + vec2(eps.x, 0.0), size, radius) - roundedBoxSDF(p - vec2(eps.x, 0.0), size, radius)) * 0.5;
  float dy = (roundedBoxSDF(p + vec2(0.0, eps.y), size, radius) - roundedBoxSDF(p - vec2(0.0, eps.y), size, radius)) * 0.5;
  vec2 gradient = vec2(dx, dy);
  if (length(gradient) < 0.001) return vec2(0.0);
  return normalize(gradient);
}

void main(){
  // Local pixel coords inside the button canvas (device px)
  vec2 pixelUV = v_uv * u_resolution;
  vec2 center = u_resolution * 0.5;
  vec2 size = (u_resolution * 0.5) - vec2(24.0);
  float radius = min(size.x, size.y) * 0.35;
  float dist = roundedBox(pixelUV, center, size, radius);

  // Map to background UVs
  vec2 bgPx = u_btnTopLeft + pixelUV;
  vec2 bgUv = bgPx / u_bgResolution;

  vec2 local = (pixelUV - center) / size;
  local.y *= u_resolution.x / u_resolution.y;

  if (dist > 1.0) {
    gl_FragColor = texture2D(u_background, bgUv);
    return;
  }

  float r = clamp(length(local), 0.0, 1.0);
  float eta = 1.0/1.5;
  float contourFalloff = exp(-abs(dist) * 0.4);
  vec2 normal = getNormal(pixelUV, center, size, radius, u_resolution);
  vec2 domeNormalContour = normal * pow(contourFalloff, 1.5);
  vec2 refractVecContour = refract(vec2(0.0), domeNormalContour, eta);
  vec2 uvContour = bgUv + refractVecContour * 0.35 * contourFalloff;

  vec2 domeNormal = normalize(local) * pow(r, 1.0);
  vec2 refractVec = refract(-domeNormal, domeNormal, eta);
  vec2 curvedRefractUV = bgUv + refractVec * 0.03;

  float edgeWeight = smoothstep(0.0, 1.0, abs(dist));
  float radialWeight = smoothstep(0.5, 1.0, r);
  float combinedWeight = clamp((edgeWeight * 1.0) + (-radialWeight * 0.5), 0.0, 1.0);
  vec2 refractUV = mix(curvedRefractUV, uvContour, combinedWeight);

  vec3 refracted = texture2D(u_background, refractUV).rgb;
  vec3 blurred = blurBackground(refractUV, u_bgResolution);
  vec3 base = mix(refracted, blurred, 0.5);

  float edgeFalloff = smoothstep(0.01, 0.0, dist);
  float verticalBand = 1.0 - smoothstep(-1.5, -0.2, local.y);
  float topShadow = edgeFalloff * verticalBand;
  base = mix(base, vec3(0.0), topShadow * 0.1);

  float edge = 1.0 - smoothstep(0.0, 0.03, dist * -2.0);
  vec3 glow = vec3(0.7);
  vec3 color = mix(base, glow, edge * (0.3 + 0.4*u_active));

  float alpha = 0.75;
  gl_FragColor = vec4(color, alpha);
}
`;

function initGL(canvas: HTMLCanvasElement) {
  const gl = canvas.getContext("webgl", { premultipliedAlpha: true, alpha: true, antialias: true });
  if (!gl) return null;
  const GL = gl;
  function compile(type: number, src: string){ const sh = GL.createShader(type)!; GL.shaderSource(sh, src); GL.compileShader(sh); return sh; }
  const vs = compile(GL.VERTEX_SHADER, VERT);
  const fs = compile(GL.FRAGMENT_SHADER, FRAG);
  const prog = GL.createProgram()!; GL.attachShader(prog, vs); GL.attachShader(prog, fs); GL.linkProgram(prog);
  if (!GL.getProgramParameter(prog, GL.LINK_STATUS)) return null;
  const buf = GL.createBuffer(); if (!buf) return null; GL.bindBuffer(GL.ARRAY_BUFFER, buf);
  const tri = new Float32Array([
    -1, -1,  1, -1,  -1,  1,
    -1,  1,  1, -1,   1,  1
  ]);
  GL.bufferData(GL.ARRAY_BUFFER, tri, GL.STATIC_DRAW);
  const loc = GL.getAttribLocation(prog, "a_position");
  GL.enableVertexAttribArray(loc); GL.vertexAttribPointer(loc, 2, GL.FLOAT, false, 0, 0);
  const u_background = GL.getUniformLocation(prog, "u_background");
  const u_resolution = GL.getUniformLocation(prog, "u_resolution");
  const u_bgResolution = GL.getUniformLocation(prog, "u_bgResolution");
  const u_btnTopLeft = GL.getUniformLocation(prog, "u_btnTopLeft");
  const u_active = GL.getUniformLocation(prog, "u_active");
  return { gl: GL, prog, u_background, u_resolution, u_bgResolution, u_btnTopLeft, u_active };
}

export const LiquidGlassButton = React.forwardRef<HTMLButtonElement, LiquidGlassButtonProps>(
  ({ className, active = false, size = "md", diameter, children, ...props }, ref) => {
    const dims = typeof diameter === "number" && diameter > 0 ? Math.floor(diameter) : (size === "sm" ? 56 : size === "lg" ? 80 : 64);
    const canvasRef = React.useRef<HTMLCanvasElement | null>(null);
    const rafRef = React.useRef<number | null>(null);
    const startRef = React.useRef<number>(0);
    const glRef = React.useRef<ReturnType<typeof initGL> | null>(null);
    const bgTexRef = React.useRef<WebGLTexture | null>(null);

    React.useEffect(() => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const ctx = initGL(canvas);
      if (!ctx) return;
      glRef.current = ctx;
      const { gl, prog, u_background, u_resolution, u_bgResolution, u_btnTopLeft, u_active } = ctx;

      // Bind program and init background texture
      gl.useProgram(prog);
      bgTexRef.current = gl.createTexture();
      if (!bgTexRef.current) return;
      gl.bindTexture(gl.TEXTURE_2D, bgTexRef.current);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      if (u_background) gl.uniform1i(u_background, 0);

      const render = () => {
        const dpr = Math.min(window.devicePixelRatio || 1, 2);
        const w = Math.floor(dims * dpr);
        const h = Math.floor(dims * dpr);
        if (canvas.width !== w || canvas.height !== h) {
          canvas.width = w; canvas.height = h; canvas.style.width = `${dims}px`; canvas.style.height = `${dims}px`;
          gl.viewport(0, 0, w, h);
        }
        gl.useProgram(prog);

        // Choose background: largest other canvas (likely the Visualizer)
        const canvases = Array.from(document.querySelectorAll("canvas")) as HTMLCanvasElement[];
        const others = canvases.filter((c) => c !== canvas);
        let bgCanvas: HTMLCanvasElement | null = null;
        let bestArea = 0;
        for (const c of others) {
          const area = (c.width || 0) * (c.height || 0);
          if (area > bestArea) { bestArea = area; bgCanvas = c; }
        }
        if (bgCanvas) {
          gl.activeTexture(gl.TEXTURE0);
          gl.bindTexture(gl.TEXTURE_2D, bgTexRef.current);
          try { gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, bgCanvas); } catch {}
          const bgRect = bgCanvas.getBoundingClientRect();
          const btnRect = canvas.getBoundingClientRect();
          const scaleX = bgCanvas.width / Math.max(1, bgRect.width);
          const scaleY = bgCanvas.height / Math.max(1, bgRect.height);
          const leftInBg = (btnRect.left - bgRect.left) * scaleX;
          const topInBg = (btnRect.top - bgRect.top) * scaleY;
          if (u_bgResolution) gl.uniform2f(u_bgResolution, bgCanvas.width, bgCanvas.height);
          if (u_btnTopLeft) gl.uniform2f(u_btnTopLeft, leftInBg, topInBg);
        }

        if (u_resolution) gl.uniform2f(u_resolution, w, h);
        if (u_active) gl.uniform1f(u_active, active ? 1.0 : 0.0);
        gl.drawArrays(gl.TRIANGLES, 0, 6);
        rafRef.current = requestAnimationFrame(render);
      };
      rafRef.current = requestAnimationFrame(render);
      return () => { if (rafRef.current) cancelAnimationFrame(rafRef.current); };
    }, [active, dims]);

    return (
      <button
        ref={ref}
        className={cn(
          "relative inline-flex items-center justify-center rounded-full",
          "ring-0 outline-none",
          className
        )}
        style={{ width: dims, height: dims }}
        {...props}
      >
        <canvas ref={canvasRef} className="absolute inset-0 block rounded-full" />
        <span className="relative z-10 text-foreground">
          {children}
        </span>
      </button>
    );
  }
);
LiquidGlassButton.displayName = "LiquidGlassButton";


