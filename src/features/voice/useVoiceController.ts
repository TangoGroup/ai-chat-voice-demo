"use client";
import { useMemo, useRef, useCallback, useEffect, useState } from "react";
import { useMachine } from "@xstate/react";
import { createVoiceMachine, type VoiceContext, type VoiceEvents } from "@/machines/voiceMachine";
import { TtsWsPlayer } from "@/lib/ttsWs";
import { OpenRouterAdapter } from "@/lib/aiAdapter";
import { createStopwatch, formatMs } from "@/lib/utils";
import type { ChatMessage } from "@/lib/chat";
import { speechFilter, preloadModel } from "@steelbrain/media-speech-detection-web";
import { ingestAudioStream, RECOMMENDED_AUDIO_CONSTRAINTS } from "@steelbrain/media-ingest-audio";
import { useAudioContext } from "@/components/AudioContext";

export interface VoiceControllerConfig {
  canRecord: boolean;
  log: (msg: string) => void;
  logFiltered?: (msg: string) => void;
  chatIdRef: React.MutableRefObject<string | null>;
  messages: ChatMessage[];
  onMessagesUpdate: (messages: ChatMessage[]) => void;
  onSendRef?: React.MutableRefObject<((event: { type: string; [k: string]: unknown }) => void) | null>;
  onIsRecordingChange?: (isRecording: boolean) => void;
}

export type ControlState = "ready" | "listening_idle" | "capturing" | "processing" | "speaking_streaming" | "playing" | "error";

export interface VoiceSnapshot {
  value: ControlState;
  context: VoiceContext;
}

export interface VoiceController {
  snapshot: VoiceSnapshot;
  send: (event: VoiceEvents) => void;
  vadStream: MediaStream | null;
}

/**
 * High-level orchestrator around the voice state machine.
 * Manages internal refs, recording, TTS playback, and AI streaming.
 */
