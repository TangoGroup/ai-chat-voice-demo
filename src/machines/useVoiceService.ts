import { useMemo } from "react";
import { useMachine } from "@xstate/react";
import { createVoiceMachine } from "@/machines/voiceMachine";
import type { VoiceContext, VoiceEvents } from "@/machines/voiceMachine";

export type ControlState = "ready" | "listening_idle" | "capturing" | "processing" | "speaking_streaming" | "playing" | "error";

const CONTROL_STATES: readonly ControlState[] = [
  "ready",
  "listening_idle",
  "capturing",
  "processing",
  "speaking_streaming",
  "playing",
  "error",
] as const;

function isValidControlState(value: string): value is ControlState {
  return CONTROL_STATES.includes(value as ControlState);
}

function extractControlState(stateValue: unknown): ControlState {
  if (typeof stateValue === "string" && isValidControlState(stateValue)) {
    return stateValue;
  }
  if (typeof stateValue === "object" && stateValue !== null) {
    const keys = Object.keys(stateValue);
    if (keys.length > 0 && isValidControlState(keys[0])) {
      return keys[0];
    }
  }
  return "ready";
}

export interface VoiceSnapshot {
  value: ControlState;
  context: VoiceContext;
}

export function useVoiceService(deps: Parameters<typeof createVoiceMachine>[0]) {
  const machine = useMemo(() => createVoiceMachine(deps), [deps]);

  // Use XState's built-in useMachine hook
  const [state, send] = useMachine(machine);

  // Transform XState snapshot to our expected format
  // Extract top-level state name (XState v5 uses objects for nested states like { capturing: "recording" })
  const stateValue = extractControlState(state.value);

  const snapshot: VoiceSnapshot = {
    value: stateValue,
    context: state.context as VoiceContext
  };

  return [snapshot, send as (event: VoiceEvents) => void] as const;
}


