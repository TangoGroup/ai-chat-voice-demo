"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Square, Sun, Moon, Speech } from "lucide-react";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import Visualizer from "@/components/Visualizer/Visualizer";
import { useTheme } from "@/components/Theme/ThemeProvider";
import { GlassButton } from "@/components/ui/glass-button";
import { type VoiceVisualState } from "@/machines/voiceMachine";
import { useVoiceService } from "@/machines/useVoiceService";

export default function Home() {
  const [logs, setLogs] = useState<string[]>([]);
  const [isRecording, setIsRecording] = useState<boolean>(false);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const consoleRef = useRef<HTMLTextAreaElement | null>(null);
  const [canRecord, setCanRecord] = useState<boolean>(false);
  const { theme, toggle } = useTheme();

  // VAD refs/state
  const vadAudioContextRef = useRef<AudioContext | null>(null);
  const vadAnalyserRef = useRef<AnalyserNode | null>(null);
  const vadRafRef = useRef<number | null>(null);
  const vadStartedSpeakingAtRef = useRef<number | null>(null);
  const vadSilenceSinceRef = useRef<number | null>(null);
  const vadTriggeredStopRef = useRef<boolean>(false);
  const vadHasSpokenRef = useRef<boolean>(false);
  const vadInSilenceRef = useRef<boolean>(false);
  const sendRef = useRef<((event: { type: string; [k: string]: unknown }) => void) | null>(null);

  // Tunable VAD thresholds
  const SPEECH_THRESHOLD = 0.04; // normalized RMS considered as speech onset
  const SILENCE_THRESHOLD = 0.015; // normalized RMS considered as silence
  const SPEECH_MIN_MS = 160; // require at least this much voiced audio to mark as speaking
  const SILENCE_MIN_MS = 800; // stop after this much silence following speech

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

  const stopVAD = useCallback(() => {
    if (vadRafRef.current !== null) {
      cancelAnimationFrame(vadRafRef.current);
      vadRafRef.current = null;
    }
    if (vadAnalyserRef.current) {
      try { vadAnalyserRef.current.disconnect(); } catch {}
      vadAnalyserRef.current = null;
    }
    if (vadAudioContextRef.current) {
      try { vadAudioContextRef.current.close(); } catch {}
      vadAudioContextRef.current = null;
    }
    vadStartedSpeakingAtRef.current = null;
    vadSilenceSinceRef.current = null;
    vadTriggeredStopRef.current = false;
    vadHasSpokenRef.current = false;
    vadInSilenceRef.current = false;
    appendLog("VAD monitoring stopped");
  }, []);

  const stopRecording = useCallback(() => {
    if (!mediaRecorderRef.current) return;
    try { mediaRecorderRef.current.stop(); } catch {}
    try { mediaRecorderRef.current.stream.getTracks().forEach((t) => t.stop()); } catch {}
    mediaRecorderRef.current = null;
    setIsRecording(false);
    appendLog("Stopping recording…");
  }, [appendLog]);

  

  

  // Machine wiring must be created before callbacks that reference `send`
  const [state, send] = useVoiceService(useMemo(() => ({
    onStartListening: async () => {
      if (!canRecord) return;
      appendLog("Starting listening…");
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      // Start VAD over this stream
      startVAD(stream);
    },
    onStopAll: () => {
      // Stop playback, VAD, and capture
      stopVAD();
      stopRecording();
      if (currentAudioRef.current) {
        try { currentAudioRef.current.pause(); } catch {}
        currentAudioRef.current = null;
      }
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
      appendLog("Recording stopped. Transcribing with ElevenLabs…");
      const form = new FormData();
      form.append("file", blob, "audio.webm");
      const sttResp = await fetch("/api/stt", { method: "POST", body: form });
      appendLog(`STT response status: ${sttResp.status}`);
      if (!sttResp.ok) throw new Error("STT failed");
      const sttData = (await sttResp.json()) as { transcription?: string; text?: string };
      const transcribedText = (sttData?.transcription || sttData?.text || "").trim();
      if (!transcribedText) throw new Error("No transcription captured");
      appendLog(`Transcribed: "${transcribedText}"`);
      appendLog("Calling AI endpoint (stream=false)…");
      const aiResp = await fetch("/api/generateAnswerStream", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ query: transcribedText, stream: false }) });
      appendLog(`AI response status: ${aiResp.status}`);
      const aiData = await aiResp.json();
      const answerText = (aiData?.answer || aiData?.text || aiData?.message || JSON.stringify(aiData)) as string;
      appendLog(`AI answer: ${typeof answerText === "string" ? answerText.slice(0, 120) : "[object]"}`);
      appendLog("Calling ElevenLabs TTS…");
      const ttsResp = await fetch("/api/tts", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text: answerText }) });
      appendLog(`TTS response status: ${ttsResp.status}`);
      const audioBuffer = await ttsResp.arrayBuffer();
      return { transcribedText, answerText, audioBuffer };
    },
    log: appendLog,
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [appendLog, canRecord]));
  // Keep send in a ref to avoid re-render feedback loops inside raf callbacks
  useEffect(() => { sendRef.current = send as unknown as (e: { type: string }) => void; }, [send]);

  // Keep a ref to the current audio to allow interruption
  const currentAudioRef = useRef<HTMLAudioElement | null>(null);

  const startVAD = useCallback((stream: MediaStream) => {
    try {
      // Initialize WebAudio graph for RMS monitoring
      const AC: typeof AudioContext = (window as unknown as { AudioContext?: typeof AudioContext; webkitAudioContext?: typeof AudioContext }).AudioContext ?? (window as unknown as { AudioContext?: typeof AudioContext; webkitAudioContext?: typeof AudioContext }).webkitAudioContext!;
      const audioContext = new AC();
      vadAudioContextRef.current = audioContext;
      const analyser = audioContext.createAnalyser();
      analyser.fftSize = 1024;
      analyser.smoothingTimeConstant = 0.8;
      vadAnalyserRef.current = analyser;
      const source = audioContext.createMediaStreamSource(stream);
      source.connect(analyser);
      appendLog("VAD monitoring started");

      const buf = new Uint8Array(analyser.fftSize);
      const tick = () => {
        if (!vadAnalyserRef.current) return; // stopped
        vadAnalyserRef.current.getByteTimeDomainData(buf);
        let sumSquares = 0;
        for (let i = 0; i < buf.length; i += 1) {
          const v = (buf[i] - 128) / 128;
          sumSquares += v * v;
        }
        const rms = Math.sqrt(sumSquares / buf.length);
        const normalized = Math.min(1, rms * 1.6);

        const now = performance.now();
        // Detect speech onset
        if (normalized > SPEECH_THRESHOLD) {
          if (vadStartedSpeakingAtRef.current === null) {
            vadStartedSpeakingAtRef.current = now;
          }
          // reset silence clock while above silence threshold
          if (normalized >= SILENCE_THRESHOLD) {
            vadSilenceSinceRef.current = null;
          }
        } else {
          // below speech threshold cancels pending onset if it hasn't lasted long enough
          if (vadStartedSpeakingAtRef.current !== null && (now - vadStartedSpeakingAtRef.current) < SPEECH_MIN_MS) {
            vadStartedSpeakingAtRef.current = null;
          }
        }

        // If we have spoken for long enough previously, watch for sustained silence
        const spokenLongEnough = vadStartedSpeakingAtRef.current !== null && (now - vadStartedSpeakingAtRef.current) >= SPEECH_MIN_MS;
        if (spokenLongEnough) {
          if (!vadHasSpokenRef.current) {
            vadHasSpokenRef.current = true;
            appendLog("VAD: speech detected");
            if (sendRef.current) sendRef.current({ type: "VAD_SPEECH_START" });
          }
          if (normalized < SILENCE_THRESHOLD) {
            if (vadSilenceSinceRef.current === null) {
              vadSilenceSinceRef.current = now;
              if (!vadInSilenceRef.current) {
                vadInSilenceRef.current = true;
                appendLog("VAD: silence detected");
              }
            }
            const silentFor = now - (vadSilenceSinceRef.current ?? now);
            if (!vadTriggeredStopRef.current && silentFor >= SILENCE_MIN_MS) {
              vadTriggeredStopRef.current = true;
              appendLog("VAD: silence timeout");
              if (sendRef.current) sendRef.current({ type: "VAD_SILENCE_TIMEOUT" });
            }
          } else {
            vadSilenceSinceRef.current = null;
            vadInSilenceRef.current = false;
          }
        }

        vadRafRef.current = requestAnimationFrame(tick);
      };
      vadRafRef.current = requestAnimationFrame(tick);
    } catch {
      // Non-fatal; continue without VAD
    }
  }, [SILENCE_MIN_MS, SILENCE_THRESHOLD, SPEECH_MIN_MS, SPEECH_THRESHOLD, stopRecording, appendLog, send]);

  const startRecording = useCallback(async () => {
    if (!canRecord || isRecording) return;
    try {
      appendLog("Requesting microphone access…");
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mediaRecorder = new MediaRecorder(stream);
      mediaRecorderRef.current = mediaRecorder;
      audioChunksRef.current = [];
      mediaRecorder.ondataavailable = (event: BlobEvent) => { if (event.data && event.data.size > 0) audioChunksRef.current.push(event.data); };
      mediaRecorder.onstop = async () => {
        const audioBlob = new Blob(audioChunksRef.current, { type: "audio/webm" });
        if (audioBlob.size === 0) { appendLog("Recorded audio is empty. Skipping STT."); return; }
        appendLog("Recorder stopped. Dispatching blob to machine…");
        send({ type: "RECORDING_STOPPED", blob: audioBlob });
      };
      mediaRecorder.start();
      setIsRecording(true);
      appendLog("Recording started.");
      // VAD is managed at listening start; here we only capture
    } catch (error) {
      const err = error as Error;
      appendLog(`Microphone access error: ${err.message}`);
      console.error("Microphone access error", error);
    }
  }, [appendLog, canRecord, isRecording, startVAD, send]);

  

  // removed old voiceDeps block (moved above to define `send` early)

  // When machine enters playing with audioBuffer, play it and send AUDIO_ENDED on end
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

      <div className="fixed bottom-4 right-4 z-50">
        <Sheet>
          <SheetTrigger asChild>
            <Button variant="default">Console</Button>
          </SheetTrigger>
          <SheetContent side="right">
            <SheetHeader>
              <SheetTitle>Voice Chat Console</SheetTitle>
            </SheetHeader>
            <div className="p-4 flex items-center gap-3">
              <div className="text-sm text-muted-foreground">
                {canRecord ? (isRecording ? "Recording…" : "Idle") : "Recording unsupported"}
              </div>
              <div className="flex-1" />
              <Button type="button" variant="secondary" onClick={clearLogs} disabled={logs.length === 0}>
                Clear
              </Button>
            </div>
            <div className="p-4 pt-0">
              <Textarea ref={consoleRef} readOnly value={logs.join("\n")} placeholder="Logs will appear here…" className="h-[36dvh] font-mono text-xs" />
            </div>
          </SheetContent>
        </Sheet>
      </div>
    </div>
  );
}
