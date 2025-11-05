"use client";
import { useEffect, useRef, useState } from "react";
import { speechFilter, preloadModel } from "@steelbrain/media-speech-detection-web";
import { ingestAudioStream, RECOMMENDED_AUDIO_CONSTRAINTS } from "@steelbrain/media-ingest-audio";

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

// Module-scoped preload promise to coordinate between manual preload and hook usage
let modelPreloadPromise: Promise<void> | null = null;

async function ensureModelPreloaded(): Promise<void> {
  if (typeof window === "undefined") return;
  if (!modelPreloadPromise) {
    modelPreloadPromise = preloadModel().catch((e) => {
      modelPreloadPromise = null; // Reset on error to allow retry
      throw e;
    });
  }
  return modelPreloadPromise;
}

/**
 * VAD hook using @steelbrain/media-speech-detection-web
 * Simplified VAD hook: ensures model is preloaded before starting pipeline
 */
export function useVADSteelbrain(
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

  const streamRef = useRef<MediaStream | null>(null);
  const aborterRef = useRef<AbortController | null>(null);
  const pipelineActiveRef = useRef<boolean>(false);
  const enabledRef = useRef<boolean>(false);
  const abortedRef = useRef<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  // Store callbacks in refs to avoid dependency issues
  const callbacksRef = useRef({ onSpeechStart, onSpeechEnd, onError, log });
  useEffect(() => {
    callbacksRef.current = { onSpeechStart, onSpeechEnd, onError, log };
  }, [onSpeechStart, onSpeechEnd, onError, log]);

  // Start/stop VAD when enabled changes
  useEffect(() => {
    const wasEnabled = enabledRef.current;
    // Always log when enabled changes to debug VAD lifecycle
    if (wasEnabled !== enabled) {
      callbacksRef.current.log(`VAD effect: enabled=${enabled}, wasEnabled=${wasEnabled}, pipelineActive=${pipelineActiveRef.current}, hasAborter=${!!aborterRef.current}, hasStream=${!!streamRef.current}`);
    }
    // Update enabled ref FIRST so cleanup can check current state
    enabledRef.current = enabled;

    if (!enabled || typeof window === "undefined" || !navigator.mediaDevices) {
      // Disable: stop pipeline and mute tracks
      if (wasEnabled) {
        // Only abort if we were previously enabled (avoid aborting on initial mount)
        abortedRef.current = true;
        if (aborterRef.current) {
          aborterRef.current.abort();
          aborterRef.current = null;
        }
        pipelineActiveRef.current = false;
        streamRef.current?.getAudioTracks().forEach((t) => { t.enabled = false; });
        callbacksRef.current.log(`VAD: disabled (wasEnabled=${wasEnabled})`);
      }
      return;
    }

    // If pipeline is already active, just re-enable tracks and clear abort flag
    if (pipelineActiveRef.current && aborterRef.current && streamRef.current) {
      abortedRef.current = false;
      streamRef.current.getAudioTracks().forEach((t) => { t.enabled = true; });
      callbacksRef.current.log(`VAD: re-enabled (pipeline already active, wasEnabled=${wasEnabled})`);
      return;
    }

    // Starting fresh: clear abort flag and re-enable tracks if stream exists
    abortedRef.current = false;
    if (streamRef.current) {
      streamRef.current.getAudioTracks().forEach((t) => { t.enabled = true; });
    }
    callbacksRef.current.log(`VAD: starting fresh (pipelineActive=${pipelineActiveRef.current}, hasStream=${!!streamRef.current})`);

    async function startVAD() {
      try {
        // Ensure model is preloaded first (cached globally, only loads once)
        callbacksRef.current.log("VAD: ensuring model preloaded...");
        await ensureModelPreloaded();
        if (abortedRef.current || !enabledRef.current) return;
        callbacksRef.current.log("VAD: model ready");

        // Get or reuse mic stream
        const stream = streamRef.current ?? await navigator.mediaDevices.getUserMedia({
          audio: RECOMMENDED_AUDIO_CONSTRAINTS,
          video: false
        });
        if (abortedRef.current || !enabledRef.current) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        if (!streamRef.current) streamRef.current = stream;
        stream.getAudioTracks().forEach((t) => { t.enabled = true; });

        // Abort any existing pipeline before creating new one
        if (aborterRef.current) {
          aborterRef.current.abort();
        }
        const aborter = new AbortController();
        aborterRef.current = aborter;

        // Build audio ingestion pipeline
        callbacksRef.current.log("VAD: building audio pipeline...");
        const audioStream = await ingestAudioStream(stream);
        if (abortedRef.current || !enabledRef.current) {
          aborter.abort();
          return;
        }

        // Create VAD transform with callbacks
        const vadTransform = speechFilter({
          threshold,
          minSpeechDurationMs,
          redemptionDurationMs,
          lookBackDurationMs,
          noEmit: true,
          onSpeechStart: () => {
            callbacksRef.current.log(`VAD callback: speechStart (enabled=${enabledRef.current}, aborted=${abortedRef.current})`);
            if (enabledRef.current && !abortedRef.current) {
              callbacksRef.current.log("VAD: speech detected");
              callbacksRef.current.onSpeechStart();
            } else {
              callbacksRef.current.log(`VAD: speechStart blocked (enabled=${enabledRef.current}, aborted=${abortedRef.current})`);
            }
          },
          onSpeechEnd: () => {
            callbacksRef.current.log(`VAD callback: speechEnd (enabled=${enabledRef.current}, aborted=${abortedRef.current})`);
            if (enabledRef.current && !abortedRef.current) {
              callbacksRef.current.log("VAD: speech ended");
              callbacksRef.current.onSpeechEnd();
            } else {
              callbacksRef.current.log(`VAD: speechEnd blocked (enabled=${enabledRef.current}, aborted=${abortedRef.current})`);
            }
          },
          onMisfire: () => {
            if (enabledRef.current && !abortedRef.current) {
              callbacksRef.current.log("VAD: misfire (too short)");
            }
          },
          onError: (err: unknown) => {
            const msg = err instanceof Error ? err.message : String(err);
            callbacksRef.current.log(`VAD error: ${msg}`);
            if (enabledRef.current && !abortedRef.current) {
              setError(msg);
              callbacksRef.current.onError?.(msg);
            }
          },
        });

        // Start pipeline
        pipelineActiveRef.current = true;
        callbacksRef.current.log("VAD: pipeline started");
        
        audioStream
          .pipeThrough(vadTransform)
          .pipeTo(new WritableStream<Float32Array>({ write() {} }), { signal: aborter.signal })
          .catch((e) => {
            if (!abortedRef.current) {
              const msg = e instanceof Error ? e.message : String(e);
              callbacksRef.current.log(`VAD pipeline error: ${msg}`);
              setError(msg);
              callbacksRef.current.onError?.(msg);
            }
          })
          .finally(() => {
            if (aborterRef.current === aborter) {
              pipelineActiveRef.current = false;
            }
          });
      } catch (e) {
        if (!abortedRef.current) {
          const msg = e instanceof Error ? e.message : String(e);
          callbacksRef.current.log(`VAD failed: ${msg}`);
          setError(msg);
          callbacksRef.current.onError?.(msg);
        }
      }
    }

    startVAD();

    return () => {
      // Only abort if we're actually disabling (check current enabled state, not closure)
      const isDisabling = !enabledRef.current;
      if (isDisabling) {
        abortedRef.current = true;
        if (aborterRef.current) {
          aborterRef.current.abort();
          aborterRef.current = null;
        }
        pipelineActiveRef.current = false;
        streamRef.current?.getAudioTracks().forEach((t) => { t.enabled = false; });
      } else {
        // If not disabling, don't abort - the new effect will take over and clear abortedRef
        // But we still need to clear abortedRef here so callbacks can fire during transition
        abortedRef.current = false;
      }
    };
  }, [enabled, threshold, minSpeechDurationMs, redemptionDurationMs, lookBackDurationMs]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (aborterRef.current) {
        aborterRef.current.abort();
        aborterRef.current = null;
      }
      pipelineActiveRef.current = false;
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    };
  }, []);

  return { stream: streamRef.current, error };
}

/**
 * Preload VAD model (call once on mount for early initialization)
 * The hook will also ensure preload before starting, so this is optional.
 */
export async function preloadVAD(): Promise<void> {
  await ensureModelPreloaded();
}
