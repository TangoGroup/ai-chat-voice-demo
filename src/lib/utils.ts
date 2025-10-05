import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export interface Stopwatch {
  /** Epoch of stopwatch start (performance.now in ms) */
  readonly startedAtMs: number;
  /** Epoch of last split (ms) */
  lastSplitAtMs: number;
  /** Returns ms since start */
  elapsedMs: () => number;
  /** Returns ms since last split and updates split epoch */
  splitMs: () => number;
  /** Returns current high-resolution time (ms) */
  nowMs: () => number;
}

export function createStopwatch(): Stopwatch {
  const start = performance.now();
  let last = start;
  return {
    startedAtMs: start,
    get lastSplitAtMs() {
      return last;
    },
    set lastSplitAtMs(v: number) {
      last = v;
    },
    elapsedMs: () => performance.now() - start,
    splitMs: () => {
      const now = performance.now();
      const delta = now - last;
      last = now;
      return delta;
    },
    nowMs: () => performance.now(),
  };
}

export function formatMs(ms: number): string {
  if (ms < 1000) return `${ms.toFixed(0)} ms`;
  const seconds = ms / 1000;
  if (seconds < 60) return `${seconds.toFixed(2)} s`;
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds - m * 60);
  return `${m}m ${s}s`;
}
