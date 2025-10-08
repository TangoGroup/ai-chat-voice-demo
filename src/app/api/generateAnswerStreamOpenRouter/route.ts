import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

interface GenerateRequestBody {
  query?: string;
  messages?: ChatMessage[];
  chatId?: string;
  model?: string;
  stream?: boolean;
  temperature?: number;
  maxTokens?: number;
}

// Minimal local types to avoid external type resolution at build time
type ChatMessage = { role: "system" | "user" | "assistant"; content: string };

export async function POST(req: Request) {
  try {
    const { query, messages: clientMessages, chatId, model, stream, temperature, maxTokens }: GenerateRequestBody = await req.json();

    if (!query && (!clientMessages || clientMessages.length === 0)) {
      return NextResponse.json({ error: "Query or messages are required" }, { status: 400 });
    }

    const apiKey = process.env.OPEN_ROUTER_API_KEY;
    if (!apiKey) {
      return NextResponse.json({ error: "OPEN_ROUTER_API_KEY not configured" }, { status: 500 });
    }

    const selectedModel = model || process.env.LLM_MODEL || "openai/gpt-4o";

    const envTemp = Number.isFinite(Number(process.env.LLM_TEMPERATURE)) ? Number(process.env.LLM_TEMPERATURE) : undefined;
    const envMax = Number.isFinite(Number(process.env.LLM_MAX_TOKENS)) ? Number(process.env.LLM_MAX_TOKENS) : undefined;
    const temperatureVal = typeof temperature === "number" && Number.isFinite(temperature) ? temperature : (envTemp ?? 0.2);
    const maxTokensVal = typeof maxTokens === "number" && Number.isFinite(maxTokens) ? maxTokens : (envMax ?? 256);
    try { console.log("/api/generateAnswerStreamOpenRouter request", { chatId, stream: Boolean(stream), model: selectedModel, temperature: temperatureVal, maxTokens: maxTokensVal }); } catch {}

    const extraHeaders: Record<string, string> = {};
    if (process.env.OPEN_ROUTER_HTTP_REFERRER) extraHeaders["HTTP-Referer"] = process.env.OPEN_ROUTER_HTTP_REFERRER;
    if (process.env.OPEN_ROUTER_APP_TITLE) extraHeaders["X-Title"] = process.env.OPEN_ROUTER_APP_TITLE;

    const systemMsg: ChatMessage | null = (process.env.LLM_SYSTEM_PROMPT && process.env.LLM_SYSTEM_PROMPT.length > 0)
      ? { role: "system", content: process.env.LLM_SYSTEM_PROMPT }
      : null;
    const clientNoSystem = (clientMessages ?? []).filter((m) => m.role !== "system");
    const messages: ChatMessage[] = clientNoSystem.length > 0
      ? ([systemMsg, ...clientNoSystem] as (ChatMessage | null)[]).filter(Boolean) as ChatMessage[]
      : ([systemMsg, { role: "user", content: query || "" }] as (ChatMessage | null)[]).filter(Boolean) as ChatMessage[];
    try { console.log("OpenRouter: messages ready", { count: messages.length, hasSystem: messages[0]?.role === "system" }); } catch {}

    if (Boolean(stream)) {
      // Use raw SSE from OpenRouter to handle models that may stream different fields
      const targetUrl = "https://openrouter.ai/api/v1/chat/completions";
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      };
      if (process.env.OPEN_ROUTER_HTTP_REFERRER) headers["HTTP-Referer"] = process.env.OPEN_ROUTER_HTTP_REFERRER;
      if (process.env.OPEN_ROUTER_APP_TITLE) headers["X-Title"] = process.env.OPEN_ROUTER_APP_TITLE;

      const upstream = await fetch(targetUrl, {
        method: "POST",
        headers,
        body: JSON.stringify({ model: selectedModel, messages, stream: true, temperature: temperatureVal, max_tokens: maxTokensVal }),
      });
      if (!upstream.ok || !upstream.body) {
        let errText = ""; try { errText = await upstream.text(); } catch {}
        console.error("OpenRouter upstream error", upstream.status, errText);
        return NextResponse.json({ error: `OpenRouter error ${upstream.status}` }, { status: 502 });
      }

      const encoder = new TextEncoder();
      const readable = new ReadableStream<Uint8Array>({
        start: async (controller) => {
          // Emit a synthetic start event; forward provided chatId for client persistence
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ event: "start", chat_id: chatId || undefined })}\n\n`));
          const reader = upstream.body.getReader();
          const decoder = new TextDecoder();
          let buffer = "";
          let tokenCount = 0;
          const includeReasoning = (process.env.LLM_INCLUDE_REASONING || "0") === "1";
          try {
            while (true) {
              const { done, value } = await reader.read();
              if (done) break;
              buffer += decoder.decode(value, { stream: true });
              let idx: number;
              while ((idx = buffer.indexOf("\n\n")) !== -1) {
                const chunk = buffer.slice(0, idx);
                buffer = buffer.slice(idx + 2);
                const lines = chunk.split("\n").map(l => l.trim());
                for (const line of lines) {
                  if (!line.startsWith("data:")) continue;
                  const payload = line.slice(5).trim();
                  if (!payload || payload === "[DONE]") continue;
                  try {
                    const j = JSON.parse(payload) as { choices?: Array<{ delta?: { content?: string; reasoning?: any } }>; error?: unknown };
                    const d = j?.choices?.[0]?.delta ?? {} as any;
                    const content: string = typeof d.content === "string" ? d.content : "";
                    const reasoningToken: string = typeof d.reasoning === "string"
                      ? d.reasoning
                      : (typeof d.reasoning?.content === "string" ? d.reasoning.content : "");
                    if (includeReasoning && reasoningToken) {
                      controller.enqueue(encoder.encode(`data: ${JSON.stringify({ event: "reasoning", delta: reasoningToken })}\n\n`));
                    }
                    if (content && content.length > 0) {
                      tokenCount++;
                      if (tokenCount <= 5) { try { console.log("OpenRouter: delta", { len: content.length, preview: content.slice(0, 64) }); } catch {} }
                      controller.enqueue(encoder.encode(`data: ${JSON.stringify({ delta: content })}\n\n`));
                    }
                  } catch (err) {
                    // Unknown payload; forward as-is for debugging
                    controller.enqueue(encoder.encode(`data: ${JSON.stringify({ debug: payload })}\n\n`));
                  }
                }
              }
            }
            try { console.log("OpenRouter: stream end", { tokenCount }); } catch {}
            if (tokenCount === 0) {
              controller.enqueue(encoder.encode(`data: ${JSON.stringify({ event: "error", message: "no_text_tokens" })}\n\n`));
            }
          } catch (e) {
            controller.enqueue(encoder.encode(`data: ${JSON.stringify({ event: "error", message: String(e) })}\n\n`));
            try { console.error("OpenRouter: stream error", e); } catch {}
          } finally {
            try { controller.close(); } catch {}
          }
        },
      });

      return new Response(readable, {
        headers: {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
          Connection: "keep-alive",
        },
      });
    }

    // Non-streaming: call OpenRouter directly to apply the same controls
    {
      const targetUrl = "https://openrouter.ai/api/v1/chat/completions";
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
        ...extraHeaders,
      };
      const resp = await fetch(targetUrl, {
        method: "POST",
        headers,
        body: JSON.stringify({ model: selectedModel, messages, stream: false, temperature: temperatureVal, max_tokens: maxTokensVal }),
      });
      if (!resp.ok) {
        let errText = ""; try { errText = await resp.text(); } catch {}
        console.error("OpenRouter non-streaming error", resp.status, errText);
        return NextResponse.json({ error: `OpenRouter error ${resp.status}` }, { status: 502 });
      }
      const data = (await resp.json()) as { choices?: Array<{ message?: { content?: string } }> };
      const text = data?.choices?.[0]?.message?.content || "";
      return NextResponse.json({ chat_id: chatId, answer: text });
    }
  } catch (error) {
    console.error("Error in generateAnswerStreamOpenRouter:", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}


