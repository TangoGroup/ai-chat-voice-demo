export type ChatRole = "system" | "user" | "assistant";

export interface ChatMessageDto {
  role: ChatRole;
  content: string;
}

export interface AiTextStreamHandle {
  abort: () => void;
  onDelta: (cb: (text: string) => void) => void;
  onDone: (cb: (finalText: string) => void) => void;
  onError: (cb: (err: unknown) => void) => void;
}

export interface AiTextStream {
  start(input: { model?: string; messages: ChatMessageDto[]; signal?: AbortSignal; chatId?: string | null }): AiTextStreamHandle;
}

export class OpenRouterAdapter implements AiTextStream {
  constructor(private baseUrl: string = "/api/generateAnswerStreamOpenRouter") {}

  start(input: { model?: string; messages: ChatMessageDto[]; signal?: AbortSignal; chatId?: string | null }): AiTextStreamHandle {
    const listeners = {
      delta: [] as Array<(t: string) => void>,
      done: [] as Array<(t: string) => void>,
      error: [] as Array<(e: unknown) => void>,
    };
    const controller = new AbortController();
    const signal = input.signal ?? controller.signal;

    (async () => {
      try {
        const body = JSON.stringify({ stream: true, ...(input.chatId ? { chatId: input.chatId } : {}), messages: input.messages });
        const resp = await fetch(this.baseUrl, { method: "POST", headers: { "Content-Type": "application/json" }, body, signal });
        if (!resp.ok || !resp.body) throw new Error(`OpenRouterAdapter: HTTP ${resp.status}`);
        const reader = resp.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true }).replace(/\r\n/g, "\n");
          let idx: number;
          while ((idx = buffer.indexOf("\n\n")) !== -1) {
            const chunk = buffer.slice(0, idx);
            buffer = buffer.slice(idx + 2);
            const lines = chunk.split("\n").map((l) => l.trim());
            for (const l of lines) {
              if (!l.startsWith("data:")) continue;
              const raw = l.slice(5).trim();
              if (!raw) continue;
              try {
                const obj = JSON.parse(raw) as { event?: string; type?: string; delta?: string; text?: string; message?: string; answer?: string };
                const token = obj.delta ?? obj.text ?? obj.message ?? obj.answer ?? "";
                if (token) listeners.delta.forEach((fn) => fn(token));
              } catch {
                if (raw) listeners.delta.forEach((fn) => fn(raw));
              }
            }
          }
        }
        if (buffer.trim().length > 0) {
          try { const obj = JSON.parse(buffer) as { delta?: string; text?: string; message?: string; answer?: string }; const token = obj.delta ?? obj.text ?? obj.message ?? obj.answer ?? ""; if (token) listeners.delta.forEach((fn) => fn(token)); } catch {}
        }
        listeners.done.forEach((fn) => fn(""));
      } catch (e) {
        listeners.error.forEach((fn) => fn(e));
      }
    })();

    return {
      abort: () => { try { controller.abort(); } catch {} },
      onDelta: (cb) => { listeners.delta.push(cb); },
      onDone: (cb) => { listeners.done.push(cb); },
      onError: (cb) => { listeners.error.push(cb); },
    };
  }
}


