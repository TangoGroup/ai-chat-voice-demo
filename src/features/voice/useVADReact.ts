"use client";
import { useEffect, useRef, useState, useCallback, useMemo } from "react";
import { useMicVAD } from "@ricky0123/vad-react";
import { useAudioContext } from "@/components/AudioContext";

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

/**
 * VAD hook using @ricky0123/vad-react with shared AudioContext support
 * 
 * Note: This requires the vad-web assets to be accessible. For Next.js, you may need to:
 * 1. Copy assets from node_modules/@ricky0123/vad-web/dist to public/vad-web/
 * 2. Or configure baseAssetPath to point to a CDN/static host
 */
export function useVADReact(
  enabled: boolean,
  callbacks: VADCallbacks,
  options: VADOptions = {}
): VADResult {
  const {
    onSpeechStart,
    onSpeechEnd,
    onError,
    log = () => {},
    threshold = 0.45,
    minSpeechDurationMs = 400,
    redemptionDurationMs = 1400,
    lookBackDurationMs = 384,
  } = { ...callbacks, ...options };

  const { audioContextRef, initialize: initializeAudioContext } = useAudioContext();
  const streamRef = useRef<MediaStream | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Store callbacks in refs to avoid dependency issues
  const callbacksRef = useRef({ onSpeechStart, onSpeechEnd, onError, log });
  useEffect(() => {
    callbacksRef.current = { onSpeechStart, onSpeechEnd, onError, log };
  }, [onSpeechStart, onSpeechEnd, onError, log]);

  // Ensure AudioContext is initialized
  useEffect(() => {
    if (!audioContextRef.current) {
      initializeAudioContext().catch((err) => {
        callbacksRef.current.log(`Failed to initialize AudioContext: ${err instanceof Error ? err.message : String(err)}`);
        callbacksRef.current.onError?.(err instanceof Error ? err.message : String(err));
      });
    }
  }, [audioContextRef, initializeAudioContext]);

  // Get stream function that uses shared audio context
  const getStream = useCallback(async (): Promise<MediaStream> => {
    if (streamRef.current) {
      return streamRef.current;
    }
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
        sampleRate: 16000,
      },
      video: false,
    });
    streamRef.current = stream;
    return stream;
  }, []);

  // Memoize VAD options to prevent recreation
  const vadOptions = useMemo(() => ({
    audioContext: audioContextRef.current ?? undefined,
    getStream,
    // Explicitly set model to ensure correct path resolution
    model: "legacy" as const,
    // Configure asset paths - vad-web loads models from these paths
    // Model files should be copied to public/vad-web/ (silero_vad_legacy.onnx, silero_vad_v5.onnx, vad.worklet.bundle.min.js)
    // ONNX WASM files should be in public/onnx/ or use a CDN
    // Use absolute paths that work in Next.js
    baseAssetPath: "/vad-web/",
    onnxWASMBasePath: process.env.NEXT_PUBLIC_ONNX_WASM_PATH || "/onnx/",
    onSpeechStart: () => {
      callbacksRef.current.log("VAD: speech detected");
      callbacksRef.current.onSpeechStart();
    },
    onSpeechEnd: () => {
      callbacksRef.current.log("VAD: speech ended");
      callbacksRef.current.onSpeechEnd();
    },
    onVADMisfire: () => {
      callbacksRef.current.log("VAD: misfire (too short)");
    },
    startOnLoad: false,
    // Map timing options (approximate mapping from steelbrain options)
    minSpeechMs: minSpeechDurationMs,
    redemptionMs: redemptionDurationMs,
    // Note: threshold maps differently - vad-react uses positiveSpeechThreshold/negativeSpeechThreshold
    // For now, using default thresholds; you may want to fine-tune these
  }), [getStream, minSpeechDurationMs, redemptionDurationMs]);

  // Initialize vad-react with audio context override
  const vad = useMicVAD(vadOptions);

  // Control VAD based on enabled state
  useEffect(() => {
    if (enabled && !vad.loading && !vad.listening) {
      log("VAD: starting");
      vad.start();
    } else if (!enabled && vad.listening) {
      log("VAD: pausing");
      vad.pause();
    }
  }, [enabled, vad.loading, vad.listening, vad, log]);

  // Update error state from vad
  useEffect(() => {
    if (vad.errored) {
      setError(vad.errored);
      callbacksRef.current.onError?.(vad.errored);
    } else {
      setError(null);
    }
  }, [vad.errored]);

  // Cleanup stream on unmount
  useEffect(() => {
    return () => {
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    };
  }, []);

  return { stream: streamRef.current, error };
}

/**
 * Preload VAD model (call once on mount for early initialization)
 * With vad-react, the model loads automatically when the hook initializes.
 * This function is kept for API compatibility but is a no-op.
 */
export async function preloadVADReact(): Promise<void> {
  // vad-react handles model loading internally
  return Promise.resolve();
}

