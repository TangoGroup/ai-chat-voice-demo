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

### VAD Implementation Decision

- Refactored from a hand-rolled RMS threshold VAD to `@ricky0123/vad-react` hook, backed by `@ricky0123/vad-web` (ONNX runtime in the browser). Rationale:
  - Better accuracy and robustness than simple RMS heuristics.
  - Maintained, configurable, and provides reliable callbacks: `onSpeechStart`, `onSpeechEnd`, `onVADMisfire`, `onSpeechRealStart`.
  - Exposes `getStream` to share a single `MediaStream` between VAD and `MediaRecorder`.
- Integration:
  - `src/app/page.tsx` initializes `useMicVAD({ model: "v5", startOnLoad: false, userSpeakingThreshold: 0.5, getStream })`.
  - `onSpeechStart` → dispatch `VAD_SPEECH_START` to the voice machine (starts capture).
  - `onSpeechEnd` → dispatch `VAD_SILENCE_TIMEOUT` (stops capture and triggers processing).
  - The same mic stream is reused for recording to avoid duplicate prompts and permission churn.
- Operational changes:
  - Removed custom Analyzer/RAF loop and thresholds.
  - `onStartListening` now calls `vad.start()`; `onStopAll` calls `vad.pause()` and releases the shared stream.

### ElevenLabs Streaming Decision

- Answer: Yes, ElevenLabs supports speaking from streamed text.
  - Realtime API via WebSocket provides low-latency, streaming TTS and duplex audio.
  - Standard REST TTS also streams the audio response body, though typical browser playback needs buffering unless using MediaSource.
- Approach for POC (updated):
  - Prefer ElevenLabs WebSocket TTS streaming (real-time) using `eleven_flash_v2_5`.
  - Keep REST TTS as a fallback (DEPRECATED path for this project).
  - AI response is streamed via SSE and fed directly to the TTS WS (send incremental `text` and `flush` at end).
  - Security note: for production, avoid exposing the API key in the client; proxy or mint ephemeral tokens.

### API Alignment vs Prior Project

 - Prior route: `/Users/Julian/Projects/aspen-web/src/app/api/generateAnswerStream/route.ts` used SSE streaming for text.
 - Updated for this POC:
   - Use SSE to stream AI tokens.
   - Feed tokens directly into ElevenLabs WS TTS (`eleven_flash_v2_5`) and call `flush` at the end.
   - REST TTS endpoint `/api/tts` remains as fallback (DEPRECATED).

### Logging Policy

- All user-facing actions and key voice flow state changes MUST be logged to the in-app console.

#### Console UI Refactor (2025-10-05)

- Moved console UI from `src/app/page.tsx` into a reusable component `src/components/Console/ConsolePanel.tsx`.
- Default behavior: overlay hidden for less visual obstruction (`hideOverlay` default true). If needed, pass `hideOverlay={false}` to enable overlay; clicking outside will dismiss due to `dismissible` defaulting to true.
- Rationale: separation of concerns, reusability, and simplified page component.

### Performance Metrics (Client)

- We capture high-level timings using a stopwatch (high-resolution `performance.now()`):
  - STT network time: POST `/api/stt` until first byte
  - STT parse time: JSON parse of STT response
  - AI network time: POST `/api/generateAnswerStream` until first byte
  - AI parse time: JSON parse of AI response
  - TTS network time: POST `/api/tts` until first byte
  - TTS buffer time: reading response into `arrayBuffer()`
  - Playback start latency: time from entering `playing` to `audio.play()` resolve (to be instrumented later if needed)
- Each log line includes the step and formatted duration, e.g., `AI response status: 200 (network: 15.23 s)`.
- Future: when enabling streaming AI/TTS, measure time-to-first-chunk and inter-chunk gaps.
  - With WS TTS enabled, capture: time-to-first-audio (TTFA), inter-chunk gap, total turn latency.

### Deprecations

- REST-based TTS flow (`/api/tts` + arrayBuffer playback in `page.tsx`) is DEPRECATED; retained as fallback.

### Interrupt Semantics

