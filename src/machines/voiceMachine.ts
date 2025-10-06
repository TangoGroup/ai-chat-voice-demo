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
  | { type: "VAD_TURN_OFF" }
  | { type: "TTS_STARTED" };

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

function isProcessDoneEvent(event: unknown): event is DoneActorEvent<ProcessOutput> {
  const t = (event as { type?: string })?.type;
  return typeof t === "string" && t === "xstate.done.actor.processActor";
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
    actions: {
      // VAD control events
      turnVadOn: raise({ type: "VAD_TURN_ON" }),
      turnVadOff: raise({ type: "VAD_TURN_OFF" }),

      // Visualizer updates
      vizPassive: () => d.onVisualizerState("passive"),
      vizListening: () => d.onVisualizerState("listening"),
      vizThinking: () => d.onVisualizerState("thinking"),
      vizSpeaking: () => d.onVisualizerState("speaking"),

      // Lifecycle controls
      startListeningInfra: () => { d.log("machine: startListeningInfra"); d.onStartListening(); },
      stopAll: () => { d.log("machine: stopAll"); d.onStopAll(); },
      startCapture: () => { d.log("machine: startCapture"); d.startCapture(); },
      stopCapture: () => { d.log("machine: stopCapture"); d.stopCapture(); },
      stopPlayback: () => { d.log("machine: stopPlayback"); d.stopPlayback(); },

      // Context assignments
      storeRecordingBlob: assign(({ event }) => {
        if (event.type === "RECORDING_STOPPED") {
          return { recordingBlob: event.blob, error: null } as Partial<VoiceContext>;
        }
        return {} as Partial<VoiceContext>;
      }),
      storeProcessOutput: assign((params) => {
        const evt = params.event as unknown;
        if (!isProcessDoneEvent(evt)) return {} as Partial<VoiceContext>;
        return {
          transcribedText: evt.output.transcribedText,
          answerText: evt.output.answerText,
          audioBuffer: evt.output.audioBuffer,
          error: null,
        } as Partial<VoiceContext>;
      }),
      storeErrorFromEvent: assign(({ event }) => {
        const errObj = (event as { error?: unknown })?.error as Error | undefined;
        return { error: errObj?.message ?? "Unknown error" } as Partial<VoiceContext>;
      }),
      clearAudioBuffer: assign(() => ({ audioBuffer: null } as Partial<VoiceContext>)),
      clearError: assign(() => ({ error: null } as Partial<VoiceContext>)),

      // Logging
      logVadOn: () => d.log("VAD ON"),
      logVadOff: () => d.log("VAD OFF"),
    },
    guards: {
      hasAudioBuffer: (params) => {
        const evt = params.event as unknown;
        if (!isProcessDoneEvent(evt)) return false;
        const buf = evt.output?.audioBuffer;
        return buf instanceof ArrayBuffer && buf.byteLength > 0;
      },
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
            entry: ["turnVadOff", "vizPassive"],
            on: {
              START_LISTENING: {
                target: "listening_idle",
                actions: "startListeningInfra",
              },
            },
          },
          listening_idle: {
            id: "control_listening_idle",
            entry: ["turnVadOn", "vizListening", "startListeningInfra"],
            on: {
              STOP_ALL: { target: "ready", actions: "stopAll" },
              // Ensure any residual playback (e.g., WS TTS) is stopped when user interrupts from idle
              VAD_SPEECH_START: { target: "capturing", actions: ["stopPlayback", "startCapture"] },
            },
          },
          capturing: {
            entry: ["vizListening"],
            initial: "recording",
            states: {
              recording: {
                on: {
                  VAD_SILENCE_TIMEOUT: { target: "stopping", actions: "stopCapture" },
                },
              },
              stopping: {
                // Safety net: if the recorder never fires onstop, avoid deadlock
                after: {
                  2000: { target: "#control_listening_idle" },
                },
                on: {
                  RECORDING_STOPPED: {
                    target: "#control_processing",
                    actions: "storeRecordingBlob",
                  },
                },
              },
            },
            on: {
              STOP_ALL: { target: "ready", actions: "stopAll" },
              // Allow immediate retrigger during stopping to begin a new utterance
              VAD_SPEECH_START: { target: ".recording", actions: ["stopPlayback", "startCapture"] },
            },
          },
          processing: {
            id: "control_processing",
            entry: ["vizThinking"],
            on: {
              // Interrupt: immediately return to listening (keep VAD on)
              STOP_ALL: { target: "listening_idle", actions: ["stopPlayback", "startListeningInfra"] },
              VAD_SPEECH_START: { target: "capturing", actions: ["stopPlayback", "startCapture"] },
              TTS_STARTED: { actions: "vizSpeaking" },
            },
            invoke: {
              src: "processActor",
              input: ({ context }) => ({ blob: context.recordingBlob! }),
              onDone: [
                { guard: "hasAudioBuffer", target: "playing", actions: "storeProcessOutput" },
                { target: "listening_idle", actions: "storeProcessOutput" },
              ],
              onError: {
                target: "error",
                actions: "storeErrorFromEvent",
              },
            },
          },
          playing: {
            entry: ["vizSpeaking"],
            on: {
              // Interrupt: immediately return to listening (keep VAD on)
              STOP_ALL: { target: "listening_idle", actions: ["stopPlayback", "startListeningInfra"] },
              VAD_SPEECH_START: { target: "capturing", actions: ["stopPlayback", "startCapture"] },
              AUDIO_ENDED: {
                target: "listening_idle",
                actions: "clearAudioBuffer",
              },
            },
          },
          error: {
            entry: ["turnVadOff", "vizPassive"],
            on: {
              START_LISTENING: {
                target: "listening_idle",
                actions: "clearError",
              },
              STOP_ALL: { target: "ready", actions: "stopAll" },
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
            entry: "logVadOn",
            exit: "logVadOff",
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


