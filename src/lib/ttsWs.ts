/*
  ElevenLabs TTS WebSocket player
  - Connects to stream-input WS
  - Accepts incremental text via sendText
  - Emits audio via MediaSource (MSE) for reliable streaming playback
  - Meters volume via Web Audio analyser (captureStream preferred; fallback to MediaElementSource)
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
  onVolume?: (v: number) => void;
}

export class TtsWsPlayer {
  private ws: WebSocket | null = null;
  // MSE playback
  private mediaSource: MediaSource | null = null;
  private sourceBuffer: SourceBuffer | null = null;
  private pendingChunks: ArrayBuffer[] = [];
  private isBufferUpdating = false;
  private audioEl: HTMLAudioElement;
  private objectUrl: string | null = null;
  // WebAudio metering
  private audioCtx: AudioContext | null = null;
  private gainNode: GainNode | null = null;
  private analyserNode: AnalyserNode | null = null;
  private rafId: number | null = null;
  private firstAudioResolved = false;
  private desiredMuted = false;

  constructor(private readonly opts: TtsWsPlayerOptions) {
    this.audioEl = new Audio();
    this.audioEl.preload = "auto";
  }

  async connect(): Promise<void> {
    const { voiceId, modelId, onLog } = this.opts;
    const url = `wss://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voiceId)}/stream-input?model_id=${encodeURIComponent(modelId)}`;
    // Reset prior session state
    this.endOfStream();
    this.teardownMedia("pre-connect");
    this.teardownAudio("pre-connect");
    this.pendingChunks = [];
    this.isBufferUpdating = false;
    this.sourceBuffer = null;
    this.mediaSource = null;
    this.objectUrl = null;
    this.firstAudioResolved = false;

    // Prepare MediaSource for MP3
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
    // Ensure element is configured for autoplay policies and available to the audio stack
    try {
      this.audioEl.controls = false;
      (this.audioEl as unknown as { playsInline?: boolean }).playsInline = true as unknown as boolean;
      this.audioEl.style.position = "fixed";
      this.audioEl.style.left = "-10000px";
      this.audioEl.style.width = "1px";
      this.audioEl.style.height = "1px";
      if (!document.body.contains(this.audioEl)) document.body.appendChild(this.audioEl);
      // Prime autoplay in Safari: start muted and call play() immediately; we'll unmute on first audio
      this.audioEl.muted = true;
      void this.audioEl.play().catch(() => { /* muted autoplay should succeed */ });
    } catch {}
    const sourceOpenPromise = new Promise<void>((resolve, reject) => {
      this.mediaSource!.addEventListener("sourceopen", () => {
        try {
          if (!this.mediaSource) return reject(new Error("MediaSource missing on sourceopen"));
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
                // Initialize analyser for HUD volume
                try { this.ensureAnalyserForAudioEl(); } catch {}
                // Unmute now that audio has started; element is already playing muted
                try { this.audioEl.muted = this.desiredMuted; } catch {}
                if (onLog) onLog("TTS WS: first audio chunk received; playback started (MSE)");
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
    // Ensure both WS and SourceBuffer are ready
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
    this.teardownAudio("close");
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

  private ensureAnalyserForAudioEl(): void {
    if (this.analyserNode) return;
    try {
      const AC = (window as unknown as { webkitAudioContext?: typeof AudioContext; AudioContext?: typeof AudioContext }).AudioContext
        || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AC) return;
      const ctx = new AC();
      void ctx.resume().catch(() => {});
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 1024;
      analyser.smoothingTimeConstant = 0.85;
      // Safari-safe routing: use element for playback, analyser only in WebAudio graph.
      // Do NOT connect to destination to avoid double playback and muting side effects.
      const src = ctx.createMediaElementSource(this.audioEl);
      src.connect(analyser);
      this.gainNode = null;
      this.audioCtx = ctx;
      this.analyserNode = analyser;
      this.startRaf();
    } catch {
      // ignore
    }
  }

  /**
   * Mute or unmute playback. Applies to both element-based and WebAudio gain paths.
   */
  public setMuted(muted: boolean): void {
    this.desiredMuted = muted;
    try { this.audioEl.muted = muted; } catch {}
  }

  private startRaf() {
    const an = this.analyserNode;
    if (!an) return;
    const data = new Uint8Array(an.fftSize);
    const step = () => {
      try {
        an.getByteTimeDomainData(data);
        let sum = 0;
        for (let i = 0; i < data.length; i += 1) {
          const v = (data[i] - 128) / 128;
          sum += v * v;
        }
        const rms = Math.sqrt(sum / data.length);
        const vol = Math.min(1, Math.max(0, rms * 2.8));
        try { this.opts.onVolume?.(vol); } catch {}
      } catch {}
      this.rafId = requestAnimationFrame(step);
    };
    this.rafId = requestAnimationFrame(step);
  }

  private endOfStream() {
    if (this.rafId) { try { cancelAnimationFrame(this.rafId); } catch {} this.rafId = null; }
    if (this.mediaSource && this.mediaSource.readyState === "open") {
      try { this.mediaSource.endOfStream(); } catch {}
    }
  }

  private teardownAudio(_reason: string) {
    try {
      if (this.rafId) { try { cancelAnimationFrame(this.rafId); } catch {} this.rafId = null; }
      try { this.analyserNode?.disconnect(); } catch {}
      this.analyserNode = null;
      try { this.gainNode?.disconnect(); } catch {}
      this.gainNode = null;
      try { this.audioCtx?.close(); } catch {}
      this.audioCtx = null;
    } catch {
      // ignore
    }
  }

  private teardownMedia(_reason: string) {
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
      // Reset audio element
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


