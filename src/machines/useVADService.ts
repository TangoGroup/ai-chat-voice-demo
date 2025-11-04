import { useMemo } from "react";
import { useMachine } from "@xstate/react";
import { createVADMachine } from "@/machines/vadMachine";
import type { VADContext, VADEvents } from "@/machines/vadMachine";

export type VADState = "off" | "starting" | "detecting" | "error";

export interface VADSnapshot {
  value: VADState;
  context: VADContext;
}

export function useVADService(deps: Parameters<typeof createVADMachine>[0]) {
  const machine = useMemo(() => createVADMachine(deps), [deps]);

  // Use XState's built-in useMachine hook
  const [state, send] = useMachine(machine);

  // Transform XState snapshot to our expected format
  const snapshot: VADSnapshot = {
    value: state.value as VADState,
    context: state.context as VADContext,
  };

  return [snapshot, send as (event: VADEvents) => void] as const;
}
