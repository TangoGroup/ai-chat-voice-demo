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

### Logging Policy

- All user-facing actions and key voice flow state changes MUST be logged to the in-app console.

## State Machine (XState v5)

### Regions
- Control (sequential): `ready` → `listening_idle` → `capturing` → `processing` → `playing` → `listening_idle` | `error`.
- VAD (parallel): `off` | `on`.

VAD is `on` for all control states except `ready` and `error`.

### Events
- `START_LISTENING`, `STOP_ALL`
- `VAD_SPEECH_START`, `VAD_SILENCE_TIMEOUT`
- `RECORDING_STOPPED{ blob }`, `AUDIO_ENDED`

### Policies
- Speech start while `listening_idle` → `capturing` and start MediaRecorder.
- Silence timeout while `capturing` → stop capture → `processing` with blob.
- Speech start during `playing` or `processing` preempts: stop playback/pipeline, go to `capturing` and begin a new utterance.
- Button: in `ready` starts listening; otherwise acts as stop (`STOP_ALL`).

### Visualizer Mapping
- `ready`/`error`: passive
- `listening_idle`/`capturing`: listening
- `processing`: thinking
- `playing`: speaking
  - Examples: mic access requests, recording start/stop, VAD start/stop, speech detected, silence detected, auto-stop triggers, STT request/response status, AI request/response status, TTS request status, audio playback start/end.
  - Rationale: aids debugging, demo clarity, and post-run analysis.


