"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";

export type Role = "system" | "user" | "assistant";
export type ChatMessage = { role: Role; content: string };

const STORAGE_KEY = (id: string) => `chat:${id}`;

export function useChat(chatId: string, system?: string) {
  const qc = useQueryClient();

  const { data: messages = [] } = useQuery<ChatMessage[]>({
    queryKey: ["chat", chatId],
    queryFn: async () => {
      const raw = typeof window !== "undefined" ? localStorage.getItem(STORAGE_KEY(chatId)) : null;
      const initial: ChatMessage[] = raw ? JSON.parse(raw) : [];
      return initial.length === 0 && system ? [{ role: "system", content: system }] : initial;
    },
    staleTime: Infinity,
  });

  function persist(next: ChatMessage[]) {
    try { localStorage.setItem(STORAGE_KEY(chatId), JSON.stringify(next)); } catch {}
  }
  function set(next: ChatMessage[]) {
    qc.setQueryData<ChatMessage[]>(["chat", chatId], next);
    persist(next);
  }

  const send = useMutation({
    mutationFn: async (userText: string) => {
      const start: ChatMessage[] = [...messages, { role: "user", content: userText }, { role: "assistant", content: "" }];
      set(start);

      const resp = await fetch("/api/generateAnswerStreamOpenRouter", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          stream: true,
          chatId,
          messages: trimForContext(start, 12),
        }),
      });
      if (!resp.ok || !resp.body) throw new Error(`AI stream failed: ${resp.status}`);

      const reader = resp.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let i: number;
        while ((i = buffer.indexOf("\n\n")) !== -1) {
          const chunk = buffer.slice(0, i);
          buffer = buffer.slice(i + 2);
          for (const ln of chunk.split("\n")) {
            if (!ln.startsWith("data:")) continue;
            const raw = ln.slice(5).trim();
            if (!raw) continue;
            try {
              const parsed = JSON.parse(raw) as { delta?: string; event?: string; chat_id?: string };
              if (parsed.event === "start" && typeof parsed.chat_id === "string" && parsed.chat_id) {
                // no-op: chat id handled elsewhere in app
                continue;
              }
              const delta = parsed.delta ?? "";
              if (delta) {
                const cur = (qc.getQueryData<ChatMessage[]>(["chat", chatId]) ?? start).slice();
                const last = cur[cur.length - 1];
                if (last?.role === "assistant") {
                  cur[cur.length - 1] = { role: "assistant", content: (last.content || "") + delta };
                  set(cur);
                }
              }
            } catch {}
          }
        }
      }
      return true;
    },
  });

  return { messages, sendMessage: (t: string) => send.mutateAsync(t), setMessages: set };
}

function trimForContext(messages: ChatMessage[], maxTurns: number): ChatMessage[] {
  const hasSystem = messages[0]?.role === "system";
  const system = hasSystem ? [messages[0]] : [];
  const rest = hasSystem ? messages.slice(1) : messages;
  const keep = rest.slice(Math.max(0, rest.length - 2 * maxTurns));
  return [...system, ...keep];
}


