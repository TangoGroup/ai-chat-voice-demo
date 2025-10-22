"use client";
import { useMemo } from "react";
import { useVoiceService, type VoiceSnapshot } from "@/machines/useVoiceService";
import { type VoiceVisualState } from "@/machines/voiceMachine";

export interface VoiceControllerDeps {
  onStartListening: () => void;
  onStopAll: () => void;
  onVisualizerState: (state: VoiceVisualState) => void;
  processPipeline: (input: { blob: Blob }) => Promise<{ transcribedText: string; answerText: string; audioBuffer: ArrayBuffer }>;
  log: (msg: string) => void;
  startCapture: () => void;
  stopCapture: () => void;
  stopPlayback: () => void;
}

export interface VoiceController {
  snapshot: VoiceSnapshot;
  send: (event: { type: string; [k: string]: unknown }) => void;
}

/**
 * High-level orchestrator around the voice state machine.
 *
 * It wires injected side-effect deps into the machine and returns the
 * current snapshot and a typed send function for UI.
 */
export function useVoiceController(deps: VoiceControllerDeps): VoiceController {
  const [snapshot, send] = useVoiceService(useMemo(() => ({
    onStartListening: deps.onStartListening,
    onStopAll: deps.onStopAll,
    onVisualizerState: deps.onVisualizerState,
    processPipeline: deps.processPipeline,
    log: deps.log,
    startCapture: deps.startCapture,
    stopCapture: deps.stopCapture,
    stopPlayback: deps.stopPlayback,
  }), [
    deps.onStartListening,
    deps.onStopAll,
    deps.onVisualizerState,
    deps.processPipeline,
    deps.log,
    deps.startCapture,
    deps.stopCapture,
    deps.stopPlayback,
  ]));

  return { snapshot, send };
}






