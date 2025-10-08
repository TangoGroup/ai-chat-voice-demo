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
  /**
   * Fired when the underlying HTMLAudioElement finishes playback of all buffered audio.
   */
  onPlaybackEnded?: () => void;
}

export class TtsWsPlayer {
  private ws: WebSocket | null = null;
  // MSE playback
  private mediaSource: MediaSource | null = null;
  private sourceBuffer: SourceBuffer | null = null;
  private chosenSourceBufferMime: string | null = null;
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
  private autoplayClickHandlerAdded = false;
  private useBlobFallback = false;
  private fallbackChunks: ArrayBuffer[] = [];
  private preferMp4 = true;
  private retryStage = 0; // 0=try MP4, 1=try MP3, 2=Blob fallback

  constructor(private readonly opts: TtsWsPlayerOptions) {
    this.audioEl = new Audio();
    this.audioEl.preload = "auto";
    // Reflect playback end to consumer for state transitions
    this.audioEl.onended = () => { try { this.opts.onPlaybackEnded?.(); } catch {} };
  }

  async connect(): Promise<void> {
    const { voiceId, modelId, onLog } = this.opts;
    const baseUrl = `wss://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voiceId)}/stream-input`;
    const queryParams: Record<string, string> = {
      model_id: modelId,
    };
    const url = `${baseUrl}?${new URLSearchParams(queryParams).toString()}`;
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
    this.useBlobFallback = false;
    this.fallbackChunks = [];
    this.chosenSourceBufferMime = null;

    // Prepare MediaSource for MP4/AAC if supported; else MP3; else Blob fallback
    if (this.retryStage === 2) {
      this.useBlobFallback = true;
      if (onLog) onLog("TTS WS: Forcing Blob fallback due to prior failures");
    } else if (!("MediaSource" in window) || !(window as unknown as { MediaSource?: typeof MediaSource }).MediaSource) {
      this.useBlobFallback = true;
      if (onLog) onLog("TTS WS: MediaSource not supported; using Blob fallback");
    } else {
      const MS = (window as unknown as { MediaSource: typeof MediaSource }).MediaSource;
      const canMp4 = typeof MS.isTypeSupported === "function" && MS.isTypeSupported("audio/mp4; codecs=\"mp4a.40.2\"");
      const canMp3 = typeof MS.isTypeSupported === "function" && MS.isTypeSupported("audio/mpeg");
      // Stage 0 prefers MP4 when available; Stage 1 forces MP3 if available
      const useMp4 = (this.retryStage === 0) && canMp4;
      const useMp3 = (this.retryStage <= 1) && !useMp4 && canMp3;
      if (useMp4 || useMp3) {
        this.mediaSource = new MS();
        this.objectUrl = URL.createObjectURL(this.mediaSource);
        this.audioEl.src = this.objectUrl;
        this.chosenSourceBufferMime = useMp4 ? "audio/mp4; codecs=\"mp4a.40.2\"" : (useMp3 ? "audio/mpeg" : null);
      } else {
        this.useBlobFallback = true;
        if (onLog) onLog("TTS WS: Neither MP4/AAC nor MP3 MSE types supported; using Blob fallback");
      }
    }
    if (onLog) onLog(`TTS WS: audioEl.src set to ${this.audioEl.currentSrc || this.audioEl.src || "(empty)"}`);
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
    const sourceOpenPromise = this.useBlobFallback
      ? Promise.resolve()
      : new Promise<void>((resolve, reject) => {
        this.mediaSource!.addEventListener("sourceopen", () => {
          try {
            if (!this.mediaSource) return reject(new Error("MediaSource missing on sourceopen"));
            const mime = this.chosenSourceBufferMime ?? "audio/mp4; codecs=\"mp4a.40.2\"";
            this.sourceBuffer = this.mediaSource.addSourceBuffer(mime);
            if (onLog) onLog(`TTS WS: added SourceBuffer with mime=${mime}`);
            this.sourceBuffer.mode = "sequence";
            this.sourceBuffer.addEventListener("updateend", () => {
              this.isBufferUpdating = false;
              this.drainQueue();
            });
            resolve();
          } catch (e) {
            if (onLog) onLog(`TTS WS: failed to add SourceBuffer (${(this.chosenSourceBufferMime ?? "unknown")}): ${(e as Error).message}`);
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
            const outputFormat = this.retryStage === 0 ? "mp4_44100_128" : "mp3_44100_128";
            const generationConfig: Record<string, unknown> = { output_format: outputFormat };
            if (this.opts.chunkLengthSchedule && this.opts.chunkLengthSchedule.length > 0) {
              generationConfig.chunk_length_schedule = this.opts.chunkLengthSchedule;
            }
            initMsg.generation_config = generationConfig;
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
              if (this.useBlobFallback) {
                this.fallbackChunks.push(bytes);
              } else {
                this.enqueue(bytes);
              }
              if (!this.firstAudioResolved) {
                this.firstAudioResolved = true;
                // Initialize analyser for HUD volume
                try { this.ensureAnalyserForAudioEl(); } catch {}
                // Unmute now that audio has started; element is already playing muted
                try { this.audioEl.muted = this.desiredMuted; } catch {}
                // Retry play in case autoplay was blocked
                this.ensurePlaybackStarted();
                if (onLog) onLog(`TTS WS: first audio chunk received; playback starting (${this.useBlobFallback ? "Blob" : "MSE"})`);
                try { this.opts.onFirstAudio?.(); } catch {}
              }
              // suppress per-chunk logs for noise reduction
            }
            if (payload.isFinal) {
              if (onLog) onLog("TTS WS: final message received");
              this.endOfStream();
              if (this.useBlobFallback && this.fallbackChunks.length > 0) {
                const mime = (this.chosenSourceBufferMime && this.chosenSourceBufferMime.startsWith("audio/mp4")) ? "audio/mp4" : "audio/mpeg";
                try {
                  const blob = new Blob(this.fallbackChunks.map((b) => new Uint8Array(b)), { type: mime });
                  const url = URL.createObjectURL(blob);
                  this.audioEl.src = url;
                  if (onLog) onLog(`TTS WS: Blob fallback URL set (${mime}) -> ${this.audioEl.currentSrc || this.audioEl.src}`);
                  this.ensurePlaybackStarted();
                } catch (e) {
                  if (onLog) onLog(`TTS WS: Blob fallback failed: ${(e as Error).message}`);
                }
              }
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
          // Early close before any audio: progress fallback stages
          if (!this.firstAudioResolved && this.retryStage < 2) {
            try {
              this.retryStage += 1;
              if (onLog) onLog(`TTS WS: retrying with stage=${this.retryStage === 1 ? "MP3" : "Blob"}`);
              void this.connect();
            } catch {}
          }
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

  private ensurePlaybackStarted() {
    const { onLog } = this.opts;
    try {
      const p = this.audioEl.play();
      if (p && typeof p.then === "function") {
        p.then(() => {
          if (onLog) onLog("TTS WS: audioEl.play() succeeded");
          this.removeAutoplayClickHandler();
        }).catch(() => {
          if (onLog) onLog("TTS WS: audioEl.play() blocked; awaiting user gesture");
          this.addAutoplayClickHandler();
        });
      }
    } catch {
      this.addAutoplayClickHandler();
    }
  }

  private addAutoplayClickHandler() {
    if (this.autoplayClickHandlerAdded) return;
    const { onLog } = this.opts;
    const onFirstClick = () => {
      try { document.removeEventListener("click", onFirstClick, true); } catch {}
      this.autoplayClickHandlerAdded = false;
      try { void this.audioEl.play(); } catch {}
      if (onLog) onLog("TTS WS: retried audioEl.play() after user gesture");
    };
    document.addEventListener("click", onFirstClick, true);
    this.autoplayClickHandlerAdded = true;
    if (onLog) onLog("TTS WS: installed one-time click handler for autoplay resume");
  }

  private removeAutoplayClickHandler() {
    if (!this.autoplayClickHandlerAdded) return;
    // Handler removes itself on first click; flag reset handled there
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
      this.chosenSourceBufferMime = null;
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
      this.useBlobFallback = false;
      this.fallbackChunks = [];
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


