export interface SSEOptions {
  signal?: AbortSignal;
  onMessage: (data: unknown) => void;
  onError?: (err: unknown) => void;
  onDone?: () => void;
}

// Generic SSE reader that emits parsed JSON if possible, else raw string
export async function streamSSE(url: string, init: RequestInit, opts: SSEOptions): Promise<void> {
  const resp = await fetch(url, init);
  if (!resp.ok || !resp.body) throw new Error(`SSE failed: ${resp.status}`);
  const reader = resp.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      // Normalize CRLF to LF to ensure consistent event delimiters
      buffer += decoder.decode(value, { stream: true }).replace(/\r\n/g, "\n");
      let idx: number;
      while ((idx = buffer.indexOf("\n\n")) !== -1) {
        const chunk = buffer.slice(0, idx);
        buffer = buffer.slice(idx + 2);
        const lines = chunk.split("\n").map((l) => l.trim());
        const dataLines = lines.filter((l) => l.startsWith("data:"));
        for (const dl of dataLines) {
          const raw = dl.slice(5).trim();
          if (!raw) continue;
          try {
            opts.onMessage(JSON.parse(raw));
          } catch {
            opts.onMessage(raw);
          }
        }
      }
    }
    if (buffer.trim().length > 0) {
      try { opts.onMessage(JSON.parse(buffer)); } catch { opts.onMessage(buffer); }
    }
    if (opts.onDone) opts.onDone();
  } catch (e) {
    if (opts.onError) opts.onError(e);
    throw e;
  } finally {
    try { reader.releaseLock(); } catch {}
  }
}


