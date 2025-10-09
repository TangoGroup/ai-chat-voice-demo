"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { speechFilter, preloadModel } from "@steelbrain/media-speech-detection-web";
import { ingestAudioStream, RECOMMENDED_AUDIO_CONSTRAINTS } from "@steelbrain/media-ingest-audio";
import { Square, Sun, Moon, Speech, SquarePen, Mic, MicOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import Visualizer from "@/components/Visualizer/Visualizer";
import { useTheme } from "@/components/Theme/ThemeProvider";
import { createStopwatch, formatMs, getStoredChatId, setChatId, clearChatId } from "@/lib/utils";
import { TtsWsPlayer } from "@/lib/ttsWs";
import { streamSSE } from "@/lib/sse";
import { useChat, type ChatMessage } from "@/lib/chat";
import { GlassButton } from "@/components/ui/glass-button";
import { useQueryClient } from "@tanstack/react-query";
import { type VoiceVisualState } from "@/machines/voiceMachine";
import { useVoiceService } from "@/machines/useVoiceService";
import ConsolePanel from "@/components/Console/ConsolePanel";

export default function Home() {
  const [logs, setLogs] = useState<string[]>([]);
  const [isRecording, setIsRecording] = useState<boolean>(false);
  const [isMicMuted, setIsMicMuted] = useState<boolean>(false);
  const [interactiveEnabled, setInteractiveEnabled] = useState<boolean>(false);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const consoleRef = useRef<HTMLTextAreaElement | null>(null);
  const [canRecord, setCanRecord] = useState<boolean>(false);
  const { theme, toggle } = useTheme();
  const chatIdRef = useRef<string | null>(null);
  const queryClient = useQueryClient();
  // Chat history via React Query + localStorage (client-side context)
  const { messages, setMessages } = useChat(chatIdRef.current ?? "default", undefined);
  const [hud, setHud] = useState<{ state: string; mic: number; tts: number; eff: number } | null>(null);

  // Shared mic stream and machine sender
  const sharedStreamRef = useRef<MediaStream | null>(null);
  const sendRef = useRef<((event: { type: string; [k: string]: unknown }) => void) | null>(null);
  // VAD runtime flags
  const vadEnabledRef = useRef<boolean>(false);
  const vadPipelineStartedRef = useRef<boolean>(false);
  // Interrupt policy and state refs for VAD gating
  const interactiveEnabledRef = useRef<boolean>(false);
  const isRecordingRef = useRef<boolean>(false);
  const isListeningRef = useRef<boolean>(false);

  useEffect(() => {
    setCanRecord(typeof window !== "undefined" && "MediaRecorder" in window);
  }, []);

  // Initialize chat id from localStorage (client-only)
  useEffect(() => {
    const id = getStoredChatId();
    if (id) {
      chatIdRef.current = id;
    }
  }, []);

  useEffect(() => {
    if (consoleRef.current) {
      consoleRef.current.scrollTop = consoleRef.current.scrollHeight;
    }
  }, [logs.length]);

  const appendLog = useCallback((message: string) => {
    const timestamp = new Date().toLocaleTimeString();
    setLogs((prev) => [...prev, `[${timestamp}] ${message}`]);
  }, []);

  const clearLogs = useCallback(() => { setLogs([]); }, []);
  // Hook Visualizer into the in-app console HUD
  const vizLogsRef = useRef<(msg: string) => void>(() => {});
  useEffect(() => { vizLogsRef.current = appendLog; }, [appendLog]);

  // VAD model preload using library helper
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        await preloadModel();
        if (!cancelled) appendLog("VAD model preloaded");
      } catch (e) {
        if (!cancelled) appendLog(`VAD preload failed: ${e instanceof Error ? e.message : String(e)}`);
      }
    })();
    return () => { cancelled = true; };
  }, [appendLog]);

  const releaseSharedStream = useCallback(() => {
    if (sharedStreamRef.current) {
      try { sharedStreamRef.current.getTracks().forEach((t) => t.stop()); } catch {}
      sharedStreamRef.current = null;
    }
  }, []);

  const stopRecording = useCallback(() => {
    const rec = mediaRecorderRef.current;
    if (!rec) {
      setIsRecording(false);
      appendLog("stopRecording: no active MediaRecorder");
      return;
    }
    try {
      const state = (rec as MediaRecorder).state;
      appendLog(`stopRecording: recorder.state=${state}`);
      rec.stop();
    } catch {}
    mediaRecorderRef.current = null;
    setIsRecording(false);
    appendLog("Stopping recording…");
  }, [appendLog]);

  // (removed) WebAudio context for TTS is managed inside TtsWsPlayer
  

  // Machine wiring must be created before callbacks that reference `send`
  const [state, send] = useVoiceService(useMemo(() => ({
    onStartListening: async () => {
      if (!canRecord) return;
      appendLog("Starting listening…");
      try {
        // Ensure mic is available and start VAD detection
        await vad.start();
        appendLog("VAD started");
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        appendLog(`VAD start error: ${msg}`);
      }
    },
    onStopAll: () => {
      // Stop playback, VAD, and capture
      vad.pause();
      stopRecording();
      if (currentAudioRef.current) {
        try { currentAudioRef.current.pause(); } catch {}
        currentAudioRef.current = null;
      }
      ttsSpeakingRef.current = false;
      // Interrupt any ongoing AI/TTS streaming
      try { ttsAbortRef.current?.abort(); } catch {}
      ttsAbortRef.current = null;
      try { ttsPlayerRef.current?.close(); } catch {}
      ttsPlayerRef.current = null;
      if (ttsEndFallbackTimerRef.current !== null) { try { clearTimeout(ttsEndFallbackTimerRef.current); } catch {} ttsEndFallbackTimerRef.current = null; }
      // TTS WebAudio is managed inside TtsWsPlayer; nothing to clean here beyond closing player
    },
    startCapture: () => { void startRecording(); },
    stopCapture: () => { stopRecording(); },
    stopPlayback: () => {
      if (currentAudioRef.current) {
        try { currentAudioRef.current.pause(); } catch {}
        currentAudioRef.current = null;
      }
      ttsSpeakingRef.current = false;
      // Also stop streaming TTS and upstream SSE to avoid overlap
      try { ttsAbortRef.current?.abort(); } catch {}
      ttsAbortRef.current = null;
      try { ttsPlayerRef.current?.close(); } catch {}
      ttsPlayerRef.current = null;
      if (ttsEndFallbackTimerRef.current !== null) { try { clearTimeout(ttsEndFallbackTimerRef.current); } catch {} ttsEndFallbackTimerRef.current = null; }
    },
    onVisualizerState: (s: VoiceVisualState) => {
      appendLog(`Visualizer -> ${s}`);
      type VoiceStateEventDetail = { state?: VoiceVisualState; ttsVolume?: number };
      window.dispatchEvent(new CustomEvent<VoiceStateEventDetail>("voice-state", { detail: { state: s } }));
    },
    processPipeline: async ({ blob }: { blob: Blob }) => {
      const sw = createStopwatch();
      appendLog("Recording stopped. Transcribing with ElevenLabs…");
      const form = new FormData();
      form.append("file", blob, "audio.webm");
      const sttResp = await fetch("/api/stt", { method: "POST", body: form });
      const sttNetworkMs = sw.splitMs();
      appendLog(`STT response status: ${sttResp.status} (network: ${formatMs(sttNetworkMs)})`);
      if (!sttResp.ok) throw new Error("STT failed");
      const sttData = (await sttResp.json()) as { transcription?: string; text?: string };
      const sttParseMs = sw.splitMs();
      appendLog(`STT parsed (${formatMs(sttParseMs)})`);
      const transcribedText = (sttData?.transcription || sttData?.text || "").trim();
      if (!transcribedText) throw new Error("No transcription captured");
      appendLog(`Transcribed: "${transcribedText}"`);
      // Streaming path: AI SSE -> ElevenLabs WS TTS
      appendLog(`Starting AI SSE (stream=true)… chatId=${chatIdRef.current ?? "none"}`);
      const apiKey = process.env.NEXT_PUBLIC_ELEVENLABS_API_KEY || "";
      const modelId = process.env.NEXT_PUBLIC_ELEVENLABS_MODEL_ID || process.env.ELEVENLABS_MODEL_ID || "eleven_flash_v2_5";
      const voiceId = process.env.NEXT_PUBLIC_ELEVENLABS_VOICE_ID || process.env.ELEVENLABS_VOICE_ID || "";
      if (!apiKey || !voiceId) {
        const msg = "Missing ElevenLabs API key or Voice ID for WS";
        appendLog(msg);
        throw new Error(msg);
      }

      // Clean up any previous streaming session before starting a new one
      try { ttsAbortRef.current?.abort(); } catch {}
      ttsAbortRef.current = null;
      try { ttsPlayerRef.current?.close(); } catch {}
      ttsPlayerRef.current = null;
      const player = new TtsWsPlayer({
        apiKey,
        voiceId,
        modelId,
        // Encourage faster time-to-first-audio with shorter initial chunk
        chunkLengthSchedule: [80, 120, 180, 240],
        onLog: appendLog,
        onVolume: (vol: number) => {
          try {
            type VoiceStateEventDetail = { state?: VoiceVisualState; ttsVolume?: number };
            window.dispatchEvent(new CustomEvent<VoiceStateEventDetail>("voice-state", { detail: { ttsVolume: vol } }));
          } catch {}
        },
        onFirstAudio: () => {
          // Notify state machine; it will drive the visualizer deterministically
          ttsSpeakingRef.current = true;
          try { if (sendRef.current) sendRef.current({ type: "TTS_STARTED" }); } catch {}
        },
        onFinal: () => {
          // Notify machine that TTS finished (WS side). It will decide when to return to listening.
          ttsSpeakingRef.current = false;
          try { if (sendRef.current) sendRef.current({ type: "TTS_ENDED" }); } catch {}
          // As a fallback, if playback end isn't observed quickly, force AUDIO_ENDED after a short delay.
          try { if (ttsEndFallbackTimerRef.current !== null) clearTimeout(ttsEndFallbackTimerRef.current); } catch {}
          ttsEndFallbackTimerRef.current = window.setTimeout(() => {
            appendLog("TTS final fallback -> AUDIO_ENDED");
            try { sendRef.current?.({ type: "AUDIO_ENDED" }); } catch {}
            ttsEndFallbackTimerRef.current = null;
          }, 2000);
        },
        onPlaybackEnded: () => {
          if (ttsEndFallbackTimerRef.current !== null) { try { clearTimeout(ttsEndFallbackTimerRef.current); } catch {} ttsEndFallbackTimerRef.current = null; }
          appendLog("TTS playback ended -> AUDIO_ENDED");
          try { sendRef.current?.({ type: "AUDIO_ENDED" }); } catch {}
        },
        // Start with defaults; we can expose tuning later
      });
      // No output mute here; mic mute handled via VAD pause/resume

      try {
        await player.connect();
      } catch (e) {
        const errMsg = `TTS WS connect failed: ${(e as Error).message}`;
        appendLog(errMsg);
        throw e;
      }
      const wsStartMs = sw.splitMs();
      appendLog(`TTS WS connected (${formatMs(wsStartMs)})`);

      const aborter = new AbortController();
      ttsAbortRef.current = aborter;
      ttsPlayerRef.current = player;
      let assembledText = "";
      // Seed chat with user + placeholder assistant locally (no extra network)
      const seedBase: ReadonlyArray<ChatMessage> = messages.length === 0 ? [{ role: "system", content: "" }] : [];
      let currentMsgs: ChatMessage[] = [...seedBase, ...messages, { role: "user", content: transcribedText }, { role: "assistant", content: "" }];
      try { setMessages(currentMsgs); } catch {}
      // Debug: outbound SSE request summary
      try { appendLog(`AI SSE request → messages=${currentMsgs.length - 1}`); } catch {}
      await streamSSE("/api/generateAnswerStreamOpenRouter", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          stream: true,
          ...(chatIdRef.current ? { chatId: chatIdRef.current } : {}),
          messages: (() => {
            const base: ReadonlyArray<ChatMessage> = messages.length === 0 ? [{ role: "system", content: "" }] : [];
            const withUser: ChatMessage[] = [...base, ...messages, { role: "user", content: transcribedText }];
            return withUser.slice(-24); // crude trim here; exact trim done server-side too
          })(),
        }),
        signal: aborter.signal,
      }, {
        onMessage: (data) => {
          type SSEMessage = {
            event?: string;
            type?: string;
            chat_id?: string;
            chatId?: string;
            message?: string;
            delta?: string;
            text?: string;
            answer?: string;
          };
          const obj: SSEMessage | null = (typeof data === "object" && data !== null) ? (data as SSEMessage) : null;
          const eventType = obj?.event ?? obj?.type;
          const upstreamChatId = obj?.chat_id ?? obj?.chatId;
          if ((eventType === "start" || eventType === "session_start" || eventType === "metadata") && typeof upstreamChatId === "string" && upstreamChatId) {
            chatIdRef.current = upstreamChatId;
            setChatId(upstreamChatId);
            appendLog(`SSE start: chat_id=${upstreamChatId}`);
            return;
          }
          if (eventType === "error") {
            const msg = (typeof data === "object" && data && "message" in (data as Record<string, unknown>)) ? String((data as Record<string, unknown>).message) : (obj?.message ?? "unknown");
            appendLog(`SSE error event: ${String(msg)}`);
            return;
          }
          const token = typeof data === "string"
            ? data
            : (obj?.message ?? obj?.delta ?? obj?.text ?? obj?.answer ?? "");
          if (typeof token === "string" && token.length > 0) {
            assembledText += token;
            const shouldFlush = /[\.!?\n]$/.test(token) || token.length >= 40;
            // Debug: token preview and flush
            try {
              const preview = token.replace(/\n/g, "\\n").slice(0, 64);
              appendLog(`SSE token len=${token.length} flush=${shouldFlush} preview="${preview}${token.length > 64 ? "…" : ""}"`);
            } catch {}
            player.sendText(token, { flush: shouldFlush });
            try { appendLog("TTS queued token"); } catch {}
            // Update assistant message incrementally in chat cache
            try {
              const next = currentMsgs.slice();
              const last = next[next.length - 1];
              if (last && last.role === "assistant") {
                next[next.length - 1] = { role: "assistant", content: (last.content || "") + token };
                currentMsgs = next;
                setMessages(next);
              }
            } catch {}
          }
        },
        onError: (e) => { appendLog(`AI SSE error: ${String(e)} chatId=${chatIdRef.current ?? "none"}`); },
        onDone: () => {
          // Force out any buffered text for very short endings
          player.flush();
          appendLog(`AI SSE done; flushed TTS buffer chatId=${chatIdRef.current ?? "none"}`);
          // Explicitly finalize the TTS WS session now that upstream SSE completed
          try { player.endSession(); appendLog("TTS WS: client_end sent"); } catch {}
          if (assembledText.trim().length > 0) {
            appendLog(`AI final: "${assembledText}"`);
            // Final state already in cache via incremental updates
          }
          // Mark SSE session as completed
          if (ttsAbortRef.current === aborter) ttsAbortRef.current = null;
        },
      });

      // We return a dummy buffer to satisfy the machine contract, but playback is already ongoing via WS player.
      return { transcribedText, answerText: assembledText, audioBuffer: new ArrayBuffer(0) };
    },
    log: appendLog,
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [appendLog, canRecord]));
  // Keep send in a ref to avoid re-render feedback loops inside raf callbacks
  useEffect(() => { sendRef.current = send as unknown as (e: { type: string }) => void; }, [send]);
  // Track latest recording, listening state, and interactive toggle for VAD gating
  useEffect(() => { isRecordingRef.current = isRecording; }, [isRecording]);
  useEffect(() => { isListeningRef.current = (state.value.control === "listening_idle" || state.value.control === "capturing"); }, [state.value.control]);
  useEffect(() => { interactiveEnabledRef.current = interactiveEnabled; }, [interactiveEnabled]);

  // Keep a ref to the current audio to allow interruption
  const currentAudioRef = useRef<HTMLAudioElement | null>(null);
  // TTS analyser handled inside TtsWsPlayer
  // TTS WS player and SSE abort controller for interruption
  const ttsPlayerRef = useRef<TtsWsPlayer | null>(null);
  const ttsAbortRef = useRef<AbortController | null>(null);
  // Speaking state inferred for gating interruptions
  const ttsSpeakingRef = useRef<boolean>(false);
  // Fallback timer to force AUDIO_ENDED if onended doesn't arrive
  const ttsEndFallbackTimerRef = useRef<number | null>(null);

  // Manual input: send text to AI SSE and stream tokens into WS TTS (skip STT)
  const manualSpeak = useCallback(async (text: string) => {
    const transcribedText = (text || "").trim();
    if (!transcribedText) return;
    appendLog(`Manual input: "${transcribedText}"`);
    const apiKey = process.env.NEXT_PUBLIC_ELEVENLABS_API_KEY || "";
    const modelId = process.env.NEXT_PUBLIC_ELEVENLABS_MODEL_ID || process.env.ELEVENLABS_MODEL_ID || "eleven_flash_v2_5";
    const voiceId = process.env.NEXT_PUBLIC_ELEVENLABS_VOICE_ID || process.env.ELEVENLABS_VOICE_ID || "";
    if (!apiKey || !voiceId) {
      const msg = "Missing ElevenLabs API key or Voice ID for WS";
      appendLog(msg);
      return;
    }

    // Clean up any previous streaming session before starting a new one
    try { ttsAbortRef.current?.abort(); } catch {}
    ttsAbortRef.current = null;
    try { ttsPlayerRef.current?.close(); } catch {}
    ttsPlayerRef.current = null;

    const player = new TtsWsPlayer({
      apiKey,
      voiceId,
      modelId,
      chunkLengthSchedule: [80, 120, 180, 240],
      onLog: appendLog,
      onVolume: (vol: number) => {
        try {
          type VoiceStateEventDetail = { state?: import("@/machines/voiceMachine").VoiceVisualState; ttsVolume?: number };
          window.dispatchEvent(new CustomEvent<VoiceStateEventDetail>("voice-state", { detail: { ttsVolume: vol } }));
        } catch {}
      },
      onFirstAudio: () => { ttsSpeakingRef.current = true; try { sendRef.current?.({ type: "TTS_STARTED" }); } catch {} },
      onFinal: () => {
        ttsSpeakingRef.current = false; try { sendRef.current?.({ type: "TTS_ENDED" }); } catch {}
        try { if (ttsEndFallbackTimerRef.current !== null) clearTimeout(ttsEndFallbackTimerRef.current); } catch {}
        ttsEndFallbackTimerRef.current = window.setTimeout(() => {
          appendLog("TTS final fallback -> AUDIO_ENDED");
          try { sendRef.current?.({ type: "AUDIO_ENDED" }); } catch {}
          ttsEndFallbackTimerRef.current = null;
        }, 2000);
      },
      onPlaybackEnded: () => {
        if (ttsEndFallbackTimerRef.current !== null) { try { clearTimeout(ttsEndFallbackTimerRef.current); } catch {} ttsEndFallbackTimerRef.current = null; }
        appendLog("TTS playback ended -> AUDIO_ENDED");
        try { sendRef.current?.({ type: "AUDIO_ENDED" }); } catch {}
      },
    });

    try {
      await player.connect();
    } catch (e) {
      const errMsg = `TTS WS connect failed: ${(e as Error).message}`;
      appendLog(errMsg);
      return;
    }
    appendLog("Manual SSE: TTS WS connected");

    const aborter = new AbortController();
    ttsAbortRef.current = aborter;
    ttsPlayerRef.current = player;
    let assembledText = "";

    // Seed chat: add user message and placeholder assistant
    const seedBase = messages.length === 0 ? [{ role: "system", content: "" } as const] : [];
    let currentMsgs: ChatMessage[] = [...seedBase, ...messages, { role: "user", content: transcribedText }, { role: "assistant", content: "" }];
    try { setMessages(currentMsgs); } catch {}

    await streamSSE("/api/generateAnswerStreamOpenRouter", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        stream: true,
        ...(chatIdRef.current ? { chatId: chatIdRef.current } : {}),
        messages: (() => {
          const base: ReadonlyArray<ChatMessage> = messages.length === 0 ? [{ role: "system", content: "" }] : [];
          const withUser: ChatMessage[] = [...base, ...messages, { role: "user", content: transcribedText }];
          return withUser.slice(-24);
        })(),
      }),
      signal: aborter.signal,
    }, {
      onMessage: (data) => {
        type SSEMessage = {
          event?: string;
          type?: string;
          chat_id?: string;
          chatId?: string;
          message?: string;
          delta?: string;
          text?: string;
          answer?: string;
        };
        const obj: SSEMessage | null = (typeof data === "object" && data !== null) ? (data as SSEMessage) : null;
        const eventType = obj?.event ?? obj?.type;
        const upstreamChatId = obj?.chat_id ?? obj?.chatId;
        if ((eventType === "start" || eventType === "session_start" || eventType === "metadata") && typeof upstreamChatId === "string" && upstreamChatId) {
          chatIdRef.current = upstreamChatId;
          setChatId(upstreamChatId);
          appendLog(`Captured chat_id from SSE start: ${upstreamChatId}`);
          return;
        }
        const token = typeof data === "string"
          ? data
          : (obj?.message ?? obj?.delta ?? obj?.text ?? obj?.answer ?? "");
        if (typeof token === "string" && token.length > 0) {
          assembledText += token;
          const shouldFlush = /[\.!?\n]$/.test(token) || token.length >= 40;
          player.sendText(token, { flush: shouldFlush });
          // Update assistant message incrementally
          try {
            const next = currentMsgs.slice();
            const last = next[next.length - 1];
            if (last && last.role === "assistant") {
              next[next.length - 1] = { role: "assistant", content: (last.content || "") + token };
              currentMsgs = next;
              setMessages(next);
            }
          } catch {}
        }
      },
      onError: (e) => { appendLog(`Manual AI SSE error: ${String(e)} chatId=${chatIdRef.current ?? "none"}`); },
      onDone: () => {
        player.flush();
        appendLog(`Manual AI SSE done; flushed TTS buffer chatId=${chatIdRef.current ?? "none"}`);
        if (assembledText.trim().length > 0) {
          appendLog(`AI final: "${assembledText}"`);
        }
        if (ttsAbortRef.current === aborter) ttsAbortRef.current = null;
      },
    });
  }, [appendLog, messages, setMessages]);

  // Steelbrain VAD controller (single pipeline, toggle via enabled flag)
  const vadAbortRef = useRef<AbortController | null>(null);
  const vad = useMemo(() => ({
    start: async () => {
      // Ensure mic stream
      const stream = sharedStreamRef.current ?? await navigator.mediaDevices.getUserMedia({ audio: RECOMMENDED_AUDIO_CONSTRAINTS, video: false });
      if (!sharedStreamRef.current) sharedStreamRef.current = stream;
      try { stream.getAudioTracks().forEach((t) => { t.enabled = true; }); } catch {}

      if (!vadPipelineStartedRef.current) {
        // Build ingest and VAD pipeline once
        const audioStream = await ingestAudioStream(stream);
        const aborter = new AbortController();
        vadAbortRef.current = aborter;
        const vadTransform = speechFilter({
          threshold: 0.45,
          minSpeechDurationMs: 400,
          redemptionDurationMs: 1400,
          lookBackDurationMs: 384,
          noEmit: true,
          onSpeechStart: () => {
            if (!vadEnabledRef.current) return;
            if (interactiveEnabledRef.current) {
              appendLog("VAD: speech detected (interactive preempt)");
              try { sendRef.current?.({ type: "VAD_SPEECH_START" }); } catch {}
              return;
            }
            if (!isListeningRef.current) { appendLog("VAD: speech detected (ignored; not in listening mode)"); return; }
            appendLog("VAD: speech detected (start)");
            try { sendRef.current?.({ type: "VAD_SPEECH_START" }); } catch {}
          },
          onSpeechEnd: () => {
            if (!vadEnabledRef.current) return;
            if (!isRecordingRef.current) {
              appendLog("VAD: speech ended (ignored; not recording)");
              return;
            }
            appendLog("VAD: speech ended (end)");
            try { sendRef.current?.({ type: "VAD_SILENCE_TIMEOUT" }); } catch {}
          },
          onMisfire: () => { if (vadEnabledRef.current) appendLog("VAD: misfire (too short)"); },
          onError: (err: unknown) => { if (vadEnabledRef.current) appendLog(`VAD error: ${err instanceof Error ? err.message : String(err)}`); },
        });
        void audioStream
          .pipeThrough(vadTransform)
          .pipeTo(new WritableStream<Float32Array>({ write() {} }), { signal: aborter.signal })
          .catch(() => { /* aborted or errored */ });
        vadPipelineStartedRef.current = true;
      }
      // Enable event emission
      vadEnabledRef.current = true;
    },
    pause: () => {
      vadEnabledRef.current = false; // disable callbacks
      const s = sharedStreamRef.current;
      if (s) {
        try { s.getAudioTracks().forEach((t) => { t.enabled = false; }); } catch {}
      }
    },
  }), [appendLog]);

  // Cleanup on unmount: tear down pipeline and release mic
  useEffect(() => {
    return () => {
      const a = vadAbortRef.current;
      if (a) {
        try { a.abort(); } catch {}
        vadAbortRef.current = null;
      }
      vadPipelineStartedRef.current = false;
      vadEnabledRef.current = false;
      releaseSharedStream();
    };
  }, [releaseSharedStream]);

  const startRecording = useCallback(async () => {
    const currentState = mediaRecorderRef.current?.state;
    if (!canRecord || currentState === "recording" || currentState === "paused") return;
    try {
      appendLog(`Requesting microphone access… (recState=${currentState ?? "none"}, isRecording=${isRecording})`);
      // Ensure VAD is running and reuse the same stream instance
      try { await vad.start(); } catch {}
      const stream = sharedStreamRef.current ?? await navigator.mediaDevices.getUserMedia({ audio: true });
      if (!sharedStreamRef.current) sharedStreamRef.current = stream;
      // Try explicit mimeType for broader compatibility
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
          try { mediaRecorder = new MediaRecorder(stream, { mimeType: t }); appendLog(`MediaRecorder using ${t}`); break; } catch {}
        }
      }
      if (!mediaRecorder) {
        mediaRecorder = new MediaRecorder(stream);
        appendLog("MediaRecorder using default type");
      }
      mediaRecorderRef.current = mediaRecorder;
      audioChunksRef.current = [];
      mediaRecorder.ondataavailable = (event: BlobEvent) => { if (event.data && event.data.size > 0) audioChunksRef.current.push(event.data); };
      mediaRecorder.onstop = async () => {
        const audioBlob = new Blob(audioChunksRef.current, { type: "audio/webm" });
        appendLog(`MediaRecorder onstop: chunks=${audioChunksRef.current.length} size=${audioBlob.size}`);
        if (audioBlob.size === 0) { appendLog("Recorded audio is empty. Skipping STT."); return; }
        appendLog("Recorder stopped. Dispatching blob to machine…");
        send({ type: "RECORDING_STOPPED", blob: audioBlob });
      };
      mediaRecorder.onerror = (e: unknown) => {
        const possible = e as { error?: { message?: string } };
        const msg = possible?.error?.message ?? String((possible as unknown as { error?: unknown })?.error ?? "Unknown MediaRecorder error");
        appendLog(`MediaRecorder error: ${msg}`);
      };
      mediaRecorder.start();
      setIsRecording(true);
      appendLog(`Recording started. state=${mediaRecorder.state}`);
      // VAD is managed at listening start; here we only capture
    } catch (error) {
      const err = error as Error;
      appendLog(`Microphone access error: ${err.message}`);
      console.error("Microphone access error", error);
    }
  }, [appendLog, canRecord, isRecording, send, vad]);

  

  // removed old voiceDeps block (moved above to define `send` early)

  // When machine enters playing with audioBuffer, play it and send AUDIO_ENDED on end
  // NOTE: Deprecated path: REST TTS playback. With WS streaming we auto-play via TtsWsPlayer.
  useEffect(() => {
    const audioBuf = state.context.audioBuffer;
    // Only start playback once when entering playing with a fresh buffer
    if (state.value.control === "playing" && audioBuf && !currentAudioRef.current) {
      const blob = new Blob([audioBuf], { type: "audio/mpeg" });
      const url = URL.createObjectURL(blob);
      const audio = new Audio(url);
      currentAudioRef.current = audio;
      appendLog("Playing TTS audio…");
      audio.addEventListener("ended", () => {
        currentAudioRef.current = null;
        send({ type: "AUDIO_ENDED" });
      }, { once: true });
      void audio.play();
    }
    // Cleanup if leaving playing while an audio instance exists
    if (state.value.control !== "playing" && currentAudioRef.current) {
      try { currentAudioRef.current.pause(); } catch {}
      currentAudioRef.current = null;
    }
  }, [state, send, appendLog]);

  return (
    <div className="min-h-dvh w-full">
      <Visualizer logsRef={vizLogsRef} onHud={setHud} micMuted={isMicMuted} />
      <div className="fixed inset-x-0 z-50 bottom-12">
        <div className="flex items-center justify-center gap-8">
          <GlassButton
            aria-label={state.value.control === "ready" ? "Start listening" : "Stop"}
            onClick={() => {
              appendLog(`Button click: control=${state.value.control}`);
              if (state.value.control === "ready") {
                appendLog("Dispatch START_LISTENING");
                send({ type: "START_LISTENING" });
              } else {
                appendLog("Dispatch STOP_ALL");
                send({ type: "STOP_ALL" });
              }
            }}
            diameter={112}
            active={state.value.control !== "ready" && state.value.control !== "error"}
          >
            {state.value.control !== "ready" && state.value.control !== "error" ? <Square className="h-6 w-6" /> : <Speech className="h-6 w-6" />}
          </GlassButton>

          {/* <GlassButton
            aria-label={isMicMuted ? "Unmute mic" : "Mute mic"}
            onClick={() => {
              const next = !isMicMuted;
              setIsMicMuted(next);
              if (next) {
                appendLog("Mic muted (VAD paused)");
                try { vad.pause(); } catch {}
                // Stop any ongoing capture immediately
                try { stopRecording(); } catch {}
              } else {
                appendLog("Mic unmuted (VAD resumed)");
                // Only resume VAD if we are in an active listening flow
                if (state.value.control !== "ready" && state.value.control !== "error") {
                  try { vad.start(); } catch {}
                }
              }
            }}
            diameter={64}
            active={isMicMuted}
            blurClassName="backdrop-blur-md"
            size="sm"
          >
            {isMicMuted ? <MicOff className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
          </GlassButton> */}
        </div>
      </div>
      <div className="fixed top-4 right-4 z-50 flex gap-2">
        <Button
          variant="secondary"
          size="icon"
          onClick={() => {
            clearChatId();
            chatIdRef.current = null;
            // Clear all cached chats in React Query and localStorage
            try {
              queryClient.removeQueries({ queryKey: ["chat"], exact: false });
            } catch {}
            try {
              for (let i = localStorage.length - 1; i >= 0; i--) {
                const k = localStorage.key(i);
                if (k && k.startsWith("chat:")) localStorage.removeItem(k);
              }
            } catch {}
            appendLog("New conversation cleared (cache reset)");
          }}
          aria-label="New conversation"
        >
          <SquarePen className="h-4 w-4" />
        </Button>
        <Button variant="secondary" size="icon" onClick={toggle} aria-label="Toggle theme">
          {theme === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
        </Button>
      </div>

      <ConsolePanel
        logs={logs}
        canRecord={canRecord}
        isRecording={isRecording}
        onClear={clearLogs}
        textareaRef={consoleRef}
        hud={hud}
        hideOverlay
        onSpeak={manualSpeak}
        interactiveEnabled={interactiveEnabled}
        onToggleInteractive={(enabled) => {
          setInteractiveEnabled(enabled);
          appendLog(`Interactive conversation ${enabled ? "enabled" : "disabled"}`);
        }}
      />
    </div>
  );
}
