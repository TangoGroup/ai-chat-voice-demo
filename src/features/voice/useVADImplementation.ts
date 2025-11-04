"use client";
import { useCallback, useEffect, useRef } from "react";
import { speechFilter, preloadModel } from "@steelbrain/media-speech-detection-web";
import { ingestAudioStream, RECOMMENDED_AUDIO_CONSTRAINTS } from "@steelbrain/media-ingest-audio";

export interface VADImplementationOptions {
  onSpeechStart: () => void;
  onSpeechEnd: () => void;
  onError: (error: string) => void;
  onMisfire?: () => void;
  log: (msg: string) => void;
  threshold?: number;
  minSpeechDurationMs?: number;
  redemptionDurationMs?: number;
  lookBackDurationMs?: number;
}

export interface VADImplementation {
  start: () => Promise<void>;
  pause: () => void;
  preload: () => Promise<void>;
  getStream: () => MediaStream | null;
  isPipelineStarted: () => boolean;
  cleanup: () => void;
}

/**
 * VAD implementation using steelbrain libraries.
 * Manages the microphone stream and VAD pipeline lifecycle.
 */
export function useVADImplementation(options: VADImplementationOptions): VADImplementation {
  const {
    onSpeechStart,
    onSpeechEnd,
    onError,
    onMisfire,
    log,
    threshold = 0.45,
    minSpeechDurationMs = 400,
    redemptionDurationMs = 1400,
    lookBackDurationMs = 384,
  } = options;

  // VAD runtime state
  const sharedStreamRef = useRef<MediaStream | null>(null);
  const vadPipelineStartedRef = useRef<boolean>(false);
  const vadAbortRef = useRef<AbortController | null>(null);
  const vadEnabledRef = useRef<boolean>(false);

  // Preload VAD model
  const preload = useCallback(async () => {
    try {
      await preloadModel();
      log("VAD model preloaded");
    } catch (e) {
      const error = e instanceof Error ? e.message : String(e);
      log(`VAD preload failed: ${error}`);
      onError(`VAD preload failed: ${error}`);
    }
  }, [log, onError]);

  // Release shared stream
  const releaseSharedStream = useCallback(() => {
    if (sharedStreamRef.current) {
      try {
        sharedStreamRef.current.getTracks().forEach((t) => t.stop());
      } catch {}
      sharedStreamRef.current = null;
    }
  }, []);

  // Start VAD pipeline
  const start = useCallback(async () => {
    log("VAD implementation: starting");

    // Ensure mic stream (only in browser)
    if (typeof window === "undefined" || !navigator.mediaDevices) {
      throw new Error("VAD requires browser environment");
    }
    const stream = sharedStreamRef.current ?? await navigator.mediaDevices.getUserMedia({
      audio: RECOMMENDED_AUDIO_CONSTRAINTS,
      video: false
    });
    if (!sharedStreamRef.current) sharedStreamRef.current = stream;
    try {
      stream.getAudioTracks().forEach((t) => { t.enabled = true; });
    } catch {}

    if (!vadPipelineStartedRef.current) {
      log("VAD implementation: building pipeline");
      try {
        // Build ingest and VAD pipeline once
        const audioStream = await ingestAudioStream(stream);
        const aborter = new AbortController();
        vadAbortRef.current = aborter;

        const vadTransform = speechFilter({
          threshold,
          minSpeechDurationMs,
          redemptionDurationMs,
          lookBackDurationMs,
          noEmit: true,
          onSpeechStart: () => {
            if (!vadEnabledRef.current) return;
            log("VAD: speech detected (start)");
            onSpeechStart();
          },
          onSpeechEnd: () => {
            if (!vadEnabledRef.current) return;
            log("VAD: speech ended (end)");
            onSpeechEnd();
          },
          onMisfire: () => {
            if (vadEnabledRef.current) {
              log("VAD: misfire (too short)");
              onMisfire?.();
            }
          },
          onError: (err: unknown) => {
            if (vadEnabledRef.current) {
              const error = err instanceof Error ? err.message : String(err);
              log(`VAD error: ${error}`);
              onError(error);
            }
          },
        });

        void audioStream
          .pipeThrough(vadTransform)
          .pipeTo(new WritableStream<Float32Array>({ write() {} }), { signal: aborter.signal })
          .catch(() => { /* aborted or errored */ });

        vadPipelineStartedRef.current = true;
        log("VAD pipeline started");
      } catch (e) {
        const error = e instanceof Error ? e.message : String(e);
        log(`VAD pipeline setup failed: ${error}`);
        onError(error);
        throw e;
      }
    }

    // Enable event emission
    vadEnabledRef.current = true;
    log("VAD implementation: started successfully");
  }, [onSpeechStart, onSpeechEnd, onError, onMisfire, log, threshold, minSpeechDurationMs, redemptionDurationMs, lookBackDurationMs]);

  // Pause VAD
  const pause = useCallback(() => {
    log("VAD implementation: pausing");
    vadEnabledRef.current = false; // disable callbacks
    const stream = sharedStreamRef.current;
    if (stream) {
      try {
        stream.getAudioTracks().forEach((t) => { t.enabled = false; });
      } catch {}
    }
  }, [log]);

  // Get current stream
  const getStream = useCallback(() => sharedStreamRef.current, []);

  // Check if pipeline is started
  const isPipelineStarted = useCallback(() => vadPipelineStartedRef.current, []);

  // Cleanup
  const cleanup = useCallback(() => {
    log("VAD implementation: cleanup");
    const aborter = vadAbortRef.current;
    if (aborter) {
      try { aborter.abort(); } catch {}
      vadAbortRef.current = null;
    }
    vadPipelineStartedRef.current = false;
    vadEnabledRef.current = false;
    releaseSharedStream();
  }, [log, releaseSharedStream]);

  // Cleanup on unmount
  useEffect(() => {
    return cleanup;
  }, [cleanup]);

  return {
    start,
    pause,
    preload,
    getStream,
    isPipelineStarted,
    cleanup,
  };
}
