import { setup, assign } from "xstate";

export interface VADContext {
  isEnabled: boolean;
  isPipelineStarted: boolean;
  error: string | null;
  stream: MediaStream | null;
  abortController: AbortController | null;
}

export type VADEvents =
  | { type: "VAD_TURN_ON" }
  | { type: "VAD_TURN_OFF" }
  | { type: "VAD_SPEECH_START" }
  | { type: "VAD_SILENCE_TIMEOUT" }
  | { type: "VAD_ERROR"; error: string }
  | { type: "VAD_RESET" };

export interface VADMachineDeps {
  onSpeechStart: () => void;
  onSpeechEnd: () => void;
  onError: (error: string) => void;
  onStart: () => Promise<void>;
  onStop: () => void;
  log: (msg: string) => void;
}

export function createVADMachine(deps: VADMachineDeps) {
  const d = deps;

  return setup({
    types: {
      context: {} as VADContext,
      events: {} as VADEvents,
    },
    actions: {
      // Lifecycle actions
      startVAD: () => { d.log("VAD machine: starting"); d.onStart(); },
      stopVAD: () => { d.log("VAD machine: stopping"); d.onStop(); },

      // Event handlers
      handleSpeechStart: () => { d.log("VAD machine: speech detected"); d.onSpeechStart(); },
      handleSpeechEnd: () => { d.log("VAD machine: speech ended"); d.onSpeechEnd(); },
      handleError: assign(({ event }) => {
        const error = (event as { error: string }).error;
        d.onError(error);
        return { error } as Partial<VADContext>;
      }),

      // Context management
      clearError: assign(() => ({ error: null } as Partial<VADContext>)),
      setEnabled: assign(() => ({ isEnabled: true } as Partial<VADContext>)),
      setDisabled: assign(() => ({ isEnabled: false } as Partial<VADContext>)),
    },
  }).createMachine({
    id: "vad",
    initial: "off",
    context: {
      isEnabled: false,
      isPipelineStarted: false,
      error: null,
      stream: null,
      abortController: null,
    },
    states: {
      off: {
        on: {
          VAD_TURN_ON: {
            target: "starting",
          },
        },
      },
      starting: {
        entry: ["startVAD", "setEnabled"],
        on: {
          VAD_SPEECH_START: {
            target: "detecting",
            actions: "handleSpeechStart",
          },
          VAD_ERROR: {
            target: "error",
            actions: "handleError",
          },
          VAD_TURN_OFF: {
            target: "off",
            actions: ["stopVAD", "setDisabled"],
          },
        },
      },
      detecting: {
        on: {
          VAD_SILENCE_TIMEOUT: {
            target: "starting",
            actions: "handleSpeechEnd",
          },
          VAD_SPEECH_START: {
            // Stay in detecting state
            actions: "handleSpeechStart",
          },
          VAD_ERROR: {
            target: "error",
            actions: "handleError",
          },
          VAD_TURN_OFF: {
            target: "off",
            actions: ["stopVAD", "setDisabled"],
          },
        },
      },
      error: {
        entry: ["setDisabled"],
        on: {
          VAD_RESET: {
            target: "off",
            actions: "clearError",
          },
          VAD_TURN_ON: {
            target: "starting",
            actions: "clearError",
          },
        },
      },
    },
  });
}

export type VADMachine = ReturnType<typeof createVADMachine>;
