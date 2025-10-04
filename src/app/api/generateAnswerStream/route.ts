import { NextResponse } from "next/server";
import { getClientCredentialsToken } from "@/lib/oauth";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

interface GenerateRequestBody {
  query: string;
  chatId?: string;
  model?: string;
  stream?: boolean;
}

export async function POST(req: Request) {
  try {
    const { query, chatId, model, stream }: GenerateRequestBody = await req.json();

    if (!query) {
      return NextResponse.json({ error: "Query is required" }, { status: 400 });
    }

    const baseUrl = process.env.AI_BASE_URL;
    if (!baseUrl) {
      return NextResponse.json({ error: "AI_BASE_URL not configured" }, { status: 500 });
    }

    const params = new URLSearchParams();
    params.set("enable_markdown", process.env.LLM_ENABLE_MARKDOWN ?? "0");
    params.set("enable_kallm", process.env.LLM_ENABLE_KALLM ?? "1");
    params.set("enable_sources", process.env.LLM_ENABLE_SOURCES ?? "0");

    const targetUrl = `${baseUrl.replace(/\/$/, "")}/ai/v1/message?${params.toString()}`;

    // Build Authorization header using client credentials if configured; fallback to static key
    let authHeader: Record<string, string> = {};
    try {
      if (
        process.env.OAUTH_TOKEN_ENDPOINT &&
        process.env.OAUTH_CLIENT_ID &&
        process.env.OAUTH_CLIENT_SECRET
      ) {
        const scope = process.env.OAUTH_SCOPE || "api/access";
        const token = await getClientCredentialsToken(scope);
        authHeader = { Authorization: `Bearer ${token}` };
      } else if (process.env.AI_API_KEY) {
        authHeader = { Authorization: `Bearer ${process.env.AI_API_KEY}` };
      }
    } catch (e) {
      console.error("Token acquisition failed", e);
      return NextResponse.json({ error: "Authentication failed" }, { status: 401 });
    }

    const upstreamResponse = await fetch(targetUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...authHeader,
      },
      body: JSON.stringify({
        chat_id: chatId,
        query,
        sources_limit: 10,
        stream: Boolean(stream),
        ...(model || process.env.LLM_MODEL ? { model: model || process.env.LLM_MODEL } : {}),
      }),
    });

    if (!upstreamResponse.ok) {
      let errText: unknown;
      try {
        errText = await upstreamResponse.text();
      } catch {
        errText = "";
      }
      console.error("Upstream error", upstreamResponse.status, errText);
      return NextResponse.json(
        { error: `Upstream error ${upstreamResponse.status}` },
        { status: 502 }
      );
    }

    // Pass through either SSE stream or JSON based on caller's request
    if (Boolean(stream)) {
      return new Response(upstreamResponse.body, {
        headers: {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
          Connection: "keep-alive",
        },
      });
    }

    // Non-streaming: proxy JSON directly
    const data = await upstreamResponse.json();
    return NextResponse.json(data);
  } catch (error) {
    console.error("Error in generateAnswerStream:", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}


