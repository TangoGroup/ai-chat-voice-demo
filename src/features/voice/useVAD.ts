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

/**
 * Simple VAD hook: takes enabled flag and callbacks, returns stream + error
 */
export function useVAD(
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
  const pipelineRef = useRef<Promise<void> | null>(null);
  const aborterRef = useRef<AbortController | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Store callbacks in refs to avoid dependency issues
  const callbacksRef = useRef({ onSpeechStart, onSpeechEnd, onError, log });
  useEffect(() => {
    callbacksRef.current = { onSpeechStart, onSpeechEnd, onError, log };
  }, [onSpeechStart, onSpeechEnd, onError, log]);

  // Start VAD when enabled
  useEffect(() => {
    if (!enabled || typeof window === "undefined" || !navigator.mediaDevices) return;

    let cancelled = false;

    async function startVAD() {
      try {
        // Get mic stream
        const stream = streamRef.current ?? await navigator.mediaDevices.getUserMedia({
          audio: RECOMMENDED_AUDIO_CONSTRAINTS,
          video: false
        });
        if (!streamRef.current) streamRef.current = stream;
        stream.getAudioTracks().forEach((t) => { t.enabled = true; });

        // Build pipeline once
        if (!pipelineRef.current) {
          const audioStream = await ingestAudioStream(stream);
          const aborter = new AbortController();
          aborterRef.current = aborter;

          const vadTransform = speechFilter({
            threshold,
            minSpeechDurationMs,
            redemptionDurationMs,
            lookBackDurationMs,
            noEmit: true,
            onSpeechStart: () => {
              if (!cancelled) {
                callbacksRef.current.log("VAD: speech detected");
                callbacksRef.current.onSpeechStart();
              }
            },
            onSpeechEnd: () => {
              if (!cancelled) {
                callbacksRef.current.log("VAD: speech ended");
                callbacksRef.current.onSpeechEnd();
              }
            },
            onMisfire: () => callbacksRef.current.log("VAD: misfire"),
            onError: (err: unknown) => {
              const msg = err instanceof Error ? err.message : String(err);
              callbacksRef.current.log(`VAD error: ${msg}`);
              if (!cancelled) {
                setError(msg);
                callbacksRef.current.onError?.(msg);
              }
            },
          });

          pipelineRef.current = audioStream
            .pipeThrough(vadTransform)
            .pipeTo(new WritableStream<Float32Array>({ write() {} }), { signal: aborter.signal })
            .catch(() => {});
        }

        callbacksRef.current.log("VAD started");
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        callbacksRef.current.log(`VAD failed: ${msg}`);
        setError(msg);
        callbacksRef.current.onError?.(msg);
      }
    }

    startVAD();

    return () => {
      cancelled = true;
      streamRef.current?.getAudioTracks().forEach((t) => { t.enabled = false; });
    };
  }, [enabled, threshold, minSpeechDurationMs, redemptionDurationMs, lookBackDurationMs]); // Removed callbacks from deps

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      aborterRef.current?.abort();
      streamRef.current?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  return { stream: streamRef.current, error };
}

/**
 * Preload VAD model (call once on mount)
 */
export async function preloadVAD(): Promise<void> {
  if (typeof window === "undefined") return;
  await preloadModel();
}

