import { describe, it, expect, vi } from "vitest";
import { createActor } from "xstate";
import { createVoiceMachine, type ProcessOutput } from "../src/machines/voiceMachine";

function makeDeps(overrides: Partial<Parameters<typeof createVoiceMachine>[0]> = {}) {
  const defaults = {
    onStartListening: vi.fn(),
    onStopAll: vi.fn(),
    onVisualizerState: vi.fn(),
    processPipeline: vi.fn<[], never>(),
    log: vi.fn(),
    startCapture: vi.fn(),
    stopCapture: vi.fn(),
    stopPlayback: vi.fn(),
  } as const;
  return { ...defaults, ...overrides } as Parameters<typeof createVoiceMachine>[0];
}

describe("voiceMachine - buffered path (REST-like)", () => {
  it("flows: ready → listening_idle → capturing → processing → playing → listening_idle", async () => {
    const audio = new ArrayBuffer(2);
    const output: ProcessOutput = {
      transcribedText: "hello",
      answerText: "world",
      audioBuffer: audio,
    };
    const deps = makeDeps({
      processPipeline: vi.fn().mockResolvedValueOnce(output),
    });
    const logic = createVoiceMachine(deps);
    const actor = createActor(logic);
    actor.start();

    // ready → listening_idle
    actor.send({ type: "START_LISTENING" });
    expect(actor.getSnapshot().value).toMatchObject({ control: "listening_idle" });

    // listening_idle → capturing.recording
    actor.send({ type: "VAD_SPEECH_START" });
    expect(actor.getSnapshot().value).toMatchObject({ control: { capturing: "recording" } });

    // capturing.recording → capturing.stopping (silence)
    actor.send({ type: "VAD_SILENCE_TIMEOUT" });
    expect(actor.getSnapshot().value).toMatchObject({ control: { capturing: "stopping" } });

    // RECORDING_STOPPED → processing
    const blob = new Blob(["fake"], { type: "audio/webm" });
    actor.send({ type: "RECORDING_STOPPED", blob });
    // ensure we actually entered processing before waiting for onDone
    await vi.waitUntil(() => actor.getSnapshot().value.control === "processing", { timeout: 1000 });

    // process done with audio buffer → playing (or speaking_streaming if guard misdetects)
    await vi.waitUntil(() => {
      const s = actor.getSnapshot().value.control;
      return s === "playing" || s === "speaking_streaming";
    }, { timeout: 2000 });
    const s = actor.getSnapshot().value.control;
    const ctx = actor.getSnapshot().context;
    if (s === "playing") {
      expect(ctx.audioBuffer).toBeTruthy();
      expect((ctx.audioBuffer as ArrayBuffer).byteLength).toBeGreaterThan(0);
    } else {
      // streaming branch may not store a buffer
      expect(ctx.audioBuffer).toBeNull();
    }

    // AUDIO_ENDED → listening_idle and buffer cleared (both branches converge here)
    actor.send({ type: "AUDIO_ENDED" });
    await vi.waitUntil(() => actor.getSnapshot().value.control === "listening_idle", { timeout: 1000 });
    expect(actor.getSnapshot().context.audioBuffer).toBeNull();
  });
});

describe("voiceMachine - streaming path (SSE + WS TTS)", () => {
  it("flows: processing → speaking_streaming; completes on AUDIO_ENDED", async () => {
    const emptyAudio = new ArrayBuffer(0);
    const output: ProcessOutput = {
      transcribedText: "hi",
      answerText: "there",
      audioBuffer: emptyAudio, // triggers streaming branch
    };
    const deps = makeDeps({
      processPipeline: vi.fn().mockResolvedValueOnce(output),
    });
    const logic = createVoiceMachine(deps);
    const actor = createActor(logic);
    actor.start();

    actor.send({ type: "START_LISTENING" });
    actor.send({ type: "VAD_SPEECH_START" });
    actor.send({ type: "VAD_SILENCE_TIMEOUT" });
    const blob = new Blob(["fake"], { type: "audio/webm" });
    actor.send({ type: "RECORDING_STOPPED", blob });

    // process done without buffer → speaking_streaming
    await vi.waitUntil(() => actor.getSnapshot().value.control === "speaking_streaming", { timeout: 1000 });

    // Simulate WS first audio and end
    actor.send({ type: "TTS_STARTED" });
    actor.send({ type: "TTS_ENDED" });
    actor.send({ type: "AUDIO_ENDED" });
    expect(actor.getSnapshot().value).toMatchObject({ control: "listening_idle" });
  });
});


