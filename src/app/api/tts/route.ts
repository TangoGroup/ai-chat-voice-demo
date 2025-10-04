import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

interface TtsRequestBody {
  text: string;
  voiceId?: string;
  modelId?: string;
}

export async function POST(req: Request) {
  try {
    const { text, voiceId, modelId }: TtsRequestBody = await req.json();
    if (!text) {
      return NextResponse.json({ error: "text is required" }, { status: 400 });
    }

    const apiKey = process.env.ELEVENLABS_API_KEY;
    const envVoiceId = process.env.ELEVENLABS_VOICE_ID;
    const resolvedVoiceId = voiceId || envVoiceId;
    if (!apiKey || !resolvedVoiceId) {
      console.log("ELEVENLABS_API_KEY and ELEVENLABS_VOICE_ID are required", resolvedVoiceId, process.env);
      return NextResponse.json(
        { error: "ELEVENLABS_API_KEY and ELEVENLABS_VOICE_ID are required" },
        { status: 500 }
      );
    }

    const url = `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(resolvedVoiceId)}`;
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "xi-api-key": apiKey,
        "Content-Type": "application/json",
        Accept: "audio/mpeg",
      },
      body: JSON.stringify({
        text,
        model_id: modelId || process.env.ELEVENLABS_MODEL_ID,
        voice_settings: {
          stability: 0.5,
          similarity_boost: 0.8,
        },
      }),
    });

    if (!response.ok) {
      const err = await response.text();
      console.error("ElevenLabs TTS error", response.status, err);
      return NextResponse.json({ error: "TTS failed" }, { status: 502 });
    }

    const audioStream = response.body;
    if (!audioStream) {
      return NextResponse.json({ error: "No audio stream" }, { status: 502 });
    }

    return new Response(audioStream, {
      headers: {
        "Content-Type": "audio/mpeg",
        "Cache-Control": "no-cache",
      },
    });
  } catch (error) {
    console.error("/api/tts error", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}


