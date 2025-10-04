export interface FibonacciSphereResult {
  positions: Float32Array;
  seeds: Float32Array;
}

export function generateFibonacciSpherePoints(
  vertexCount: number,
  radius: number,
  seed: number = 1
): FibonacciSphereResult {
  const count = Math.max(1, Math.floor(Number.isFinite(vertexCount) ? vertexCount : 1));
  const r = Number.isFinite(radius) ? radius : 1;
  const phi = (1 + Math.sqrt(5)) / 2;
  const goldenAngle = (2 - phi) * (2 * Math.PI);

  const positions = new Float32Array(count * 3);
  const seeds = new Float32Array(count);

  for (let i = 0; i < count; i += 1) {
    const t = i + 0.5;
    const y = 1 - (t / Math.max(1, count)) * 2;
    const yy = Math.min(1, Math.max(-1, y));
    const radiusAtY = Math.sqrt(Math.max(0, 1 - yy * yy));
    const theta = goldenAngle * t;

    const x = Math.cos(theta) * radiusAtY;
    const z = Math.sin(theta) * radiusAtY;

    positions[i * 3 + 0] = x * r;
    positions[i * 3 + 1] = yy * r;
    positions[i * 3 + 2] = z * r;

    const pr = lcg(i + 1, seed);
    seeds[i] = pr;
  }

  return { positions, seeds };
}

function lcg(index: number, seed: number): number {
  const a = 1664525;
  const c = 1013904223;
  let state = (seed ^ (index * 2654435761)) >>> 0;
  state = (Math.imul(a, state) + c) >>> 0;
  return (state & 0xffffffff) / 0x100000000;
}


