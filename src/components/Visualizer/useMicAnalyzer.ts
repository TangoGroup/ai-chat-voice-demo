"use client";
import { useCallback, useEffect, useRef, useState } from "react";

export interface MicAnalyzerOptions {
  smoothingTimeConstant?: number;
  fftSize?: number;
  muted?: boolean; // when true, disable input track for true input mute
  inputStream?: MediaStream; // optional external input; when provided, we won't call getUserMedia
}

export interface MicAnalyzer {
  volume: number;
  isActive: boolean;
  error?: string;
  start: () => Promise<void>;
  stop: () => void;
}

export function useMicAnalyzer(options: MicAnalyzerOptions = {}): MicAnalyzer {
  const { smoothingTimeConstant = 0.8, fftSize = 1024, muted = false, inputStream } = options;

  const [volume, setVolume] = useState<number>(0);
  const [isActive, setIsActive] = useState<boolean>(false);
  const [error, setError] = useState<string | undefined>(undefined);

  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const sourceRef = useRef<MediaStreamAudioSourceNode | MediaElementAudioSourceNode | null>(null);
  const rafRef = useRef<number | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const ownsStreamRef = useRef<boolean>(false);

  const cleanup = useCallback(() => {
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    if (sourceRef.current) {
      try { sourceRef.current.disconnect(); } catch {}
      sourceRef.current = null;
    }
    if (analyserRef.current) {
      try { analyserRef.current.disconnect(); } catch {}
      analyserRef.current = null;
    }
    if (audioContextRef.current) {
      try { audioContextRef.current.close(); } catch {}
      audioContextRef.current = null;
    }
    if (streamRef.current) {
      try { streamRef.current.getTracks().forEach((t) => t.stop()); } catch {}
      streamRef.current = null;
    }
    setIsActive(false);
  }, []);

  const lastVolumeRef = useRef<number>(0);
  const tick = useCallback(() => {
    const analyser = analyserRef.current;
    if (!analyser) return;
    const bufferLength = analyser.fftSize;
    const timeDomainData = new Uint8Array(bufferLength);
    analyser.getByteTimeDomainData(timeDomainData);
    let sumSquares = 0;
    for (let i = 0; i < bufferLength; i += 1) {
      const v = (timeDomainData[i] - 128) / 128;
      sumSquares += v * v;
    }
    const rms = Math.sqrt(sumSquares / bufferLength);
    const normalized = Math.min(1, rms * 1.6);
    const alpha = 0.35;
    const smoothed = lastVolumeRef.current * (1 - alpha) + normalized * alpha;
    lastVolumeRef.current = smoothed;
    setVolume(smoothed);
    rafRef.current = requestAnimationFrame(tick);
  }, []);

  const getAudioContextCtor = useCallback((): (typeof AudioContext) | null => {
    const w = window as unknown as { webkitAudioContext?: typeof AudioContext; AudioContext?: typeof AudioContext };
    return w.AudioContext ?? w.webkitAudioContext ?? null;
  }, []);

  const start = useCallback(async () => {
    try {
      if (isActive) return;
      let stream: MediaStream;
      if (inputStream) {
        stream = inputStream;
        streamRef.current = stream;
        ownsStreamRef.current = false;
      } else {
        stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
        streamRef.current = stream;
        ownsStreamRef.current = true;
      }
      const AC = getAudioContextCtor();
      if (!AC) throw new Error("AudioContext not supported");
      const audioContext = new AC();
      audioContextRef.current = audioContext;
      const analyser = audioContext.createAnalyser();
      analyser.fftSize = fftSize;
      analyser.smoothingTimeConstant = smoothingTimeConstant;
      analyserRef.current = analyser;
      const source = audioContext.createMediaStreamSource(stream);
      sourceRef.current = source;
      source.connect(analyser);
      // Apply current muted state to the input track only if we own the stream
      if (ownsStreamRef.current) {
        try { stream.getAudioTracks().forEach((t) => { t.enabled = !muted; }); } catch {}
      }
      setIsActive(true);
      setError(undefined);
      rafRef.current = requestAnimationFrame(tick);
    } catch (e) {
      const message = e instanceof Error ? e.message : "Unknown microphone error";
      setError(message);
      cleanup();
    }
  }, [cleanup, fftSize, inputStream, isActive, smoothingTimeConstant, tick, muted]);

  // Removed attachAudioElement (unused)

  const stop = useCallback(() => { cleanup(); }, [cleanup]);
  useEffect(() => () => cleanup(), [cleanup]);

  // Respond to external mute toggles by enabling/disabling the actual input track
  useEffect(() => {
    const s = streamRef.current;
    if (!s) return;
    if (ownsStreamRef.current) {
      try { s.getAudioTracks().forEach((t) => { t.enabled = !muted; }); } catch {}
    }
    if (muted) {
      // Force visual volume to 0 immediately to avoid decay artifacts
      lastVolumeRef.current = 0;
      setVolume(0);
    }
  }, [muted]);

  return { volume, isActive, error, start, stop };
}


