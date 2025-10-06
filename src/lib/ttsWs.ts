/*
  ElevenLabs TTS WebSocket player
  - Connects to stream-input WS
  - Accepts incremental text via sendText
  - Emits audio via MediaSource and starts playback on first chunk
*/

export interface TtsWsPlayerOptions {
  apiKey: string;
  voiceId: string;
  modelId: string;
  stability?: number;
  similarityBoost?: number;
  useSpeakerBoost?: boolean;
  speed?: number;
  // Configure buffering behavior for time-to-first-audio vs quality tradeoff
  chunkLengthSchedule?: number[]; // e.g., [120, 160, 250, 290]
  onLog?: (msg: string) => void;
  onFirstAudio?: () => void;
  onFinal?: () => void;
}

export class TtsWsPlayer {
  private ws: WebSocket | null = null;
  private mediaSource: MediaSource | null = null;
  private sourceBuffer: SourceBuffer | null = null;
  private pendingChunks: ArrayBuffer[] = [];
  private isBufferUpdating = false;
  private audioEl: HTMLAudioElement;
  private objectUrl: string | null = null;
  private firstAudioResolved = false;

  constructor(private readonly opts: TtsWsPlayerOptions) {
    this.audioEl = new Audio();
    this.audioEl.preload = "auto";
  }

  get audio(): HTMLAudioElement { return this.audioEl; }

  async connect(): Promise<void> {
    const { voiceId, modelId, onLog } = this.opts;
    const url = `wss://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voiceId)}/stream-input?model_id=${encodeURIComponent(modelId)}`;
    // Reset any prior session state
    this.teardownMedia("pre-connect");
    this.pendingChunks = [];
    this.isBufferUpdating = false;
    this.sourceBuffer = null;
    this.mediaSource = null;
    this.firstAudioResolved = false;
    // Feature detection for MSE with MP3
    if (!("MediaSource" in window) || !(window as unknown as { MediaSource?: typeof MediaSource }).MediaSource) {
      throw new Error("MediaSource not supported in this browser");
    }
    const MS = (window as unknown as { MediaSource: typeof MediaSource }).MediaSource;
    if (typeof MS.isTypeSupported === "function" && !MS.isTypeSupported("audio/mpeg")) {
      throw new Error("MediaSource does not support audio/mpeg SourceBuffer in this browser");
    }
    this.mediaSource = new MS();
    this.objectUrl = URL.createObjectURL(this.mediaSource);
    this.audioEl.src = this.objectUrl;
    const sourceOpenPromise = new Promise<void>((resolve, reject) => {
      this.mediaSource!.addEventListener("sourceopen", () => {
        try {
          if (!this.mediaSource) return reject(new Error("MediaSource missing on sourceopen"));
          // ElevenLabs WS returns MP3 frames; use audio/mpeg
          this.sourceBuffer = this.mediaSource.addSourceBuffer("audio/mpeg");
          this.sourceBuffer.mode = "sequence";
          this.sourceBuffer.addEventListener("updateend", () => {
            this.isBufferUpdating = false;
            this.drainQueue();
          });
          resolve();
        } catch (e) {
          if (onLog) onLog(`TTS WS: failed to add SourceBuffer (audio/mpeg): ${(e as Error).message}`);
          reject(e);
        }
      }, { once: true });
    });

    const wsOpenPromise = new Promise<void>((resolve, reject) => {
      try {
        const ws = new WebSocket(url);
        this.ws = ws;
        ws.onopen = () => {
          if (onLog) onLog("TTS WS: connection opened");
          try {
            const initMsg: Record<string, unknown> = {
              text: " ", // keepalive and init
              xi_api_key: this.opts.apiKey,
              voice_settings: {
                stability: this.opts.stability ?? 0.5,
                similarity_boost: this.opts.similarityBoost ?? 0.8,
                use_speaker_boost: this.opts.useSpeakerBoost ?? false,
                style: 0.0,
                speed: this.opts.speed ?? 1.0,
              },
            };
            if (this.opts.chunkLengthSchedule && this.opts.chunkLengthSchedule.length > 0) {
              initMsg.generation_config = { chunk_length_schedule: this.opts.chunkLengthSchedule };
            }
            const payload = JSON.stringify(initMsg);
            if (onLog) onLog(`TTS WS -> init (${payload.length} bytes)`);
            ws.send(payload);
            resolve();
          } catch (e) {
            reject(e);
          }
        };
        ws.onmessage = (ev: MessageEvent<string | ArrayBuffer>) => {
          try {
            if (typeof ev.data !== "string") return; // server sends text frames with json
            const payload = JSON.parse(ev.data) as { audio?: string; isFinal?: boolean; alignment?: unknown };
            if (payload.audio) {
              const bytes = base64ToArrayBuffer(payload.audio);
              this.enqueue(bytes);
              if (!this.firstAudioResolved) {
                this.firstAudioResolved = true;
                void this.audioEl.play().catch(() => { /* autoplay might be blocked; user gesture exists in flow */ });
                if (onLog) onLog("TTS WS: first audio chunk received; playback started");
                try { this.opts.onFirstAudio?.(); } catch {}
              }
              // suppress per-chunk logs for noise reduction
            }
            if (payload.isFinal) {
              if (onLog) onLog("TTS WS: final message received");
              this.endOfStream();
              try { this.opts.onFinal?.(); } catch {}
            }
          } catch (e) {
            if (onLog) onLog(`TTS WS parse error: ${(e as Error).message}`);
          }
        };
        ws.onerror = (e) => {
          if (onLog) onLog("TTS WS error");
        };
        ws.onclose = (ev) => {
          if (onLog) onLog(`TTS WS closed (code=${ev.code} reason="${ev.reason}")`);
          this.endOfStream();
        };
      } catch (err) {
        reject(err);
      }
    });
    // Ensure both WS and SourceBuffer are ready; throw to allow REST fallback
    await Promise.all([wsOpenPromise, sourceOpenPromise]);
  }

