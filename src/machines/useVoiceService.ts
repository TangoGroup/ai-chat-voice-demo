import { useMemo } from "react";
import { useMachine } from "@xstate/react";
import { createVoiceMachine } from "@/machines/voiceMachine";
import type { VoiceContext, VoiceEvents } from "@/machines/voiceMachine";

export type ControlState = "ready" | "listening_idle" | "capturing" | "processing" | "speaking_streaming" | "playing" | "error";
export type VadState = "off" | "on";

export interface VoiceSnapshot {
  value: { control: ControlState; vad: VadState };
  context: VoiceContext;
}

export function useVoiceService(deps: Parameters<typeof createVoiceMachine>[0]) {
  const machine = useMemo(() => createVoiceMachine(deps), [deps]);

  // Use XState's built-in useMachine hook
  const [state, send] = useMachine(machine);

  // Transform XState snapshot to our expected format
  const snapshot: VoiceSnapshot = {
    value: state.value as { control: ControlState; vad: VadState },
    context: state.context as VoiceContext
  };

  return [snapshot, send as (event: VoiceEvents) => void] as const;
}


