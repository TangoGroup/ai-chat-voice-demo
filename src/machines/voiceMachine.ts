import { setup, assign, fromPromise, type DoneActorEvent } from "xstate";

// Visualizer voice state union reused across the app
export type VoiceVisualState = "passive" | "listening" | "thinking" | "speaking";

export interface VoiceContext {
  transcribedText: string | null;
  answerText: string | null;
  audioBuffer: ArrayBuffer | null;
  error: string | null;
  recordingBlob: Blob | null;
  // Streaming (WS TTS + SSE) coordination flags
  isStreaming: boolean;
  streamSseDone: boolean;
  streamTtsDone: boolean;
}

export type VoiceEvents =
  | { type: "START_LISTENING" }
  | { type: "STOP_ALL" }
  | { type: "VAD_SPEECH_START" }
  | { type: "VAD_SILENCE_TIMEOUT" }
  | { type: "RECORDING_STOPPED"; blob: Blob }
  | { type: "AUDIO_ENDED" }
  | { type: "ERROR"; message: string }
  | { type: "TTS_STARTED" }
  | { type: "TTS_ENDED" };

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
  processPipeline: (input: ProcessInput) => Promise<ProcessOutput>;
  log: (msg: string) => void;
  startCapture: () => void; // begin MediaRecorder for current utterance
  stopCapture: () => void; // stop MediaRecorder -> will emit RECORDING_STOPPED
  stopPlayback: () => void; // stop currently playing audio if any
  startVAD: () => void; // start VAD pipeline
  stopVAD: () => void; // stop VAD pipeline
  isInteractiveEnabled: () => boolean; // check if interactive mode is enabled
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
      // Lifecycle controls
      startListeningInfra: () => { d.log("machine: startListeningInfra"); d.onStartListening(); },
      stopAll: () => { d.log("machine: stopAll"); d.onStopAll(); },
      startCapture: () => { d.log("machine: startCapture"); d.startCapture(); },
      stopCapture: () => { d.log("machine: stopCapture"); d.stopCapture(); },
      stopPlayback: () => { d.log("machine: stopPlayback"); d.stopPlayback(); },
      startVAD: () => { d.log("machine: startVAD"); d.startVAD(); },
      stopVAD: () => { d.log("machine: stopVAD"); d.stopVAD(); },
      stopVADIfNotInteractive: () => {
        if (!d.isInteractiveEnabled()) {
          d.log("machine: stopVAD (interactive disabled)");
          d.stopVAD();
        } else {
          d.log("machine: keeping VAD active (interactive enabled)");
        }
      },

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

      // Streaming coordination
      markStreamingOn: assign(() => ({ isStreaming: true } as Partial<VoiceContext>)),
      markSseDone: assign(() => ({ streamSseDone: true } as Partial<VoiceContext>)),
      markTtsDone: assign(() => ({ streamTtsDone: true } as Partial<VoiceContext>)),
      clearStreaming: assign(() => ({ isStreaming: false, streamSseDone: false, streamTtsDone: false } as Partial<VoiceContext>)),
    },
    guards: {
      hasAudioBuffer: (params) => {
        const evt = params.event as unknown;
        if (!isProcessDoneEvent(evt)) return false;
        const buf = (evt as { output?: { audioBuffer?: unknown } }).output?.audioBuffer as unknown;
        const byteLength = (buf as { byteLength?: unknown })?.byteLength;
        return typeof byteLength === "number" && byteLength > 0;
      },
      isStreaming: ({ context }) => {
        return context.isStreaming === true && (!context.streamSseDone || !context.streamTtsDone);
      },
      isStreamingAndTtsDone: ({ context }) => {
        return context.isStreaming === true && context.streamTtsDone === true;
      },
    },
  }).createMachine({
    id: "voice",
    initial: "ready",
    context: {
      transcribedText: null,
      answerText: null,
      audioBuffer: null,
      error: null,
      recordingBlob: null,
      isStreaming: false,
      streamSseDone: false,
      streamTtsDone: false,
    },
    states: {
          ready: {
            on: {
              START_LISTENING: {
                target: "listening_idle",
              },
            },
          },
          listening_idle: {
            id: "control_listening_idle",
            entry: [
              "startListeningInfra",
              "startVAD",
              () => { d.log("machine: entered listening_idle state"); },
            ],
            on: {
              STOP_ALL: { target: "ready", actions: ["stopAll", "stopVAD"] },
              // Ensure any residual playback (e.g., WS TTS) is stopped when user interrupts from idle
              VAD_SPEECH_START: { target: "capturing", actions: ["stopPlayback", "startCapture"] },
            },
          },
          capturing: {
            // VAD is already active from listening_idle, stays active during capture
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
              STOP_ALL: { target: "ready", actions: ["stopAll", "stopVAD"] },
              // Allow immediate retrigger during stopping to begin a new utterance
              VAD_SPEECH_START: { target: ".recording", actions: ["stopPlayback", "startCapture"] },
            },
          },
          processing: {
            id: "control_processing",
            entry: ["stopVADIfNotInteractive"],
            on: {
              // Stop entirely from any state
              STOP_ALL: { target: "ready", actions: ["stopAll", "clearStreaming"] },
              VAD_SPEECH_START: { target: "capturing", actions: ["stopPlayback", "startCapture"] },
              TTS_STARTED: { actions: "markStreamingOn" },
              TTS_ENDED: { actions: "markTtsDone" },
              // Handle audio ending even if we're still processing (can happen with fast streaming)
              AUDIO_ENDED: {
                target: "listening_idle",
                actions: [
                  () => { 
                    d.log("machine: AUDIO_ENDED received in processing state, transitioning to listening_idle");
                  },
                  "clearStreaming",
                ],
              },
            },
            invoke: {
              src: "processActor",
              input: ({ context }) => ({ blob: context.recordingBlob! }),
              onDone: [
                { guard: "hasAudioBuffer", target: "playing", actions: "storeProcessOutput" },
                // Streaming path: SSE finished. Always enter speaking_streaming and wait for actual playback end.
                { target: "speaking_streaming", actions: ["storeProcessOutput", "markSseDone"] },
              ],
              onError: {
                target: "error",
                actions: "storeErrorFromEvent",
              },
            },
          },
          speaking_streaming: {
            entry: ["stopVADIfNotInteractive"],
            on: {
              // Stop entirely from any state
              STOP_ALL: { target: "ready", actions: ["stopAll", "clearStreaming"] },
              VAD_SPEECH_START: { target: "capturing", actions: ["stopPlayback", "startCapture", "clearStreaming"] },
              // When actual audio playback finishes, return immediately
              AUDIO_ENDED: {
                target: "listening_idle",
                actions: [
                  () => { 
                    d.log("machine: AUDIO_ENDED event received in speaking_streaming state");
                  },
                  "clearStreaming",
                  () => { 
                    d.log("machine: transitioning from speaking_streaming to listening_idle");
                  },
                ],
              },
            },
          },
          playing: {
            entry: ["stopVADIfNotInteractive"],
            on: {
              // Stop entirely from any state
              STOP_ALL: { target: "ready", actions: ["stopAll", "clearStreaming"] },
              VAD_SPEECH_START: { target: "capturing", actions: ["stopPlayback", "startCapture"] },
              AUDIO_ENDED: {
                target: "listening_idle",
                actions: "clearAudioBuffer",
              },
            },
          },
          error: {
            on: {
              START_LISTENING: {
                target: "listening_idle",
                actions: "clearError",
              },
              STOP_ALL: { target: "ready", actions: "stopAll" },
            },
          },
        },
    });

  return logic;
}

export type VoiceMachine = ReturnType<typeof createVoiceMachine>;


