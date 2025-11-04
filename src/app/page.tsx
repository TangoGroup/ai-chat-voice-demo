"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Square, Sun, Moon, Speech, SquarePen, Mic, MicOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import Visualizer from "@/components/Visualizer/Visualizer";
import { useTheme } from "@/components/Theme/ThemeProvider";
import { createStopwatch, formatMs, getStoredChatId, setChatId, clearChatId } from "@/lib/utils";
import { streamSSE } from "@/lib/sse";
import { useChat, type ChatMessage } from "@/lib/chat";
import { OpenRouterAdapter } from "@/lib/aiAdapter";
import { GlassButton } from "@/components/ui/glass-button";
import { useQueryClient } from "@tanstack/react-query";
import { useVoiceController, type ControlState } from "@/features/voice";
import { useVAD, preloadVAD } from "@/features/voice/useVAD";
import { type VoiceVisualState } from "@/machines/voiceMachine";
import ConsolePanel from "@/components/Console/ConsolePanel";
import { useTtsWsPlayer } from "@/lib/useTtsWsPlayer";
import { TtsWsPlayer } from "@/lib/ttsWs";

export default function Home() {
  const [logs, setLogs] = useState<string[]>([]);
  const [isRecording, setIsRecording] = useState<boolean>(false);
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
  const messagesRef = useRef(messages);
  const setMessagesRef = useRef(setMessages);
  messagesRef.current = messages;
  setMessagesRef.current = setMessages;
  // TTS player hook - manages player lifecycle automatically
  const ttsPlayer = useTtsWsPlayer();

  // Shared mic stream and machine sender
  const sharedStreamRef = useRef<MediaStream | null>(null);

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

  // Lightweight log filter to reduce noisy entries in the console HUD
  const shouldSuppressLog = useCallback((message: string): boolean => {
    if (/^SSE token len=/.test(message)) return true;
    if (/^TTS queued token$/.test(message)) return true;
    if (/^TTS WS -> text \(/.test(message)) return true;
    if (/^TTS WS closed \(code=1008 reason="Have not received a new text input/.test(message)) return true;
    return false;
  }, []);

  const appendLogFiltered = useCallback((message: string) => {
    if (shouldSuppressLog(message)) return;
    appendLog(message);
  }, [appendLog, shouldSuppressLog]);

  const clearLogs = useCallback(() => { setLogs([]); }, []);
  // Hook Visualizer into the in-app console HUD
  const vizLogsRef = useRef<(msg: string) => void>(() => {});
  useEffect(() => { vizLogsRef.current = appendLog; }, [appendLog]);


  // VAD model preload using VAD controller (moved after VAD controller declaration)

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

  // Refs for VAD stream (will be set by useVAD hook)
  const vadStreamRef = useRef<MediaStream | null>(null);

  // startRecording moved here to be available for callbacks
  const startRecording = useCallback(async () => {
    const currentState = mediaRecorderRef.current?.state;
    if (!canRecord || currentState === "recording" || currentState === "paused") return;
    try {
      appendLog(`Requesting microphone access… (recState=${currentState ?? "none"})`);
      // Reuse VAD stream if available
      const stream = vadStreamRef.current ?? await navigator.mediaDevices.getUserMedia({ audio: true });
      if (!sharedStreamRef.current) {
        sharedStreamRef.current = stream;
      }
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
        if (sendRef.current) sendRef.current({ type: "RECORDING_STOPPED", blob: audioBlob });
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
  }, [appendLog, canRecord]);

  // (removed) WebAudio context for TTS is managed inside TtsWsPlayer
  

  // Refs for VAD and state management
  const sendRef = useRef<((event: { type: string; [k: string]: unknown }) => void) | null>(null);
  const interactiveEnabledRef = useRef<boolean>(false);
  const isRecordingRef = useRef<boolean>(false);
  const isListeningRef = useRef<boolean>(false);

  // Wrap all callbacks in useCallback to stabilize references for useVoiceController
  const onStartListening = useCallback(async () => {
    if (!canRecord) return;
    appendLog("Starting listening…");
  }, [canRecord, appendLog]);

  const onStopAll = useCallback(() => {
    stopRecording();
    if (currentAudioRef.current) {
      try { currentAudioRef.current.pause(); } catch {}
      currentAudioRef.current = null;
    }
    ttsSpeakingRef.current = false;
    try { ttsAbortRef.current?.abort(); } catch {}
    ttsAbortRef.current = null;
    try { aiAbortRef.current?.abort(); } catch {}
    aiAbortRef.current = null;
    ttsPlayer.disconnect(); // Hook manages cleanup
    ttsPlayerRef.current = null;
    if (ttsEndFallbackTimerRef.current !== null) { try { clearTimeout(ttsEndFallbackTimerRef.current); } catch {} ttsEndFallbackTimerRef.current = null; }
  }, [stopRecording, ttsPlayer]);

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
    ttsPlayer.disconnect(); // Hook manages cleanup
    ttsPlayerRef.current = null;
    if (ttsEndFallbackTimerRef.current !== null) { try { clearTimeout(ttsEndFallbackTimerRef.current); } catch {} ttsEndFallbackTimerRef.current = null; }
  }, [ttsPlayer]);

  const processPipeline = useCallback(async ({ blob }: { blob: Blob }) => {
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

      // Streaming path: AI SSE -> ElevenLabs WS TTS via adapter
      appendLog(`Starting AI streaming… chatId=${chatIdRef.current ?? "none"}`);
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
      ttsPlayer.disconnect(); // Hook manages cleanup
      try { aiAbortRef.current?.abort(); } catch {}
      aiAbortRef.current = null;

      // Start TTS session via hook
      const wsStartMs = sw.splitMs();
      try {
        await ttsPlayer.startSession(
          {
            apiKey,
            voiceId,
            modelId,
            chunkLengthSchedule: [80, 120, 180, 240],
          },
          {
            onLog: appendLogFiltered,
            onVolume: (vol: number) => {
              // TTS volume no longer needed for visualizer (using mic volume directly)
            },
            onFirstAudio: () => {
              ttsSpeakingRef.current = true;
              try { if (sendRef.current) sendRef.current({ type: "TTS_STARTED" }); } catch {}
            },
            onFinal: () => {
              ttsSpeakingRef.current = false;
              try { if (sendRef.current) sendRef.current({ type: "TTS_ENDED" }); } catch {}
            },
            onPlaybackEnded: () => {
              appendLog("TTS playback ended -> AUDIO_ENDED");
              try { sendRef.current?.({ type: "AUDIO_ENDED" }); } catch {}
            },
          }
        );
        appendLog(`TTS WS connected (${formatMs(sw.splitMs() - wsStartMs)})`);
      } catch (e) {
        const errMsg = `TTS WS connect failed: ${(e as Error).message}`;
        appendLog(errMsg);
        throw e;
      }

      const ttsAborter = new AbortController();
      ttsAbortRef.current = ttsAborter;
      // Store player for abort controller coordination (hook manages lifecycle)
      ttsPlayerRef.current = ttsPlayer.getPlayer();

      // Seed chat with user + placeholder assistant locally
      const seedBase: ReadonlyArray<ChatMessage> = messagesRef.current.length === 0 ? [{ role: "system", content: "" }] : [];
      let currentMsgs: ChatMessage[] = [...seedBase, ...messagesRef.current, { role: "user", content: transcribedText }, { role: "assistant", content: "" }];
      try { setMessagesRef.current(currentMsgs); } catch {}
      appendLog(`AI request → messages=${currentMsgs.length - 1}`);

      const aiAborter = new AbortController();
      aiAbortRef.current = aiAborter;
      let assembledText = "";

      const aiAdapter = new OpenRouterAdapter();
      const aiHandle = aiAdapter.start({
        model: process.env.LLM_MODEL || "openai/gpt-4o",
        messages: (() => {
          const base: ReadonlyArray<ChatMessage> = messagesRef.current.length === 0 ? [{ role: "system", content: "" }] : [];
          const withUser: ChatMessage[] = [...base, ...messagesRef.current, { role: "user", content: transcribedText }];
          return withUser.slice(-24);
        })(),
        signal: aiAborter.signal,
        chatId: chatIdRef.current,
      });

      aiHandle.onDelta((token) => {
        if (token.length > 0) {
          assembledText += token;
          const shouldFlush = /[\.!?\n]$/.test(token) || token.length >= 40;
          ttsPlayer.sendText(token, { flush: shouldFlush });
          // Update assistant message incrementally
          try {
            const next = currentMsgs.slice();
            const last = next[next.length - 1];
            if (last && last.role === "assistant") {
              next[next.length - 1] = { role: "assistant", content: (last.content || "") + token };
              currentMsgs = next;
              setMessagesRef.current(next);
            }
          } catch {}
        }
      });

      aiHandle.onDone(() => {
        ttsPlayer.flush();
        appendLog(`AI done; flushed TTS buffer chatId=${chatIdRef.current ?? "none"}`);
        if (assembledText.trim().length > 0) {
          appendLog(`AI final: "${assembledText}"`);
        }
        if (aiAbortRef.current === aiAborter) aiAbortRef.current = null;
      });

      aiHandle.onError((e) => {
        appendLog(`AI error: ${String(e)} chatId=${chatIdRef.current ?? "none"}`);
      });

      // Wait for AI to complete using a Promise that resolves when onDone is called
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

    // We return a dummy buffer to satisfy the machine contract, but playback is already ongoing via WS player.
    return { transcribedText, answerText: assembledText, audioBuffer: new ArrayBuffer(0) };
  }, [appendLog, appendLogFiltered, ttsPlayer]);

  const log = useCallback((msg: string) => { appendLog(msg); }, [appendLog]);

  const { snapshot: state, send } = useVoiceController({
    onStartListening,
    onStopAll,
    startCapture,
    stopCapture,
    stopPlayback,
    processPipeline,
    log,
  });

  // VAD hook - enabled when in listening state, disabled otherwise
  const vadEnabled = state.value === "listening_idle" || state.value === "capturing";
  const { stream: vadStream, error: vadError } = useVAD(vadEnabled, {
    onSpeechStart: () => {
      if (interactiveEnabledRef.current) {
        appendLog("VAD: speech detected (interactive preempt)");
        send({ type: "VAD_SPEECH_START" });
        return;
      }
      if (!isListeningRef.current) {
        appendLog("VAD: speech detected (ignored; not in listening mode)");
        return;
      }
      appendLog("VAD: speech detected (start)");
      send({ type: "VAD_SPEECH_START" });
    },
    onSpeechEnd: () => {
      if (!isRecordingRef.current) {
        appendLog("VAD: speech ended (ignored; not recording)");
        return;
      }
      appendLog("VAD: speech ended (end)");
      send({ type: "VAD_SILENCE_TIMEOUT" });
    },
    onError: (error: string) => {
      appendLog(`VAD error: ${error}`);
    },
    log: appendLog,
  });

  // Update vadStreamRef when vadStream changes
  useEffect(() => {
    vadStreamRef.current = vadStream ?? null;
  }, [vadStream]);

  // Preload VAD model on mount
  useEffect(() => {
    preloadVAD().then(() => appendLog("VAD model preloaded"));
  }, [appendLog]);

  // Helper function to compute visual state from machine state (defined after voice controller)
  const getVisualState = useCallback((controlState: string): VoiceVisualState => {
    if (controlState === "ready" || controlState === "error") return "passive";
    if (controlState === "listening_idle" || controlState === "capturing") return "listening";
    if (controlState === "processing") return "thinking";
    if (controlState === "speaking_streaming" || controlState === "playing") return "speaking";
    return "passive";
  }, []);

  // Compute visual state from machine state
  const visualState = getVisualState(state.value);

  // Keep send in a ref to avoid re-render feedback loops inside raf callbacks
  useEffect(() => { sendRef.current = send as unknown as (e: { type: string }) => void; }, [send]);
  // Track latest recording, listening state, and interactive toggle for VAD gating
  useEffect(() => { isRecordingRef.current = isRecording; }, [isRecording]);
  useEffect(() => { isListeningRef.current = (state.value === "listening_idle" || state.value === "capturing"); }, [state.value]);
  useEffect(() => { interactiveEnabledRef.current = interactiveEnabled; }, [interactiveEnabled]);

  // Keep a ref to the current audio to allow interruption
  const currentAudioRef = useRef<HTMLAudioElement | null>(null);
  // TTS analyser handled inside TtsWsPlayer
  // TTS WS player, SSE abort controller, and AI abort controller for interruption
  const ttsPlayerRef = useRef<TtsWsPlayer | null>(null);
  const ttsAbortRef = useRef<AbortController | null>(null);
  const aiAbortRef = useRef<AbortController | null>(null);
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
    ttsPlayer.disconnect(); // Hook manages cleanup

    // Start TTS session via hook
    try {
      await ttsPlayer.startSession(
        {
          apiKey,
          voiceId,
          modelId,
          chunkLengthSchedule: [80, 120, 180, 240],
        },
        {
          onLog: appendLogFiltered,
          onVolume: (vol: number) => {
            try {
              type VoiceStateEventDetail = { state?: import("@/machines/voiceMachine").VoiceVisualState; ttsVolume?: number };
              window.dispatchEvent(new CustomEvent<VoiceStateEventDetail>("voice-state", { detail: { ttsVolume: vol } }));
            } catch {}
          },
          onFirstAudio: () => { ttsSpeakingRef.current = true; try { sendRef.current?.({ type: "TTS_STARTED" }); } catch {} },
          onFinal: () => {
            ttsSpeakingRef.current = false; try { sendRef.current?.({ type: "TTS_ENDED" }); } catch {}
            // Fallback disabled: rely solely on onPlaybackEnded from the audio element
          },
          onPlaybackEnded: () => {
            appendLog("TTS playback ended -> AUDIO_ENDED");
            try { sendRef.current?.({ type: "AUDIO_ENDED" }); } catch {}
          },
        }
      );
      appendLog("Manual SSE: TTS WS connected");
    } catch (e) {
      const errMsg = `TTS WS connect failed: ${(e as Error).message}`;
      appendLog(errMsg);
      return;
    }

    const aborter = new AbortController();
    ttsAbortRef.current = aborter;
    ttsPlayerRef.current = ttsPlayer.getPlayer();
    let assembledText = "";

    // Seed chat: add user message and placeholder assistant
    const seedBase = messagesRef.current.length === 0 ? [{ role: "system", content: "" } as const] : [];
    let currentMsgs: ChatMessage[] = [...seedBase, ...messagesRef.current, { role: "user", content: transcribedText }, { role: "assistant", content: "" }];
    try { setMessagesRef.current(currentMsgs); } catch {}

    await streamSSE("/api/generateAnswerStreamOpenRouter", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        stream: true,
        ...(chatIdRef.current ? { chatId: chatIdRef.current } : {}),
        messages: (() => {
          const base: ReadonlyArray<ChatMessage> = messagesRef.current.length === 0 ? [{ role: "system", content: "" }] : [];
          const withUser: ChatMessage[] = [...base, ...messagesRef.current, { role: "user", content: transcribedText }];
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
          ttsPlayer.sendText(token, { flush: shouldFlush });
          // Update assistant message incrementally
          try {
            const next = currentMsgs.slice();
            const last = next[next.length - 1];
            if (last && last.role === "assistant") {
              next[next.length - 1] = { role: "assistant", content: (last.content || "") + token };
              currentMsgs = next;
              setMessagesRef.current(next);
            }
          } catch {}
        }
      },
      onError: (e) => { appendLog(`Manual AI SSE error: ${String(e)} chatId=${chatIdRef.current ?? "none"}`); },
      onDone: () => {
        ttsPlayer.flush();
        appendLog(`Manual AI SSE done; flushed TTS buffer chatId=${chatIdRef.current ?? "none"}`);
        if (assembledText.trim().length > 0) {
          appendLog(`AI final: "${assembledText}"`);
        }
        if (ttsAbortRef.current === aborter) ttsAbortRef.current = null;
      },
    });
  }, [appendLog, ttsPlayer]);

  

  // removed old voiceDeps block (moved above to define `send` early)

  // Deprecated REST TTS playback effect removed; WS TTS handles playback lifecycle

  return (
    <div className="min-h-dvh w-full">
      <Visualizer voiceState={visualState} inputStream={vadStream || undefined} />
      <div className="fixed inset-x-0 z-50 bottom-12">
        <div className="flex items-center justify-center gap-8">
          <GlassButton
            aria-label={state.value === "ready" ? "Start listening" : "Stop"}
            onClick={() => {
              appendLog(`Button click: control=${state.value}`);
              if (state.value === "ready") {
                appendLog("Dispatch START_LISTENING");
                send({ type: "START_LISTENING" });
              } else {
                appendLog("Dispatch STOP_ALL");
                send({ type: "STOP_ALL" });
              }
            }}
            diameter={112}
            active={state.value !== "ready" && state.value !== "error"}
          >
            {state.value !== "ready" && state.value !== "error" ? <Square className="h-6 w-6" /> : <Speech className="h-6 w-6" />}
          </GlassButton>
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
