"use client";
import { useMemo } from "react";
import { useMachine } from "@xstate/react";
import { createVoiceMachine, type VoiceContext, type VoiceEvents } from "@/machines/voiceMachine";

export interface VoiceControllerDeps {
  onStartListening: () => void;
  onStopAll: () => void;
  processPipeline: (input: { blob: Blob }) => Promise<{ transcribedText: string; answerText: string; audioBuffer: ArrayBuffer }>;
  log: (msg: string) => void;
  startCapture: () => void;
  stopCapture: () => void;
  stopPlayback: () => void;
}

export type ControlState = "ready" | "listening_idle" | "capturing" | "processing" | "speaking_streaming" | "playing" | "error";

export interface VoiceSnapshot {
  value: ControlState;
  context: VoiceContext;
}

export interface VoiceController {
  snapshot: VoiceSnapshot;
  send: (event: VoiceEvents) => void;
}

/**
 * High-level orchestrator around the voice state machine.
 *
 * It wires injected side-effect deps into the machine and returns the
 * current snapshot and a typed send function for UI.
 */
export function useVoiceController(deps: VoiceControllerDeps): VoiceController {
  const machine = useMemo(() => createVoiceMachine({
    onStartListening: deps.onStartListening,
    onStopAll: deps.onStopAll,
    processPipeline: deps.processPipeline,
    log: deps.log,
    startCapture: deps.startCapture,
    stopCapture: deps.stopCapture,
    stopPlayback: deps.stopPlayback,
  }), [
    deps.onStartListening,
    deps.onStopAll,
    deps.processPipeline,
    deps.log,
    deps.startCapture,
    deps.stopCapture,
    deps.stopPlayback,
  ]);

  const [state, send] = useMachine(machine);

  const snapshot: VoiceSnapshot = {
    value: state.value as ControlState,
    context: state.context as VoiceContext
  };

  return { snapshot, send };
}






