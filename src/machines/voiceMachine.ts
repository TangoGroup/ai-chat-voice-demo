import { setup, createMachine, assign, fromPromise, raise, type DoneActorEvent } from "xstate";

// Visualizer voice state union reused across the app
export type VoiceVisualState = "passive" | "listening" | "thinking" | "speaking";

export interface VoiceContext {
  transcribedText: string | null;
  answerText: string | null;
  audioBuffer: ArrayBuffer | null;
  error: string | null;
  recordingBlob: Blob | null;
}

export type VoiceEvents =
  | { type: "START_LISTENING" }
  | { type: "STOP_ALL" }
  | { type: "VAD_SPEECH_START" }
  | { type: "VAD_SILENCE_TIMEOUT" }
  | { type: "RECORDING_STOPPED"; blob: Blob }
  | { type: "AUDIO_ENDED" }
  | { type: "ERROR"; message: string }
  | { type: "VAD_TURN_ON" }
  | { type: "VAD_TURN_OFF" };

export interface ProcessInput {
  blob: Blob;
}

export interface ProcessOutput {
  transcribedText: string;
  answerText: string;
  audioBuffer: ArrayBuffer;
}

export interface VoiceMachineDeps {
  onStartListening: () => void; // ensure mic stream + start VAD infra
  onStopAll: () => void; // stop playback, capture, VAD, optionally close mic
  onVisualizerState: (state: VoiceVisualState) => void;
  processPipeline: (input: ProcessInput) => Promise<ProcessOutput>;
  log: (msg: string) => void;
  startCapture: () => void; // begin MediaRecorder for current utterance
  stopCapture: () => void; // stop MediaRecorder -> will emit RECORDING_STOPPED
  stopPlayback: () => void; // stop currently playing audio if any
}

export function createVoiceMachine(deps: VoiceMachineDeps) {
  const d = deps;

  const logic = setup({
    types: {
      context: {} as VoiceContext,
      events: {} as VoiceEvents,
    },
    actors: {
      processActor: fromPromise(async ({ input }: { input: ProcessInput }) => {
        return d.processPipeline(input);
      }),
    },
  }).createMachine({
    id: "voice",
    type: "parallel",
    context: {
      transcribedText: null,
      answerText: null,
      audioBuffer: null,
      error: null,
      recordingBlob: null,
    },
    states: {
      control: {
        initial: "ready",
        states: {
          ready: {
            entry: [raise({ type: "VAD_TURN_OFF" }), () => d.onVisualizerState("passive")],
            on: {
              START_LISTENING: {
                target: "listening_idle",
                actions: () => d.onStartListening(),
              },
            },
          },
          listening_idle: {
            entry: [raise({ type: "VAD_TURN_ON" }), () => d.onVisualizerState("listening")],
            on: {
              STOP_ALL: { target: "ready", actions: () => d.onStopAll() },
              VAD_SPEECH_START: { target: "capturing", actions: () => d.startCapture() },
            },
          },
          capturing: {
            entry: [() => d.onVisualizerState("listening")],
            on: {
              STOP_ALL: { target: "ready", actions: () => d.onStopAll() },
              VAD_SILENCE_TIMEOUT: { actions: () => d.stopCapture() },
              RECORDING_STOPPED: {
                target: "processing",
                actions: assign(({ event }) => {
                  if (event.type === "RECORDING_STOPPED") {
                    return { recordingBlob: event.blob, error: null } as Partial<VoiceContext>;
                  }
                  return {} as Partial<VoiceContext>;
                }),
              },
            },
          },
          processing: {
            entry: [() => d.onVisualizerState("thinking")],
            on: {
              STOP_ALL: { target: "ready", actions: () => d.onStopAll() },
              VAD_SPEECH_START: { target: "capturing", actions: [() => d.stopPlayback(), () => d.startCapture()] },
            },
            invoke: {
              src: "processActor",
              input: ({ context }) => ({ blob: context.recordingBlob! }),
              onDone: {
                target: "playing",
                actions: assign(({ event }) => {
                  const done = event as DoneActorEvent<ProcessOutput>;
                  return {
                    transcribedText: done.output.transcribedText,
                    answerText: done.output.answerText,
                    audioBuffer: done.output.audioBuffer,
                    error: null,
                  } as Partial<VoiceContext>;
                }),
              },
              onError: {
                target: "error",
                actions: assign(({ event }) => {
                  const errObj = (event as { error?: unknown })?.error as Error | undefined;
                  return { error: errObj?.message ?? "Unknown error" } as Partial<VoiceContext>;
                }),
              },
            },
          },
          playing: {
            entry: [() => d.onVisualizerState("speaking")],
            on: {
              STOP_ALL: { target: "ready", actions: () => d.onStopAll() },
              VAD_SPEECH_START: { target: "capturing", actions: [() => d.stopPlayback(), () => d.startCapture()] },
              AUDIO_ENDED: {
                target: "listening_idle",
                actions: assign(() => ({ audioBuffer: null } as Partial<VoiceContext>)),
              },
            },
          },
          error: {
            entry: [raise({ type: "VAD_TURN_OFF" }), () => d.onVisualizerState("passive")],
            on: {
              START_LISTENING: {
                target: "listening_idle",
                actions: assign(() => ({ error: null } as Partial<VoiceContext>)),
              },
              STOP_ALL: { target: "ready", actions: () => d.onStopAll() },
            },
          },
        },
      },
      vad: {
        initial: "off",
        states: {
          off: {
            on: {
              VAD_TURN_ON: "on",
            },
          },
          on: {
            entry: () => d.log("VAD ON"),
            exit: () => d.log("VAD OFF"),
            on: {
              VAD_TURN_OFF: "off",
            },
          },
        },
      },
    },
  });

  return logic;
}

export type VoiceMachine = ReturnType<typeof createVoiceMachine>;


