"use client";

import React, { createContext, useContext, useRef, useEffect, useCallback, useMemo } from 'react';

interface AudioContextState {
  audioContextRef: React.MutableRefObject<AudioContext | null>;
  isSupported: boolean;
  initialize: () => Promise<void>;
  resume: () => Promise<void>;
  close: () => void;
}

const AudioContextContext = createContext<AudioContextState | null>(null);

interface AudioContextProviderProps {
  children: React.ReactNode;
}

function getAudioContextConstructor(): (typeof AudioContext) | null {
  if (typeof window === 'undefined') return null;
  const windowWithAudio = window as unknown as {
    AudioContext?: typeof AudioContext;
    webkitAudioContext?: typeof AudioContext;
  };
  return windowWithAudio.AudioContext ?? windowWithAudio.webkitAudioContext ?? null;
}

export function AudioContextProvider({ children }: AudioContextProviderProps) {
  const audioContextRef = useRef<AudioContext | null>(null);
  const isInitializedRef = useRef<boolean>(false);

  const initialize = useCallback(async (): Promise<void> => {
    if (isInitializedRef.current || audioContextRef.current) {
      return;
    }

    const AudioContextClass = getAudioContextConstructor();
    if (!AudioContextClass) {
      throw new Error('AudioContext not supported');
    }

    try {
      const audioContext = new AudioContextClass();
      audioContextRef.current = audioContext;
      isInitializedRef.current = true;

      // Resume context to handle autoplay restrictions
      if (audioContext.state === 'suspended') {
        await audioContext.resume();
      }
    } catch (error) {
      isInitializedRef.current = false;
      audioContextRef.current = null;
      throw new Error(`Failed to create AudioContext: ${error instanceof Error ? error.message : String(error)}`);
    }
  }, []);

  const resume = useCallback(async (): Promise<void> => {
    // If not initialized, initialize first
    if (!isInitializedRef.current || !audioContextRef.current) {
      await initialize();
      return;
    }

    // Only resume if suspended
    if (audioContextRef.current.state === 'suspended') {
      try {
        await audioContextRef.current.resume();
      } catch (error) {
        throw new Error(`Failed to resume AudioContext: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  }, [initialize]);

  const close = useCallback((): void => {
    if (audioContextRef.current && audioContextRef.current.state !== 'closed') {
      try {
        audioContextRef.current.close();
      } catch (error) {
        // Log error but don't throw - cleanup operations should be best-effort
        console.error('Error closing AudioContext:', error);
      }
    }
    audioContextRef.current = null;
    isInitializedRef.current = false;
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      close();
    };
  }, [close]);

  const isSupported = useMemo(() => Boolean(getAudioContextConstructor()), []);

  const value: AudioContextState = useMemo(() => ({
    audioContextRef,
    isSupported,
    initialize,
    resume,
    close,
  }), [isSupported, initialize, resume, close]);

  return (
    <AudioContextContext.Provider value={value}>
      {children}
    </AudioContextContext.Provider>
  );
}

export function useAudioContext(): AudioContextState {
  const context = useContext(AudioContextContext);
  if (!context) {
    throw new Error('useAudioContext must be used within an AudioContextProvider');
  }
  return context;
}

// Hook to get the raw AudioContext instance (convenience wrapper)
export function useAudioContextRef(): AudioContext | null {
  const { audioContextRef } = useAudioContext();
  return audioContextRef.current;
}
