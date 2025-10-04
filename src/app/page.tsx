"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Mic, Square, Sun, Moon } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import Visualizer from "@/components/Visualizer/Visualizer";
import { useTheme } from "@/components/Theme/ThemeProvider";

export default function Home() {
  const [logs, setLogs] = useState<string[]>([]);
  const [isRecording, setIsRecording] = useState<boolean>(false);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const consoleRef = useRef<HTMLTextAreaElement | null>(null);
  const [canRecord, setCanRecord] = useState<boolean>(false);
  const { theme, toggle } = useTheme();

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
        appendLog("Recording stopped. Transcribing with ElevenLabs…");
        try {
          const form = new FormData();
          form.append("file", audioBlob, "audio.webm");
          const sttResp = await fetch("/api/stt", { method: "POST", body: form });
          appendLog(`STT response status: ${sttResp.status}`);
          if (!sttResp.ok) { appendLog("STT failed."); return; }
          const sttData = (await sttResp.json()) as { transcription?: string; text?: string };
          const transcribedText = (sttData?.transcription || sttData?.text || "").trim();
          if (!transcribedText) { appendLog("No transcription captured. Skipping AI call."); return; }
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
          const audioBuf = await ttsResp.arrayBuffer();
          const blob = new Blob([audioBuf], { type: "audio/mpeg" });
          const url = URL.createObjectURL(blob);
          const audio = new Audio(url);
          appendLog("Playing audio…");
          void audio.play();
        } catch (e) {
          const err = e as Error;
          appendLog(`Voice flow error: ${err.message}`);
          console.error("Voice flow error", e);
        }
      };
      mediaRecorder.start();
      setIsRecording(true);
      appendLog("Recording started.");
      window.dispatchEvent(new CustomEvent("voice-state", { detail: { state: "listening" } } as any));
    } catch (error) {
      const err = error as Error;
      appendLog(`Microphone access error: ${err.message}`);
      console.error("Microphone access error", error);
    }
  }, [appendLog, canRecord, isRecording]);

  const stopRecording = useCallback(() => {
    if (!isRecording || !mediaRecorderRef.current) return;
    mediaRecorderRef.current.stop();
    mediaRecorderRef.current.stream.getTracks().forEach((t) => t.stop());
    setIsRecording(false);
    appendLog("Stopping recording…");
    window.dispatchEvent(new CustomEvent("voice-state", { detail: { state: "thinking" } } as any));
  }, [appendLog, isRecording]);

  useEffect(() => {
    const onAudioPlay = () => { window.dispatchEvent(new CustomEvent("voice-state", { detail: { state: "speaking" } } as any)); };
    const onAudioEnd = () => { window.dispatchEvent(new CustomEvent("voice-state", { detail: { state: "passive" } } as any)); };
    window.addEventListener("tts-audio-play", onAudioPlay);
    window.addEventListener("tts-audio-end", onAudioEnd);
    return () => {
      window.removeEventListener("tts-audio-play", onAudioPlay);
      window.removeEventListener("tts-audio-end", onAudioEnd);
    };
  }, []);

  return (
    <div className="min-h-dvh w-full">
      <Visualizer />
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
          <SheetContent side="bottom" className="max-h-[65dvh]">
            <SheetHeader>
              <SheetTitle>Voice Chat Console</SheetTitle>
            </SheetHeader>
            <div className="p-4 flex items-center gap-3">
              <Button
                type="button"
                variant={isRecording ? "destructive" : "default"}
                onMouseDown={startRecording}
                onMouseUp={stopRecording}
                onTouchStart={startRecording}
                onTouchEnd={stopRecording}
                disabled={!canRecord}
              >
                {isRecording ? (
                  <>
                    <Square className="h-4 w-4" /> Stop
                  </>
                ) : (
                  <>
                    <Mic className="h-4 w-4" /> Push to Talk
                  </>
                )}
              </Button>
              <Separator orientation="vertical" className="h-6" />
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