- On any interrupt (`VAD_SPEECH_START` while not `ready`/`error`, or `STOP_ALL`):
  - Stop MediaRecorder capture if active.
  - Pause and clear any HTMLAudioElement playback.
  - Abort active AI SSE via `AbortController`.
  - Close active ElevenLabs WS `TtsWsPlayer` and teardown its MediaSource.
  - Cleanup TTS analyser graph and animation frame.
  - This ensures prior speech cannot overlap with new speech.

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
- Speech start while `listening_idle` → `capturing` and start MediaRecorder. Also call `stopPlayback` to ensure no residual TTS.
- Silence timeout while `capturing` → stop capture → `processing` with blob.
- Robustness: `capturing` now has a `stopping` substate with a 2s timeout. If `MediaRecorder.onstop` never fires (e.g., if no active recorder), we auto-return to `listening_idle` to avoid deadlock. We also unconditionally clear the recording flag when stopping, even if no recorder is present.
- Speech start during `playing` or `processing` preempts: stop playback/pipeline (including WS TTS and SSE), go to `capturing` and begin a new utterance.
- Button: in `ready` starts listening; otherwise acts as stop (`STOP_ALL`).

### Visualizer Mapping
- `ready`/`error`: passive
- `listening_idle`/`capturing`: listening
- `processing`: thinking
- `playing`: speaking
  - Examples: mic access requests, recording start/stop, VAD start/stop, speech detected, silence detected, auto-stop triggers, STT request/response status, AI request/response status, TTS request status, audio playback start/end.
  - Rationale: aids debugging, demo clarity, and post-run analysis.


### State Machine Actions Structure (2025-10-05)

- We moved all inline actions in `src/machines/voiceMachine.ts` into named actions defined in the machine setup under `actions`.
- Benefits:
  - Clear separation between declarative statechart and imperative side effects.
  - Reuse and testability of actions; improved readability and logging.
  - Type safety: event-specific assignment actions now narrow events with a type guard (e.g., `isProcessDoneEvent`).
- Key named actions:
  - VAD control: `turnVadOn`, `turnVadOff` (dispatch internal events via `raise`).
  - Visualizer: `vizPassive`, `vizListening`, `vizThinking`, `vizSpeaking`.
  - Controls: `startListeningInfra`, `stopAll`, `startCapture`, `stopCapture`, `stopPlayback`.
  - Context: `storeRecordingBlob`, `storeProcessOutput`, `storeErrorFromEvent`, `clearAudioBuffer`, `clearError`.
  - Logging: `logVadOn`, `logVadOff`.
- Implementation detail: `storeProcessOutput` uses a type guard on `DoneActorEvent` for `processActor` to avoid unsafe casts.

### Deterministic Visualizer + Control Flow (2025-10-05)

- Problem: `page.tsx` directly drove the visualizer on streaming TTS (`onFirstAudio`), creating side effects outside the machine.
- Change:
  - Introduced `TTS_STARTED` event. When WS TTS produces first audio, UI dispatches `TTS_STARTED`; the machine handles it in `processing` with `vizSpeaking` action (no transition, invoke continues).
  - Added `hasAudioBuffer` guard for `onDone` from `processActor`:
    - If buffer present (REST TTS path), transition to `playing`.
    - If no buffer (WS streaming path), skip `playing` to `listening_idle` after storing text.
  - Removed direct visualizer state manipulation in `page.tsx` for TTS start. Volume updates still emit `voice-state` for the visualizer.
- Result: visualizer and control transitions are exclusively driven by machine events and actions for reproducibility.

#### 2025-10-06: TTS-driven visualizer volume

- Problem: Visualizer volume relied on machine `speaking` state timing; could miss early analyser frames.
- Change:
  - The page starts a Web Audio `AnalyserNode` on TTS first audio and dispatches `voice-state{ ttsVolume }` every RAF.
  - The visualizer now prefers TTS volume when an analyser update arrived within the last ~200ms; otherwise it falls back to mic volume.
  - When creating the `AudioContext`, we explicitly `resume()` it to ensure analyser runs under autoplay constraints.
- Impact: Smoother, immediate visual response to ElevenLabs output irrespective of state transition timing.


### Chat Threading (2025-10-05)

- We persist the upstream-issued chat thread ID in `localStorage` under key `chatId`.
- Source of truth: captured from the SSE start event (or REST JSON) as `chat_id` when the conversation begins.
- We do NOT pre-create the chat. If a stored chat exists, we pass it on the next request; otherwise the server assigns a new `chat_id` which we persist.
- The "New conversation" button now clears the stored chat ID; the next interaction captures a fresh `chat_id` from the start event.
- Client logs surface the chat ID when captured and in AI request lifecycle.
- Utilities in `src/lib/utils.ts`: `getStoredChatId`, `setChatId`, `clearChatId` (legacy generators retained but unused).
- API behavior (2025-10-06): `/api/generateAnswerStream` forwards `chat_id` when provided; responses (SSE start or REST JSON) may include `chat_id` which the client stores for subsequent requests. The client includes `chatId` on all AI requests when available (including REST failover).

