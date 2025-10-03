"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Mic, Square, Send } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Separator } from "@/components/ui/separator";

type MessageRole = "user" | "assistant";

interface ChatMessage {
  id: string;
  role: MessageRole;
  content: string;
}

export default function Home() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState<string>("");
  const [isRecording, setIsRecording] = useState<boolean>(false);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages.length]);

  const canRecord = useMemo(() => typeof window !== "undefined" && "MediaRecorder" in window, []);

  const startRecording = useCallback(async () => {
    if (!canRecord || isRecording) return;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mediaRecorder = new MediaRecorder(stream);
      mediaRecorderRef.current = mediaRecorder;
      audioChunksRef.current = [];
      mediaRecorder.ondataavailable = (event: BlobEvent) => {
        if (event.data && event.data.size > 0) {
          audioChunksRef.current.push(event.data);
        }
      };
      mediaRecorder.onstop = () => {
        const audioBlob = new Blob(audioChunksRef.current, { type: "audio/webm" });
        // Placeholder: In a real app, send audioBlob to your STT backend
        void audioBlob.arrayBuffer();
      };
      mediaRecorder.start();
      setIsRecording(true);
    } catch (error) {
      console.error("Microphone access error", error);
    }
  }, [canRecord, isRecording]);

  const stopRecording = useCallback(() => {
    if (!isRecording || !mediaRecorderRef.current) return;
    mediaRecorderRef.current.stop();
    mediaRecorderRef.current.stream.getTracks().forEach((t) => t.stop());
    setIsRecording(false);
  }, [isRecording]);

  const sendText = useCallback(() => {
    const trimmed = input.trim();
    if (!trimmed) return;
    const userMessage: ChatMessage = {
      id: crypto.randomUUID(),
      role: "user",
      content: trimmed,
    };
    setMessages((prev) => [...prev, userMessage]);
    setInput("");
    // Placeholder: mock assistant reply
    const assistantMessage: ChatMessage = {
      id: crypto.randomUUID(),
      role: "assistant",
      content: "This is a placeholder assistant response.",
    };
    setTimeout(() => setMessages((prev) => [...prev, assistantMessage]), 500);
  }, [input]);

  return (
    <div className="min-h-dvh w-full flex items-center justify-center p-4 sm:p-6">
      <Card className="w-full max-w-2xl">
        <CardHeader>
          <CardTitle>Voice Chat</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="flex items-center gap-3">
            <Button
              type="button"
              variant={isRecording ? "destructive" : "default"}
              onClick={isRecording ? stopRecording : startRecording}
              disabled={!canRecord}
            >
              {isRecording ? (
                <>
                  <Square className="h-4 w-4" /> Stop
                </>
              ) : (
                <>
                  <Mic className="h-4 w-4" /> Record
                </>
              )}
            </Button>
            <Separator orientation="vertical" className="h-6" />
            <div className="text-sm text-muted-foreground">
              {canRecord ? (isRecording ? "Recording…" : "Idle") : "Recording unsupported"}
            </div>
          </div>

          <div className="border rounded-md">
            <ScrollArea className="h-[360px]">
              <div ref={scrollRef} className="p-4 space-y-4">
                {messages.length === 0 ? (
                  <div className="text-sm text-muted-foreground">No messages yet.</div>
                ) : (
                  messages.map((m) => (
                    <div key={m.id} className="flex items-start gap-3">
                      <Avatar className="h-8 w-8">
                        <AvatarFallback>{m.role === "user" ? "U" : "A"}</AvatarFallback>
                      </Avatar>
                      <div className="flex-1">
                        <div className="text-xs text-muted-foreground mb-1">
                          {m.role === "user" ? "You" : "Assistant"}
                        </div>
                        <div className="whitespace-pre-wrap text-sm">{m.content}</div>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </ScrollArea>
          </div>

          <div className="flex items-end gap-2">
            <Textarea
              placeholder="Type a message"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              className="min-h-[80px]"
            />
            <Button type="button" onClick={sendText} disabled={!input.trim()}>
              <Send className="h-4 w-4" />
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
