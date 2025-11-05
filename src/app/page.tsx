"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Square, Sun, Moon, Speech, SquarePen, Mic, MicOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import Visualizer from "@/components/Visualizer/Visualizer";
import { useTheme } from "@/components/Theme/ThemeProvider";
import { getStoredChatId, setChatId, clearChatId } from "@/lib/utils";
import { TtsWsPlayer } from "@/lib/ttsWs";
import { streamSSE } from "@/lib/sse";
import { useChat, type ChatMessage } from "@/lib/chat";
import { GlassButton } from "@/components/ui/glass-button";
import { useQueryClient } from "@tanstack/react-query";
import { useVoiceController, type ControlState } from "@/features/voice";
import { preloadModel } from "@steelbrain/media-speech-detection-web";
import { type VoiceVisualState } from "@/machines/voiceMachine";
import ConsolePanel from "@/components/Console/ConsolePanel";
import { useAudioContext } from "@/components/AudioContext";

export default function Home() {
  const [logs, setLogs] = useState<string[]>([]);
  const [isRecording, setIsRecording] = useState<boolean>(false);
  const [interactiveEnabled, setInteractiveEnabled] = useState<boolean>(false);
  const consoleRef = useRef<HTMLTextAreaElement | null>(null);
  const [canRecord, setCanRecord] = useState<boolean>(false);
  const { theme, toggle } = useTheme();
  const chatIdRef = useRef<string | null>(null);
  const queryClient = useQueryClient();
  // Chat history via React Query + localStorage (client-side context)
  const { messages, setMessages } = useChat(chatIdRef.current ?? "default", undefined);

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

  // Refs for state management
  const sendRef = useRef<((event: { type: string; [k: string]: unknown }) => void) | null>(null);
  const vadStreamRef = useRef<MediaStream | null>(null);

  // Voice controller handles all internal refs, recording, TTS, AI streaming, and VAD
  const { snapshot: state, send, vadStream } = useVoiceController({
    canRecord,
    log: appendLog,
    logFiltered: appendLogFiltered,
    chatIdRef,
    messages,
    onMessagesUpdate: setMessages,
    onSendRef: sendRef,
    onIsRecordingChange: setIsRecording,
    interactiveEnabled,
  });

  // Extract top-level state name (XState v5 uses objects for nested states like { capturing: "recording" })
  // Memoize to prevent infinite loops - serialize state.value to detect actual changes
  const stateKey = useMemo(() => 
    typeof state.value === "string" ? state.value : JSON.stringify(state.value),
    [state.value]
  );
  const topLevelState = useMemo(() => {
    if (typeof state.value === "string") return state.value;
    if (typeof state.value === "object" && state.value !== null) {
      return Object.keys(state.value)[0] ?? "unknown";
    }
    return "unknown";
  }, [stateKey]);
  
  // Store state.value in ref for interactive mode checks
  const stateValueRef = useRef(state.value);
  useEffect(() => {
    stateValueRef.current = state.value;
  }, [state.value]);

  // Update vadStream ref for other components that need it
  useEffect(() => {
    vadStreamRef.current = vadStream ?? null;
  }, [vadStream]);

  // Preload VAD model on mount (only once)
  useEffect(() => {
    preloadModel().then(() => appendLog("VAD model preloaded"));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // Empty deps - only run once on mount

  // Helper function to compute visual state from machine state (defined after voice controller)
  const getVisualState = useCallback((controlState: ControlState): VoiceVisualState => {
    if (controlState === "ready" || controlState === "error") return "passive";
    if (controlState === "listening_idle" || controlState === "capturing") return "listening";
    if (controlState === "processing") return "thinking";
    if (controlState === "speaking_streaming" || controlState === "playing") return "speaking";
    return "passive";
  }, []);

  // Compute visual state from machine state
  const visualState = getVisualState(topLevelState as ControlState);

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

    // Send stop command to voice controller to clean up any ongoing session
    send({ type: "STOP_ALL" });

    const player = new TtsWsPlayer({
      apiKey,
      voiceId,
      modelId,
      chunkLengthSchedule: [80, 120, 180, 240],
      onLog: appendLogFiltered,
      onVolume: (vol: number) => {
        try {
          type VoiceStateEventDetail = { state?: import("@/machines/voiceMachine").VoiceVisualState; ttsVolume?: number };
          window.dispatchEvent(new CustomEvent<VoiceStateEventDetail>("voice-state", { detail: { ttsVolume: vol } }));
        } catch {}
      },
      onFirstAudio: () => { try { sendRef.current?.({ type: "TTS_STARTED" }); } catch {} },
      onFinal: () => {
        try { sendRef.current?.({ type: "TTS_ENDED" }); } catch {}
      },
      onPlaybackEnded: () => {
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
      },
    });
  }, [appendLog, messages, setMessages, send]);

  

  // removed old voiceDeps block (moved above to define `send` early)

  // Deprecated REST TTS playback effect removed; WS TTS handles playback lifecycle

  return (
    <div className="min-h-dvh w-full">
      <Visualizer voiceState={visualState} inputStream={vadStream || undefined} />
      <div className="fixed inset-x-0 z-50 bottom-12">
        <div className="flex items-center justify-center gap-8">
          <GlassButton
            aria-label={topLevelState === "ready" ? "Start listening" : "Stop"}
            onClick={() => {
              appendLog(`Button click: control=${JSON.stringify(state.value)}`);
              if (topLevelState === "ready") {
                appendLog("Dispatch START_LISTENING");
                send({ type: "START_LISTENING" });
              } else {
                appendLog("Dispatch STOP_ALL");
                send({ type: "STOP_ALL" });
              }
            }}
            diameter={112}
            active={topLevelState !== "ready" && topLevelState !== "error"}
          >
            {topLevelState !== "ready" && topLevelState !== "error" ? <Square className="h-6 w-6" /> : <Speech className="h-6 w-6" />}
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
