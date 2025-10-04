## Goal

Develop a voice chat POC using custom AI API endpoints, ElevenLabs (11L), and a visualizer.

## Tasks

1. Set up ElevenLabs for input and output (TTS and speech synthesis).
   - Question: Can ElevenLabs speak from streamed text? If yes, prefer streaming.

2. Begin API setup referencing prior implementation (`/Users/Julian/Projects/aspen-web/src/app/api/generateAnswerStream/route.ts`).
   - Create `env.example` with required environment variables.
   - Differences:
     - We don't care about rendering text.
     - If 11L supports stream speaking, use the streaming endpoint; otherwise `stream: false`.

3. Implement push-to-talk: add a button to press-and-hold; on release, process audio and pass to chat endpoint.

## Notes

- This document is the source of truth for design decisions and implementation details. Keep it updated as the POC evolves.

### ElevenLabs Streaming Decision

- Answer: Yes, ElevenLabs supports speaking from streamed text.
  - Realtime API via WebSocket provides low-latency, streaming TTS and duplex audio.
  - Standard REST TTS also streams the audio response body, though typical browser playback needs buffering unless using MediaSource.
- Approach for POC:
  - Start with REST TTS for simplicity (server streams audio/mpeg to client; client can play once enough buffered).
  - Keep `TTS_STREAMING_ENABLED` flag for future Realtime WebSocket upgrade.
  - STT path: initially stub or browser-side; can later swap to ElevenLabs Realtime for streaming STT.

### API Alignment vs Prior Project

- Prior route: `/Users/Julian/Projects/aspen-web/src/app/api/generateAnswerStream/route.ts` used SSE streaming for text.
- Differences for this POC:
  - We don’t render text; focus on audio output.
  - Prefer streaming TTS if/when we hook Realtime; otherwise use non-WebSocket flow.
  - Upstream AI message endpoint remains SSE-capable; we can request non-stream JSON when coordinating TTS.


