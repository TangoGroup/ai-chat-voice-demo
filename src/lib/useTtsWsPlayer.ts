"use client";

import { useRef, useCallback, useEffect, useMemo } from 'react';
import { TtsWsPlayer, type TtsWsPlayerOptions } from './ttsWs';
import { useAudioContext } from '@/components/AudioContext';

export interface TtsWsPlayerCallbacks {
  onLog?: (msg: string) => void;
  onError?: (error: Error | string, context?: string) => void;
  onFirstAudio?: () => void;
  onFinal?: () => void;
  onVolume?: (v: number) => void;
  onPlaybackEnded?: () => void;
}

export interface TtsWsPlayerConfig {
  apiKey: string;
  voiceId: string;
  modelId?: string;
  stability?: number;
  similarityBoost?: number;
  useSpeakerBoost?: boolean;
  speed?: number;
  chunkLengthSchedule?: number[];
}

export interface TtsWsPlayerControls {
  startSession: (config: TtsWsPlayerConfig, callbacks: TtsWsPlayerCallbacks) => Promise<void>;
  sendText: (text: string, opts?: { flush?: boolean; voiceSettings?: Partial<{ stability: number; similarity_boost: number; use_speaker_boost: boolean; style: number; speed: number; }> }) => void;
  flush: () => void;
  disconnect: () => void; // Idempotent - safe to call multiple times
  endSession: () => void;
  setMuted: (muted: boolean) => void;
  isConnected: () => boolean;
  getPlayer: () => TtsWsPlayer | null; // For direct access if needed (e.g., for cleanup with abort controllers)
}

/**
 * Hook that manages a TtsWsPlayer instance with proper React lifecycle management.
 * 
 * Architecture ensures:
 * - Only one player instance can exist at a time (playerRef is single source of truth)
 * - startSession atomically replaces any existing player
 * - Operations are idempotent (safe to call disconnect multiple times)
 * - Impossible to have orphaned players (ref is cleared synchronously before disconnect)
 */
export function useTtsWsPlayer(): TtsWsPlayerControls {
  const { audioContextRef } = useAudioContext();
  const playerRef = useRef<TtsWsPlayer | null>(null);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (playerRef.current) {
        try {
          playerRef.current.close();
        } catch (error) {
          console.error('Error closing TtsWsPlayer on unmount:', error);
        }
        playerRef.current = null;
      }
    };
  }, []);

  const startSession = useCallback(async (config: TtsWsPlayerConfig, callbacks: TtsWsPlayerCallbacks): Promise<void> => {
    // Atomically replace any existing player
    const oldPlayer = playerRef.current;
    playerRef.current = null; // Clear ref immediately - this prevents any operations on old player
    
    // Clean up old player synchronously (don't await - fire and forget)
    if (oldPlayer) {
      try {
        oldPlayer.close();
      } catch (error) {
        // Ignore cleanup errors for old player
      }
    }

    // Create and connect new player
    const player = new TtsWsPlayer({
      ...config,
      modelId: config.modelId || "eleven_flash_v2_5",
      audioContext: audioContextRef.current || undefined,
      onLog: callbacks.onLog,
      onError: callbacks.onError,
      onFirstAudio: callbacks.onFirstAudio,
      onFinal: callbacks.onFinal,
      onVolume: callbacks.onVolume,
      onPlaybackEnded: callbacks.onPlaybackEnded,
    });

    // Set ref BEFORE connecting so if connect fails, we can clean up
    playerRef.current = player;

    try {
      await player.connect();
      callbacks.onLog?.("TTS WS connected");
    } catch (error) {
      // Connection failed - clear ref and cleanup
      playerRef.current = null;
      try {
        player.close();
      } catch (closeError) {
        // Ignore cleanup errors
      }
      
      const errMsg = `TTS WS connect failed: ${error instanceof Error ? error.message : String(error)}`;
      callbacks.onError?.(error instanceof Error ? error : new Error(errMsg), "connect");
      callbacks.onLog?.(errMsg);
      throw error;
    }
  }, [audioContextRef]);

  const sendText = useCallback((text: string, opts?: { flush?: boolean; voiceSettings?: Partial<{ stability: number; similarity_boost: number; use_speaker_boost: boolean; style: number; speed: number; }> }): void => {
    const player = playerRef.current;
    if (!player) {
      throw new Error('TTS player not connected. Call startSession first.');
    }
    player.sendText(text, opts);
  }, []);

  const flush = useCallback((): void => {
    const player = playerRef.current;
    if (!player) return;
    player.flush();
  }, []);

  const disconnect = useCallback((): void => {
    const player = playerRef.current;
    if (!player) return; // Idempotent - safe to call multiple times
    
    // Clear ref immediately - prevents operations on disconnected player
    playerRef.current = null;
    
    // Cleanup (fire and forget)
    try {
      player.close();
    } catch (error) {
      // Ignore cleanup errors
    }
  }, []);

  const endSession = useCallback((): void => {
    const player = playerRef.current;
    if (!player) return;
    player.endSession();
  }, []);

  const setMuted = useCallback((muted: boolean): void => {
    if (!playerRef.current) return;
    playerRef.current.setMuted(muted);
  }, []);

  const isConnected = useCallback((): boolean => {
    if (!playerRef.current) return false;
    // Check if WebSocket is connected (access private field)
    const ws = (playerRef.current as any).ws;
    return ws !== null && ws.readyState === WebSocket.OPEN;
  }, []);

  const getPlayer = useCallback((): TtsWsPlayer | null => {
    return playerRef.current;
  }, []);

  return useMemo(() => ({
    startSession,
    sendText,
    flush,
    disconnect,
    endSession,
    setMuted,
    isConnected,
    getPlayer,
  }), [startSession, sendText, flush, disconnect, endSession, setMuted, isConnected, getPlayer]);
}
