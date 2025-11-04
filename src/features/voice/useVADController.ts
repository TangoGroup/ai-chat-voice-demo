"use client";
import { useMemo, useCallback } from "react";
import { useVADService, type VADSnapshot } from "@/machines/useVADService";
import { useVADImplementation } from "@/features/voice/useVADImplementation";
import { type VADEvents } from "@/machines/vadMachine";

export interface VADControllerDeps {
  onSpeechStart: () => void;
  onSpeechEnd: () => void;
  onError: (error: string) => void;
  log: (msg: string) => void;
  threshold?: number;
  minSpeechDurationMs?: number;
  redemptionDurationMs?: number;
  lookBackDurationMs?: number;
}

export interface VADController {
  snapshot: VADSnapshot;
  send: (event: VADEvents) => void;
  start: () => void;
  stop: () => void;
  reset: () => void;
  preload: () => Promise<void>;
  getStream: () => MediaStream | null;
  isPipelineStarted: () => boolean;
  cleanup: () => void;
}

/**
 * High-level orchestrator around the VAD state machine and implementation.
 *
 * It wires injected side-effect deps into the machine and returns the
 * current snapshot, a typed send function, and convenience methods for UI.
 */
export function useVADController(deps: VADControllerDeps): VADController {
  const {
    onSpeechStart,
    onSpeechEnd,
    onError,
    log,
    threshold,
    minSpeechDurationMs,
    redemptionDurationMs,
    lookBackDurationMs,
  } = deps;

  // Create VAD implementation
  const vadImpl = useVADImplementation({
    onSpeechStart,
    onSpeechEnd,
    onError,
    log,
    threshold,
    minSpeechDurationMs,
    redemptionDurationMs,
    lookBackDurationMs,
  });

  // Machine callbacks that delegate to implementation
  const handleStart = useCallback(async () => {
    await vadImpl.start();
  }, [vadImpl]);

  const handleStop = useCallback(() => {
    vadImpl.pause();
  }, [vadImpl]);

  const handleError = useCallback((error: string) => {
    log(`VAD controller error: ${error}`);
    onError(error);
  }, [log, onError]);

  const [snapshot, send] = useVADService(useMemo(() => ({
    onSpeechStart,
    onSpeechEnd,
    onError: handleError,
    onStart: handleStart,
    onStop: handleStop,
    log,
  }), [
    onSpeechStart,
    onSpeechEnd,
    handleError,
    handleStart,
    handleStop,
    log,
  ]));

  const start = () => send({ type: "VAD_TURN_ON" });
  const stop = () => send({ type: "VAD_TURN_OFF" });
  const reset = () => send({ type: "VAD_RESET" });

  return {
    snapshot,
    send,
    start,
    stop,
    reset,
    preload: vadImpl.preload,
    getStream: vadImpl.getStream,
    isPipelineStarted: vadImpl.isPipelineStarted,
    cleanup: vadImpl.cleanup,
  };
}