  sendText(text: string, opts?: { flush?: boolean; voiceSettings?: Partial<{ stability: number; similarity_boost: number; use_speaker_boost: boolean; style: number; speed: number; }> }) {
    const ws = this.ws;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    type VoiceSettings = Partial<{ stability: number; similarity_boost: number; use_speaker_boost: boolean; style: number; speed: number; }>;
    type OutboundMessage = { text: string; flush?: boolean; voice_settings?: VoiceSettings };
    const msg: OutboundMessage = { text };
    if (opts?.flush) msg.flush = true;
    if (opts?.voiceSettings) msg.voice_settings = opts.voiceSettings;
    const payload = JSON.stringify(msg);
    if (this.opts.onLog) this.opts.onLog(`TTS WS -> text (${text.length} chars${opts?.flush ? ", flush" : ""})`);
    ws.send(payload);
  }

  flush() {
    const ws = this.ws;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    ws.send(JSON.stringify({ text: "", flush: true }));
  }

  close() {
    try { this.ws?.close(); } catch {}
    this.ws = null;
    this.endOfStream();
    this.teardownMedia("close");
  }

  private enqueue(bytes: ArrayBuffer) {
    this.pendingChunks.push(bytes);
    this.drainQueue();
  }

  private drainQueue() {
    if (!this.sourceBuffer || this.isBufferUpdating) return;
    const next = this.pendingChunks.shift();
    if (!next) return;
    try {
      this.isBufferUpdating = true;
      this.sourceBuffer.appendBuffer(next);
    } catch {
      this.isBufferUpdating = false;
    }
  }

  private endOfStream() {
    if (this.mediaSource && this.mediaSource.readyState === "open") {
      try { this.mediaSource.endOfStream(); } catch {}
    }
  }

  private teardownMedia(reason: string) {
    try {
      if (this.sourceBuffer) {
        try { this.sourceBuffer.abort(); } catch {}
      }
      this.sourceBuffer = null;
      this.pendingChunks = [];
      this.isBufferUpdating = false;
      if (this.mediaSource) {
        try { if (this.mediaSource.readyState === "open") this.mediaSource.endOfStream(); } catch {}
      }
      this.mediaSource = null;
      if (this.objectUrl) {
        try { URL.revokeObjectURL(this.objectUrl); } catch {}
      }
      this.objectUrl = null;
      // Reset audio element to ensure new MSE pipeline can be attached next session
      try { this.audioEl.pause(); } catch {}
      this.audioEl.removeAttribute("src");
      try { this.audioEl.load(); } catch {}
    } catch {
      // ignore
    }
  }
}

function base64ToArrayBuffer(base64: string): ArrayBuffer {
  const bin = atob(base64);
  const len = bin.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i += 1) bytes[i] = bin.charCodeAt(i);
  // Ensure we pass a clean ArrayBuffer slice
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
}


