import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(req: Request) {
  try {
    const apiKey = process.env.ELEVENLABS_API_KEY;
    if (!apiKey) {
      return NextResponse.json({ error: "ELEVENLABS_API_KEY not configured" }, { status: 500 });
    }

    const contentType = req.headers.get("content-type") || "";
    if (!contentType.includes("multipart/form-data")) {
      return NextResponse.json({ error: "Expected multipart/form-data" }, { status: 400 });
    }

    const formData = await req.formData();
    const file = formData.get("file") as unknown;
    // Avoid instanceof checks since File may not be defined in Node runtime
    if (!file || typeof (file as { arrayBuffer?: unknown }).arrayBuffer !== "function") {
      return NextResponse.json({ error: "file is required" }, { status: 400 });
    }

    const fileAny = file as { name?: string; type?: string } & Blob;
    const bytes = await fileAny.arrayBuffer();
    if (!bytes || bytes.byteLength === 0) {
      return NextResponse.json({ error: "uploaded file is empty" }, { status: 400 });
    }

    const filename = fileAny?.name || "audio.webm";
    const type = fileAny?.type || "audio/webm";
    const forwardBlob = new Blob([bytes], { type });

    const elevenUrl = "https://api.elevenlabs.io/v1/speech-to-text";
    const upstreamForm = new FormData();
    upstreamForm.append("file", forwardBlob, filename);

    const sttModelId = process.env.ELEVENLABS_STT_MODEL_ID;
    if (!sttModelId) {
      return NextResponse.json({ error: "ELEVENLABS_STT_MODEL_ID not configured" }, { status: 500 });
    }
    upstreamForm.append("model_id", sttModelId);

    const sttLanguage = process.env.ELEVENLABS_STT_LANGUAGE;
    if (sttLanguage) {
      upstreamForm.append("languageCode", sttLanguage);
    }

    const upstream = await fetch(elevenUrl, {
      method: "POST",
      headers: {
        "xi-api-key": apiKey,
        Accept: "application/json",
      },
      body: upstreamForm,
    });

    if (!upstream.ok) {
      const err = await upstream.text();
      console.error("ElevenLabs STT error", upstream.status, err);
      return NextResponse.json({ error: "STT failed" }, { status: 502 });
    }

    const data = await upstream.json();
    return NextResponse.json(data);
  } catch (error) {
    console.error("/api/stt error", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}