export function useVoiceController(config: VoiceControllerConfig): VoiceController {
  const {
    canRecord,
    log,
    logFiltered = log,
    chatIdRef,
    messages,
    onMessagesUpdate,
    onSendRef,
    onIsRecordingChange,
  } = config;

  // Get shared AudioContext for VAD
  const { audioContextRef, initialize: initializeAudioContext } = useAudioContext();

  // Internal refs for state management
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const sharedStreamRef = useRef<MediaStream | null>(null);
  const currentAudioRef = useRef<HTMLAudioElement | null>(null);
  const ttsPlayerRef = useRef<TtsWsPlayer | null>(null);
  const ttsAbortRef = useRef<AbortController | null>(null);
  const aiAbortRef = useRef<AbortController | null>(null);
  const ttsSpeakingRef = useRef<boolean>(false);
  const ttsEndFallbackTimerRef = useRef<number | null>(null);
  const sendRef = useRef<((event: { type: string; [k: string]: unknown }) => void) | null>(null);
  const stateRef = useRef<{ value: unknown } | null>(null);
  const messagesRef = useRef(messages);
  const onMessagesUpdateRef = useRef(onMessagesUpdate);
  const isRecordingRef = useRef<boolean>(false);

  // Keep refs in sync
  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);
  useEffect(() => {
    onMessagesUpdateRef.current = onMessagesUpdate;
  }, [onMessagesUpdate]);

  // Recording functions
  const stopRecording = useCallback(() => {
    const rec = mediaRecorderRef.current;
    if (!rec) {
      isRecordingRef.current = false;
      onIsRecordingChange?.(false);
      log("stopRecording: no active MediaRecorder");
      return;
    }
    try {
      const state = (rec as MediaRecorder).state;
      log(`stopRecording: recorder.state=${state}`);
      rec.stop();
    } catch {}
    mediaRecorderRef.current = null;
    isRecordingRef.current = false;
    onIsRecordingChange?.(false);
    log("Stopping recording…");
  }, [log, onIsRecordingChange]);

  // VAD state management (integrated into voice controller for deterministic state)
  const vadStreamRef = useRef<MediaStream | null>(null);
  const vadAborterRef = useRef<AbortController | null>(null);
  const vadPipelineActiveRef = useRef<boolean>(false);
  const vadEnabledRef = useRef<boolean>(false);
  const vadAbortedRef = useRef<boolean>(false);
  const [vadError, setVadError] = useState<string | null>(null);

  // Module-scoped preload promise
  const vadPreloadPromiseRef = useRef<Promise<void> | null>(null);
  const ensureVADModelPreloaded = useCallback(async (): Promise<void> => {
    if (typeof window === "undefined") return;
    if (!vadPreloadPromiseRef.current) {
      vadPreloadPromiseRef.current = preloadModel().catch((e) => {
        vadPreloadPromiseRef.current = null;
        throw e;
      });
    }
    return vadPreloadPromiseRef.current;
  }, []);

  const startRecording = useCallback(async () => {
    const currentState = mediaRecorderRef.current?.state;
    if (!canRecord || currentState === "recording" || currentState === "paused") return;
    try {
      log(`Requesting microphone access… (recState=${currentState ?? "none"})`);
      // Use VAD stream if available, otherwise get new stream
      const stream = vadStreamRef.current ?? await navigator.mediaDevices.getUserMedia({ audio: true });
      if (!sharedStreamRef.current) {
        sharedStreamRef.current = stream;
      }
      const preferredTypes = [
        'audio/webm;codecs=opus',
        'audio/webm',
        'audio/ogg;codecs=opus',
        'audio/ogg'
      ];
      let mediaRecorder: MediaRecorder | null = null;
      for (const t of preferredTypes) {
        const hasMediaRecorder = "MediaRecorder" in window;
        type MediaRecorderStatic = typeof MediaRecorder & { isTypeSupported?: (mimeType: string) => boolean };
        const MR = MediaRecorder as unknown as MediaRecorderStatic;
        if (hasMediaRecorder && typeof MR.isTypeSupported === "function" && MR.isTypeSupported(t)) {
          try { mediaRecorder = new MediaRecorder(stream, { mimeType: t }); log(`MediaRecorder using ${t}`); break; } catch {}
        }
      }
      if (!mediaRecorder) {
        mediaRecorder = new MediaRecorder(stream);
        log("MediaRecorder using default type");
      }
      mediaRecorderRef.current = mediaRecorder;
      audioChunksRef.current = [];
      mediaRecorder.ondataavailable = (event: BlobEvent) => { if (event.data && event.data.size > 0) audioChunksRef.current.push(event.data); };
      mediaRecorder.onstop = async () => {
        const audioBlob = new Blob(audioChunksRef.current, { type: "audio/webm" });
        log(`MediaRecorder onstop: chunks=${audioChunksRef.current.length} size=${audioBlob.size}`);
        if (audioBlob.size === 0) { log("Recorded audio is empty. Skipping STT."); return; }
        log("Recorder stopped. Dispatching blob to machine…");
        sendRef.current?.({ type: "RECORDING_STOPPED", blob: audioBlob });
      };
      mediaRecorder.onerror = (e: unknown) => {
        const possible = e as { error?: { message?: string } };
        const msg = possible?.error?.message ?? String((possible as unknown as { error?: unknown })?.error ?? "Unknown MediaRecorder error");
        log(`MediaRecorder error: ${msg}`);
      };
      mediaRecorder.start();
      isRecordingRef.current = true;
      onIsRecordingChange?.(true);
      log(`Recording started. state=${mediaRecorder.state}`);
    } catch (error) {
      const err = error as Error;
      log(`Microphone access error: ${err.message}`);
      console.error("Microphone access error", error);
    }
  }, [canRecord, log, onIsRecordingChange]);

  // VAD management functions
  const startVAD = useCallback(async () => {
    if (!canRecord || typeof window === "undefined" || !navigator.mediaDevices) return;
    
    log("VAD: starting");
    vadAbortedRef.current = false;
    
    // If pipeline already active, just re-enable tracks
    if (vadPipelineActiveRef.current && vadAborterRef.current && vadStreamRef.current) {
      vadStreamRef.current.getAudioTracks().forEach((t) => { t.enabled = true; });
      vadEnabledRef.current = true;
      log("VAD: re-enabled (pipeline already active)");
      return;
    }

    try {
      // Ensure model preloaded
      await ensureVADModelPreloaded();
      if (vadAbortedRef.current) return;
      log("VAD: model ready");

      // Get or create mic stream
      const stream = vadStreamRef.current ?? await navigator.mediaDevices.getUserMedia({
        audio: RECOMMENDED_AUDIO_CONSTRAINTS,
        video: false
      });
      if (vadAbortedRef.current) {
        stream.getTracks().forEach((t) => t.stop());
        return;
      }
      if (!vadStreamRef.current) vadStreamRef.current = stream;
      stream.getAudioTracks().forEach((t) => { t.enabled = true; });

      // Abort any existing pipeline
      if (vadAborterRef.current) {
        vadAborterRef.current.abort();
      }
      const aborter = new AbortController();
      vadAborterRef.current = aborter;

      // Ensure shared AudioContext is initialized (helps with autoplay policies)
      // Note: ingestAudioStream creates its own AudioContext, but initializing ours first
      // helps ensure browser audio permissions are ready
      if (!audioContextRef.current) {
        try {
          await initializeAudioContext();
        } catch (e) {
          log(`VAD: AudioContext init warning: ${e instanceof Error ? e.message : String(e)}`);
        }
      }

      // Build pipeline (ingestAudioStream creates its own AudioContext internally)
      log("VAD: building audio pipeline...");
      const audioStream = await ingestAudioStream(stream);
      if (vadAbortedRef.current) {
        aborter.abort();
        return;
      }

      const vadTransform = speechFilter({
        threshold: 0.45,
        minSpeechDurationMs: 400,
        redemptionDurationMs: 1400,
        lookBackDurationMs: 384,
        noEmit: true,
        onSpeechStart: () => {
          if (vadEnabledRef.current && !vadAbortedRef.current && sendRef.current) {
            log("VAD: speech detected");
            sendRef.current({ type: "VAD_SPEECH_START" });
          }
        },
        onSpeechEnd: () => {
          if (vadEnabledRef.current && !vadAbortedRef.current && sendRef.current && isRecordingRef.current) {
            log("VAD: speech ended");
            sendRef.current({ type: "VAD_SILENCE_TIMEOUT" });
          }
        },
        onError: (err: unknown) => {
          const msg = err instanceof Error ? err.message : String(err);
          log(`VAD error: ${msg}`);
          if (vadEnabledRef.current && !vadAbortedRef.current) {
            setVadError(msg);
          }
        },
      });

      vadPipelineActiveRef.current = true;
      vadEnabledRef.current = true;
      log("VAD: pipeline started");

      audioStream
        .pipeThrough(vadTransform)
        .pipeTo(new WritableStream<Float32Array>({ write() {} }), { signal: aborter.signal })
        .catch(() => { /* aborted or errored */ })
        .finally(() => {
          if (vadAborterRef.current === aborter) {
            vadPipelineActiveRef.current = false;
          }
        });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      log(`VAD failed: ${msg}`);
      if (!vadAbortedRef.current) {
        setVadError(msg);
      }
    }
  }, [canRecord, log, ensureVADModelPreloaded, audioContextRef, initializeAudioContext]);

  const stopVAD = useCallback(() => {
    log("VAD: stopping");
    vadEnabledRef.current = false;
    vadAbortedRef.current = true;
    if (vadAborterRef.current) {
      vadAborterRef.current.abort();
      vadAborterRef.current = null;
    }
    vadPipelineActiveRef.current = false;
    vadStreamRef.current?.getAudioTracks().forEach((t) => { t.enabled = false; });
  }, [log]);

  // Machine callbacks
  const onStartListening = useCallback(async () => {
    if (!canRecord) return;
    log("Starting listening…");
    await startVAD();
  }, [canRecord, log, startVAD]);

  const onStopAll = useCallback(() => {
    stopRecording();
    stopVAD();
    if (currentAudioRef.current) {
      try { currentAudioRef.current.pause(); } catch {}
      currentAudioRef.current = null;
    }
    ttsSpeakingRef.current = false;
    try { ttsAbortRef.current?.abort(); } catch {}
    ttsAbortRef.current = null;
    try { aiAbortRef.current?.abort(); } catch {}
    aiAbortRef.current = null;
    try { ttsPlayerRef.current?.close(); } catch {}
    ttsPlayerRef.current = null;
    if (ttsEndFallbackTimerRef.current !== null) { try { clearTimeout(ttsEndFallbackTimerRef.current); } catch {} ttsEndFallbackTimerRef.current = null; }
  }, [stopRecording, stopVAD]);

  const startCapture = useCallback(() => { void startRecording(); }, [startRecording]);
  const stopCapture = useCallback(() => { stopRecording(); }, [stopRecording]);

  const stopPlayback = useCallback(() => {
    if (currentAudioRef.current) {
      try { currentAudioRef.current.pause(); } catch {}
      currentAudioRef.current = null;
    }
    ttsSpeakingRef.current = false;
    try { ttsAbortRef.current?.abort(); } catch {}
    ttsAbortRef.current = null;
    try { ttsPlayerRef.current?.close(); } catch {}
    ttsPlayerRef.current = null;
    if (ttsEndFallbackTimerRef.current !== null) { try { clearTimeout(ttsEndFallbackTimerRef.current); } catch {} ttsEndFallbackTimerRef.current = null; }
  }, []);

  const processPipeline = useCallback(async ({ blob }: { blob: Blob }) => {
    const sw = createStopwatch();
    log("Recording stopped. Transcribing with ElevenLabs…");
    const form = new FormData();
    form.append("file", blob, "audio.webm");
    const sttResp = await fetch("/api/stt", { method: "POST", body: form });
    const sttNetworkMs = sw.splitMs();
    log(`STT response status: ${sttResp.status} (network: ${formatMs(sttNetworkMs)})`);
    if (!sttResp.ok) throw new Error("STT failed");
    const sttData = (await sttResp.json()) as { transcription?: string; text?: string };
    const sttParseMs = sw.splitMs();
    log(`STT parsed (${formatMs(sttParseMs)})`);
    const transcribedText = (sttData?.transcription || sttData?.text || "").trim();
    if (!transcribedText) throw new Error("No transcription captured");
    log(`Transcribed: "${transcribedText}"`);

    log(`Starting AI streaming… chatId=${chatIdRef.current ?? "none"}`);
    const apiKey = process.env.NEXT_PUBLIC_ELEVENLABS_API_KEY || "";
    const modelId = process.env.NEXT_PUBLIC_ELEVENLABS_MODEL_ID || process.env.ELEVENLABS_MODEL_ID || "eleven_flash_v2_5";
    const voiceId = process.env.NEXT_PUBLIC_ELEVENLABS_VOICE_ID || process.env.ELEVENLABS_VOICE_ID || "";
    if (!apiKey || !voiceId) {
      const msg = "Missing ElevenLabs API key or Voice ID for WS";
      log(msg);
      throw new Error(msg);
    }

    try { ttsAbortRef.current?.abort(); } catch {}
    ttsAbortRef.current = null;
    try { aiAbortRef.current?.abort(); } catch {}
    aiAbortRef.current = null;

    // Reuse existing player or create one if it doesn't exist
    // This ensures we reuse the same Audio element, preventing lost references
    let player = ttsPlayerRef.current;
    if (!player) {
      player = new TtsWsPlayer({
        apiKey,
        voiceId,
        modelId,
        chunkLengthSchedule: [80, 120, 180, 240],
        onLog: logFiltered,
        onVolume: () => {},
        onFirstAudio: () => {
          ttsSpeakingRef.current = true;
          try { if (sendRef.current) sendRef.current({ type: "TTS_STARTED" }); } catch {}
        },
        onFinal: () => {
          ttsSpeakingRef.current = false;
          try { if (sendRef.current) sendRef.current({ type: "TTS_ENDED" }); } catch {}
        },
        onPlaybackEnded: () => {
          const currentStateValue = stateRef.current 
            ? (typeof stateRef.current.value === "string" 
                ? stateRef.current.value 
                : JSON.stringify(stateRef.current.value))
            : "unknown";
          log(`TTS playback ended -> AUDIO_ENDED (current machine state: ${currentStateValue})`);
          if (!sendRef.current) {
            log("ERROR: sendRef.current is null, cannot dispatch AUDIO_ENDED");
            return;
          }
          try {
            const event = { type: "AUDIO_ENDED" as const };
            log(`Dispatching AUDIO_ENDED event: ${JSON.stringify(event)}`);
            sendRef.current(event);
            log("AUDIO_ENDED dispatched successfully");
          } catch (error) {
            log(`ERROR dispatching AUDIO_ENDED: ${String(error)}`);
          }
        },
      });
      ttsPlayerRef.current = player;
    }

    try {
      await player.connect();
    } catch (e) {
      const errMsg = `TTS WS connect failed: ${(e as Error).message}`;
      log(errMsg);
      throw e;
    }
    const wsStartMs = sw.splitMs();
    log(`TTS WS connected (${formatMs(wsStartMs)})`);

    const ttsAborter = new AbortController();
    ttsAbortRef.current = ttsAborter;

    const currentMessages = messagesRef.current;
    const seedBase: ReadonlyArray<ChatMessage> = currentMessages.length === 0 ? [{ role: "system", content: "" }] : [];
    let currentMsgs: ChatMessage[] = [...seedBase, ...currentMessages, { role: "user", content: transcribedText }, { role: "assistant", content: "" }];
    try { onMessagesUpdateRef.current(currentMsgs); } catch {}
    log(`AI request → messages=${currentMsgs.length - 1}`);

    const aiAborter = new AbortController();
    aiAbortRef.current = aiAborter;
    let assembledText = "";

    const aiAdapter = new OpenRouterAdapter();
    const aiHandle = aiAdapter.start({
      model: process.env.LLM_MODEL || "openai/gpt-4o",
      messages: (() => {
        const base: ReadonlyArray<ChatMessage> = currentMessages.length === 0 ? [{ role: "system", content: "" }] : [];
        const withUser: ChatMessage[] = [...base, ...currentMessages, { role: "user", content: transcribedText }];
        return withUser.slice(-24);
      })(),
      signal: aiAborter.signal,
      chatId: chatIdRef.current,
    });

    aiHandle.onDelta((token) => {
      if (token.length > 0) {
        assembledText += token;
        const shouldFlush = /[\.!?\n]$/.test(token) || token.length >= 40;
        player.sendText(token, { flush: shouldFlush });
        try {
          const next = currentMsgs.slice();
          const last = next[next.length - 1];
          if (last && last.role === "assistant") {
            next[next.length - 1] = { role: "assistant", content: (last.content || "") + token };
            currentMsgs = next;
            onMessagesUpdateRef.current(next);
          }
        } catch {}
      }
    });

    aiHandle.onDone(() => {
      player.flush();
      log(`AI done; flushed TTS buffer chatId=${chatIdRef.current ?? "none"}`);
      if (assembledText.trim().length > 0) {
        log(`AI final: "${assembledText}"`);
        player.markAiFinal();
      }
      if (aiAbortRef.current === aiAborter) aiAbortRef.current = null;
    });

    aiHandle.onError((e) => {
      log(`AI error: ${String(e)} chatId=${chatIdRef.current ?? "none"}`);
    });

    await new Promise<void>((resolve, reject) => {
      const originalOnDone = aiHandle.onDone;
      const originalOnError = aiHandle.onError;
      aiHandle.onDone = (finalText) => {
        originalOnDone(finalText);
        resolve();
      };
      aiHandle.onError = (e) => {
        originalOnError(e);
        reject(e);
      };
    });

    return { transcribedText, answerText: assembledText, audioBuffer: new ArrayBuffer(0) };
  }, [log, logFiltered, chatIdRef]);

  // Create machine with memoized callbacks
  const machine = useMemo(() => createVoiceMachine({
    onStartListening,
    onStopAll,
    processPipeline,
    log,
    startCapture,
    stopCapture,
    stopPlayback,
    startVAD,
    stopVAD,
  }), [
    onStartListening,
    onStopAll,
    processPipeline,
    log,
    startCapture,
    stopCapture,
    stopPlayback,
    startVAD,
    stopVAD,
  ]);

  const [state, send] = useMachine(machine);

  // Log state changes for debugging and update ref
  useEffect(() => {
    stateRef.current = { value: state.value };
    const stateValue = typeof state.value === "string" ? state.value : JSON.stringify(state.value);
    log(`machine state changed: ${stateValue}`);
  }, [state.value, log]);

  // Store send in ref for use in callbacks (needed because processPipeline is created before send exists)
  useEffect(() => {
    sendRef.current = send as unknown as (e: { type: string; [k: string]: unknown }) => void;
    if (onSendRef) {
      onSendRef.current = send as unknown as (e: { type: string; [k: string]: unknown }) => void;
    }
  }, [send, onSendRef]);

  const snapshot: VoiceSnapshot = {
    value: state.value as ControlState,
    context: state.context as VoiceContext
  };

  // Cleanup VAD on unmount
  useEffect(() => {
    return () => {
      stopVAD();
      vadStreamRef.current?.getTracks().forEach((t) => t.stop());
      vadStreamRef.current = null;
    };
  }, [stopVAD]);

  return { snapshot, send, vadStream: vadStreamRef.current };
}






