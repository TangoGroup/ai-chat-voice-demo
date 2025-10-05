"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useMicVAD } from "@ricky0123/vad-react";
import { Square, Sun, Moon, Speech } from "lucide-react";
import { Button } from "@/components/ui/button";
import Visualizer from "@/components/Visualizer/Visualizer";
import { useTheme } from "@/components/Theme/ThemeProvider";
import { createStopwatch, formatMs } from "@/lib/utils";
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

  // Shared mic stream and machine sender
  const sharedStreamRef = useRef<MediaStream | null>(null);
  const sendRef = useRef<((event: { type: string; [k: string]: unknown }) => void) | null>(null);

  useEffect(() => {
    setCanRecord(typeof window !== "undefined" && "MediaRecorder" in window);
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

  const releaseSharedStream = useCallback(() => {
    if (sharedStreamRef.current) {
      try { sharedStreamRef.current.getTracks().forEach((t) => t.stop()); } catch {}
      sharedStreamRef.current = null;
    }
  }, []);

  const stopRecording = useCallback(() => {
    if (!mediaRecorderRef.current) return;
    try { mediaRecorderRef.current.stop(); } catch {}
    mediaRecorderRef.current = null;
    setIsRecording(false);
    appendLog("Stopping recording…");
  }, [appendLog]);

  

  

  // Machine wiring must be created before callbacks that reference `send`
  const [state, send] = useVoiceService(useMemo(() => ({
    onStartListening: async () => {
      if (!canRecord) return;
      appendLog("Starting listening…");
      try {
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
      releaseSharedStream();
    },
    startCapture: () => { void startRecording(); },
    stopCapture: () => { stopRecording(); },
    stopPlayback: () => {
      if (currentAudioRef.current) {
        try { currentAudioRef.current.pause(); } catch {}
        currentAudioRef.current = null;
      }
    },
    onVisualizerState: (s: VoiceVisualState) => {
      window.dispatchEvent(new CustomEvent("voice-state", { detail: { state: s } } as any));
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
      appendLog("Starting AI SSE (stream=true)…");
      const apiKey = process.env.NEXT_PUBLIC_ELEVENLABS_API_KEY || "";
      const modelId = process.env.NEXT_PUBLIC_ELEVENLABS_MODEL_ID || process.env.ELEVENLABS_MODEL_ID || "eleven_flash_v2_5";
      const voiceId = process.env.NEXT_PUBLIC_ELEVENLABS_VOICE_ID || process.env.ELEVENLABS_VOICE_ID || "";
      if (!apiKey || !voiceId) {
        appendLog("Missing ElevenLabs API key or Voice ID for WS; falling back to REST TTS (deprecated)");
        const aiResp = await fetch("/api/generateAnswerStream", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ query: transcribedText, stream: false }) });
        const aiNetworkMs = sw.splitMs();
        appendLog(`AI response status: ${aiResp.status} (network: ${formatMs(aiNetworkMs)})`);
        const aiData = await aiResp.json();
        const aiParseMs = sw.splitMs();
        appendLog(`AI parsed (${formatMs(aiParseMs)})`);
        const answerText = (aiData?.answer || aiData?.text || aiData?.message || JSON.stringify(aiData)) as string;
        appendLog("Calling ElevenLabs TTS (REST)…");
        const ttsResp = await fetch("/api/tts", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text: answerText }) });
        const ttsNetworkMs = sw.splitMs();
        appendLog(`TTS response status: ${ttsResp.status} (network: ${formatMs(ttsNetworkMs)})`);
        const audioBuffer = await ttsResp.arrayBuffer();
        const ttsDecodeMs = sw.splitMs();
        appendLog(`TTS audio buffered (${formatMs(ttsDecodeMs)})`);
        return { transcribedText, answerText, audioBuffer };
      }

      const player = new TtsWsPlayer({
        apiKey,
        voiceId,
        modelId,
        onLog: appendLog,
        // Start with defaults; we can expose tuning later
      });

      try {
        await player.connect();
      } catch (e) {
        appendLog(`TTS WS connect failed: ${(e as Error).message}. Falling back to REST TTS.`);
        const aiResp = await fetch("/api/generateAnswerStream", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ query: transcribedText, stream: false }) });
        const aiNetworkMs = sw.splitMs();
        appendLog(`AI response status: ${aiResp.status} (network: ${formatMs(aiNetworkMs)})`);
        const aiData = await aiResp.json();
        const aiParseMs = sw.splitMs();
        appendLog(`AI parsed (${formatMs(aiParseMs)})`);
        const answerText = (aiData?.answer || aiData?.text || aiData?.message || JSON.stringify(aiData)) as string;
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
      let assembledText = "";
      await streamSSE("/api/generateAnswerStream", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: transcribedText, stream: true }),
        signal: aborter.signal,
      }, {
        onMessage: (data) => {
          // Expect upstream SSE data shape; adjust if needed
          // Based on sample logs, tokens arrive as { event: "message", message: string }
          const token = typeof data === "string" ? data : (data as any)?.message || (data as any)?.delta || (data as any)?.text || (data as any)?.answer || "";
          if (typeof token === "string" && token.length > 0) {
            assembledText += token;
            appendLog(`AI SSE token: "${token.slice(0, 60)}"${token.length > 60 ? "…" : ""}`);
            player.sendText(token);
          }
          if (typeof data !== "string") {
            try { appendLog(`AI SSE raw: ${JSON.stringify(data).slice(0, 200)}`); } catch {}
          }
        },
        onError: (e) => { appendLog(`AI SSE error: ${String(e)}`); },
        onDone: () => {
          // Force out any buffered text for very short endings
          player.flush();
          appendLog("AI SSE done; flushed TTS buffer");
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

  // Initialize VAD using vad-react
  const vad = useMicVAD({
    model: "v5",
    startOnLoad: false,
    // Relax thresholds to recommended defaults for easier detection
    userSpeakingThreshold: 0.25,
    positiveSpeechThreshold: 0.3,
    negativeSpeechThreshold: 0.15,
    redemptionMs: 800,
    minSpeechMs: 250,
    submitUserSpeechOnPause: true,
    // Self-hosted assets for AudioWorklet and ORT WASM
    baseAssetPath: "/vad-web/",
    onnxWASMBasePath: "/onnx/",
    getStream: async () => {
      const needsNew = () => {
        const s = sharedStreamRef.current;
        if (!s) return true;
        const tracks = s.getAudioTracks();
        if (tracks.length === 0) return true;
        const t = tracks[0];
        return t.readyState !== "live" || t.muted === true || t.enabled === false;
      };
      if (needsNew()) {
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: {
            channelCount: 1,
            echoCancellation: true,
            autoGainControl: true,
            noiseSuppression: true,
          },
        });
        sharedStreamRef.current = stream;
      }
      return sharedStreamRef.current!;
    },
    pauseStream: async () => {
      // Do not stop tracks; keep stream alive for reuse
    },
    resumeStream: async (s) => {
      const tracks = s?.getAudioTracks?.() ?? [];
      if (tracks.length > 0 && tracks[0].readyState === "live" && tracks[0].enabled !== false) return s;
      // Reacquire if previous stream ended
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          echoCancellation: true,
          autoGainControl: true,
          noiseSuppression: true,
        },
      });
      sharedStreamRef.current = stream;
      return stream;
    },
    onFrameProcessed: () => { /* debug disabled */ },
    onSpeechStart: () => {
      appendLog("VAD: speech detected (onSpeechStart)");
      if (sendRef.current) sendRef.current({ type: "VAD_SPEECH_START" });
    },
    onSpeechEnd: () => {
      appendLog("VAD: speech ended (onSpeechEnd)");
      if (sendRef.current) sendRef.current({ type: "VAD_SILENCE_TIMEOUT" });
    },
    onVADMisfire: () => { appendLog("VAD: misfire (too short)"); },
    onSpeechRealStart: () => { appendLog("VAD: confirmed speech (onSpeechRealStart)"); },
  });

  // Diagnostics for vad-react state
  useEffect(() => {
    appendLog(`VAD loading=${vad.loading} listening=${vad.listening} userSpeaking=${vad.userSpeaking} errored=${vad.errored || false}`);
  }, [vad.loading, vad.listening, vad.userSpeaking, vad.errored]);

  const startRecording = useCallback(async () => {
    if (!canRecord || isRecording) return;
    try {
      appendLog("Requesting microphone access…");
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
        if ((window as any).MediaRecorder && (MediaRecorder as any).isTypeSupported?.(t)) {
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
        if (audioBlob.size === 0) { appendLog("Recorded audio is empty. Skipping STT."); return; }
        appendLog("Recorder stopped. Dispatching blob to machine…");
        send({ type: "RECORDING_STOPPED", blob: audioBlob });
      };
      mediaRecorder.onerror = (e: unknown) => { appendLog(`MediaRecorder error: ${String((e as any)?.error || e)}`); };
      mediaRecorder.start();
      setIsRecording(true);
      appendLog("Recording started.");
      // VAD is managed at listening start; here we only capture
    } catch (error) {
      const err = error as Error;
      appendLog(`Microphone access error: ${err.message}`);
      console.error("Microphone access error", error);
    }
  }, [appendLog, canRecord, isRecording, send]);

  

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
      <Visualizer />
      <div className="fixed inset-x-0 z-50 flex justify-center bottom-12">
        <GlassButton
          aria-label={state.value.control === "ready" ? "Start listening" : "Stop"}
          onClick={() => {
            if (state.value.control === "ready") send({ type: "START_LISTENING" }); else send({ type: "STOP_ALL" });
          }}
          diameter={112}
          active={state.value.control !== "ready" && state.value.control !== "error"}
        >
          {state.value.control !== "ready" && state.value.control !== "error" ? <Square className="h-6 w-6" /> : <Speech className="h-6 w-6" />}
        </GlassButton>
      </div>
      <div className="fixed top-4 right-4 z-50">
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
        hideOverlay
      />
    </div>
  );
}
