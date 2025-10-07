"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useMicVAD } from "@ricky0123/vad-react";
import { Square, Sun, Moon, Speech, SquarePen } from "lucide-react";
import { Button } from "@/components/ui/button";
import Visualizer from "@/components/Visualizer/Visualizer";
import { useTheme } from "@/components/Theme/ThemeProvider";
import { createStopwatch, formatMs, getStoredChatId, setChatId, clearChatId } from "@/lib/utils";
import { TtsWsPlayer } from "@/lib/ttsWs";
import { streamSSE } from "@/lib/sse";
import { GlassButton } from "@/components/ui/glass-button";
import { type VoiceVisualState } from "@/machines/voiceMachine";
import { useVoiceService } from "@/machines/useVoiceService";
import ConsolePanel from "@/components/Console/ConsolePanel";

export default function Home() {
  const [logs, setLogs] = useState<string[]>([]);
  const [isRecording, setIsRecording] = useState<boolean>(false);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const consoleRef = useRef<HTMLTextAreaElement | null>(null);
  const [canRecord, setCanRecord] = useState<boolean>(false);
  const { theme, toggle } = useTheme();
  const chatIdRef = useRef<string | null>(null);
  const [hud, setHud] = useState<{ state: string; mic: number; tts: number; eff: number } | null>(null);

  // Shared mic stream and machine sender
  const sharedStreamRef = useRef<MediaStream | null>(null);
  const sendRef = useRef<((event: { type: string; [k: string]: unknown }) => void) | null>(null);

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
        // Do not pre-create chat; will capture chat_id from SSE/REST start
        vad.start();
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
      // Interrupt any ongoing AI/TTS streaming
      try { ttsAbortRef.current?.abort(); } catch {}
      ttsAbortRef.current = null;
      try { ttsPlayerRef.current?.close(); } catch {}
      ttsPlayerRef.current = null;
      releaseSharedStream();
      // TTS WebAudio is managed inside TtsWsPlayer; nothing to clean here beyond closing player
    },
    startCapture: () => { void startRecording(); },
    stopCapture: () => { stopRecording(); },
    stopPlayback: () => {
      if (currentAudioRef.current) {
        try { currentAudioRef.current.pause(); } catch {}
        currentAudioRef.current = null;
      }
      // Also stop streaming TTS and upstream SSE to avoid overlap
      try { ttsAbortRef.current?.abort(); } catch {}
      ttsAbortRef.current = null;
      try { ttsPlayerRef.current?.close(); } catch {}
      ttsPlayerRef.current = null;
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
        appendLog("Missing ElevenLabs API key or Voice ID for WS; falling back to REST TTS (deprecated)");
        const aiResp = await fetch("/api/generateAnswerStream", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ query: transcribedText, stream: false, chatId: chatIdRef.current || undefined }) });
        const aiNetworkMs = sw.splitMs();
        appendLog(`AI response status: ${aiResp.status} (network: ${formatMs(aiNetworkMs)}) chatId=${chatIdRef.current ?? "none"}`);
        type AIResponse = {
          chat_id?: string;
          chatId?: string;
          answer?: string;
          text?: string;
          message?: string;
        };
        const aiData = (await aiResp.json()) as AIResponse;
        const aiParseMs = sw.splitMs();
        appendLog(`AI parsed (${formatMs(aiParseMs)})`);
        const answerText = (aiData.answer || aiData.text || aiData.message || JSON.stringify(aiData)) as string;
        appendLog("Calling ElevenLabs TTS (REST)…");
        const ttsResp = await fetch("/api/tts", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text: answerText }) });
        const ttsNetworkMs = sw.splitMs();
        appendLog(`TTS response status: ${ttsResp.status} (network: ${formatMs(ttsNetworkMs)})`);
        const audioBuffer = await ttsResp.arrayBuffer();
        const ttsDecodeMs = sw.splitMs();
        appendLog(`TTS audio buffered (${formatMs(ttsDecodeMs)})`);
        return { transcribedText, answerText, audioBuffer };
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
          try { if (sendRef.current) sendRef.current({ type: "TTS_STARTED" }); } catch {}
        },
        onFinal: () => {
          // Player handles its own teardown
        },
        // Start with defaults; we can expose tuning later
      });

      try {
        await player.connect();
      } catch (e) {
        appendLog(`TTS WS connect failed: ${(e as Error).message}. Falling back to REST TTS.`);
        const aiResp = await fetch("/api/generateAnswerStream", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            query: transcribedText,
            stream: false,
            ...(chatIdRef.current ? { chatId: chatIdRef.current } : {}),
          }),
        });
        const aiNetworkMs = sw.splitMs();
        appendLog(`AI response status: ${aiResp.status} (network: ${formatMs(aiNetworkMs)})`);
        type AIResponse = {
          chat_id?: string;
          chatId?: string;
          answer?: string;
          text?: string;
          message?: string;
        };
        const aiData = (await aiResp.json()) as AIResponse;
        const aiParseMs = sw.splitMs();
        appendLog(`AI parsed (${formatMs(aiParseMs)})`);
        const respChatId = aiData.chat_id ?? aiData.chatId;
        if (typeof respChatId === "string" && respChatId) {
          chatIdRef.current = respChatId;
          setChatId(respChatId);
          appendLog(`Captured chat_id from REST: ${respChatId}`);
        }
        const answerText = (aiData.answer || aiData.text || aiData.message || JSON.stringify(aiData)) as string;
        appendLog("Calling ElevenLabs TTS (REST)…");
        const ttsResp = await fetch("/api/tts", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text: answerText }) });
        const ttsNetworkMs = sw.splitMs();
        appendLog(`TTS response status: ${ttsResp.status} (network: ${formatMs(ttsNetworkMs)})`);
        const audioBuffer = await ttsResp.arrayBuffer();
        const ttsDecodeMs = sw.splitMs();
        appendLog(`TTS audio buffered (${formatMs(ttsDecodeMs)})`);
        return { transcribedText, answerText, audioBuffer };
      }
      const wsStartMs = sw.splitMs();
      appendLog(`TTS WS connected (${formatMs(wsStartMs)})`);

      const aborter = new AbortController();
      ttsAbortRef.current = aborter;
      ttsPlayerRef.current = player;
      let assembledText = "";
      await streamSSE("/api/generateAnswerStream", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: transcribedText, stream: true, ...(chatIdRef.current ? { chatId: chatIdRef.current } : {}) }),
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
          }
        },
        onError: (e) => { appendLog(`AI SSE error: ${String(e)} chatId=${chatIdRef.current ?? "none"}`); },
        onDone: () => {
          // Force out any buffered text for very short endings
          player.flush();
          appendLog(`AI SSE done; flushed TTS buffer chatId=${chatIdRef.current ?? "none"}`);
          if (assembledText.trim().length > 0) {
            appendLog(`AI final: "${assembledText}"`);
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

  // Keep a ref to the current audio to allow interruption
  const currentAudioRef = useRef<HTMLAudioElement | null>(null);
  // TTS analyser handled inside TtsWsPlayer
  // TTS WS player and SSE abort controller for interruption
  const ttsPlayerRef = useRef<TtsWsPlayer | null>(null);
  const ttsAbortRef = useRef<AbortController | null>(null);

  // Initialize VAD using vad-react
  const vad = useMicVAD({
    model: "v5",
    startOnLoad: false,
    // Relax thresholds to recommended defaults for easier detection
    userSpeakingThreshold: 0.6,
    positiveSpeechThreshold: 0.3,
    negativeSpeechThreshold: 0.25,
    redemptionMs: 1400,
    minSpeechMs: 400,
    submitUserSpeechOnPause: true,
    // Self-hosted assets for AudioWorklet and ORT WASM
    baseAssetPath: "/vad-web/",
    onnxWASMBasePath: "/onnx/",
    onFrameProcessed: () => { /* debug disabled */ },
    onSpeechStart: () => {
      appendLog("VAD: speech detected (onSpeechStart)");
      if (sendRef.current) {
        sendRef.current({ type: "VAD_SPEECH_START" });
      } else {
        appendLog("VAD: sendRef null; dropping VAD_SPEECH_START");
      }
    },
    onSpeechEnd: () => {
      appendLog("VAD: speech ended (onSpeechEnd)");
      if (sendRef.current) {
        sendRef.current({ type: "VAD_SILENCE_TIMEOUT" });
      } else {
        appendLog("VAD: sendRef null; dropping VAD_SILENCE_TIMEOUT");
      }
    },
    onVADMisfire: () => { appendLog("VAD: misfire (too short)"); },
    onSpeechRealStart: () => { appendLog("VAD: confirmed speech (onSpeechRealStart)"); },
  });

  // Diagnostics for vad-react state
  useEffect(() => {
    appendLog(`VAD loading=${vad.loading} listening=${vad.listening} userSpeaking=${vad.userSpeaking} errored=${vad.errored || false}`);
  }, [appendLog, vad.loading, vad.listening, vad.userSpeaking, vad.errored]);

  const startRecording = useCallback(async () => {
    const currentState = mediaRecorderRef.current?.state;
    if (!canRecord || currentState === "recording" || currentState === "paused") return;
    try {
      appendLog(`Requesting microphone access… (recState=${currentState ?? "none"}, isRecording=${isRecording})`);
      // Always reuse the same stream instance managed by vad.getStream
      try { vad.start(); } catch {}
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
      <Visualizer logsRef={vizLogsRef} onHud={setHud} />
      <div className="fixed inset-x-0 z-50 flex justify-center bottom-12">
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
      </div>
      <div className="fixed top-4 right-4 z-50 flex gap-2">
        <Button
          variant="secondary"
          size="icon"
          onClick={() => {
            clearChatId();
            chatIdRef.current = null;
            appendLog("New conversation cleared");
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
      />
    </div>
  );
}
