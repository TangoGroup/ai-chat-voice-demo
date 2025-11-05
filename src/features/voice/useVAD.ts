"use client";
import { useVADSteelbrain } from "./useVADSteelbrain";
import { useVADReact } from "./useVADReact";

export interface VADCallbacks {
  onSpeechStart: () => void;
  onSpeechEnd: () => void;
  onError?: (error: string) => void;
  log?: (msg: string) => void;
}

interface VADOptions {
  threshold?: number;
  minSpeechDurationMs?: number;
  redemptionDurationMs?: number;
  lookBackDurationMs?: number;
}

export interface VADResult {
  stream: MediaStream | null;
  error: string | null;
}

export type VADImplementation = "steelbrain" | "vad-react";

/**
 * Get the VAD implementation to use from environment variable or default
 */
function getVADImplementation(): VADImplementation {
  if (typeof window === "undefined") {
    // Server-side: default to steelbrain
    return "steelbrain";
  }
  
  // Check environment variable (defaults to steelbrain)
  const envValue = process.env.NEXT_PUBLIC_VAD_IMPLEMENTATION;
  if (envValue === "vad-react" || envValue === "react") {
    return "vad-react";
  }
  return "steelbrain";
}

/**
 * Unified VAD hook that proxies to either steelbrain or vad-react implementation
 * 
 * Switch implementations via NEXT_PUBLIC_VAD_IMPLEMENTATION environment variable:
 * - "steelbrain" or unset: Uses @steelbrain/media-speech-detection-web (default)
 * - "vad-react" or "react": Uses @ricky0123/vad-react with AudioContext support
 * 
 * Both implementations expose the same API for seamless switching.
 */
export function useVAD(
  enabled: boolean,
  callbacks: VADCallbacks,
  options: VADOptions = {}
): VADResult {
  const implementation = getVADImplementation();
  
  // Call both hooks unconditionally to satisfy React rules
  // Only enable the one matching the implementation
  const reactResult = useVADReact(implementation === "vad-react" && enabled, callbacks, options);
  const steelbrainResult = useVADSteelbrain(implementation === "steelbrain" && enabled, callbacks, options);
  
  // Return the result from the active implementation
  return implementation === "vad-react" ? reactResult : steelbrainResult;
}

/**
 * Preload VAD model (call once on mount for early initialization)
 * Delegates to the appropriate implementation's preload function.
 */
export async function preloadVAD(): Promise<void> {
  const implementation = getVADImplementation();
  
  if (implementation === "vad-react") {
    const { preloadVADReact } = await import("./useVADReact");
    return preloadVADReact();
  }
  
  const { preloadVAD: preloadVADSteelbrain } = await import("./useVADSteelbrain");
  return preloadVADSteelbrain();
}
