import * as ortInstance from "onnxruntime-web";
import { FrameProcessor, FrameProcessorEvent, FrameProcessorOptions } from "./frame-processor";
import { OrtOptions, SpeechProbabilities } from "./models";
export declare const DEFAULT_MODEL = "legacy";
interface RealTimeVADCallbacks {
    /** Callback to run after each frame. The size (number of samples) of a frame is given by `frameSamples`. */
    onFrameProcessed: (probabilities: SpeechProbabilities, frame: Float32Array) => any;
    /** Callback to run if speech start was detected but `onSpeechEnd` will not be run because the
     * audio segment is smaller than `minSpeechFrames`.
     */
    onVADMisfire: () => any;
    /** Callback to run when speech start is detected */
    onSpeechStart: () => any;
    /**
     * Callback to run when speech end is detected.
     * Takes as arg a Float32Array of audio samples between -1 and 1, sample rate 16000.
     * This will not run if the audio segment is smaller than `minSpeechFrames`.
     */
    onSpeechEnd: (audio: Float32Array) => any;
    /** Callback to run when speech is detected as valid. (i.e. not a misfire) */
    onSpeechRealStart: () => any;
}
type AssetOptions = {
    workletOptions: AudioWorkletNodeOptions;
    baseAssetPath: string;
    onnxWASMBasePath: string;
};
type ModelOptions = {
    model: "v5" | "legacy";
};
export interface RealTimeVADOptions extends FrameProcessorOptions, RealTimeVADCallbacks, OrtOptions, AssetOptions, ModelOptions {
    getStream: () => Promise<MediaStream>;
    pauseStream: (stream: MediaStream) => Promise<void>;
    resumeStream: (stream: MediaStream) => Promise<MediaStream>;
    startOnLoad: boolean;
}
export declare const ort: typeof ortInstance;
export declare const getDefaultRealTimeVADOptions: (model: "v5" | "legacy") => RealTimeVADOptions;
export declare class MicVAD {
    options: RealTimeVADOptions;
    private audioContext;
    private audioNodeVAD;
    private listening;
    stream?: MediaStream;
    private sourceNode?;
    private initialized;
    static new(options?: Partial<RealTimeVADOptions>): Promise<MicVAD>;
    private constructor();
    pause: () => void;
    resume: () => Promise<void>;
    start: () => Promise<void>;
    destroy: () => void;
    setOptions: (options: Partial<FrameProcessorOptions>) => void;
}
export declare class AudioNodeVAD {
    ctx: AudioContext;
    options: RealTimeVADOptions;
    frameSamples: number;
    msPerFrame: number;
    private audioNode;
    private frameProcessor;
    private gainNode?;
    private resampler?;
    static new(ctx: AudioContext, options?: Partial<RealTimeVADOptions>): Promise<AudioNodeVAD>;
    constructor(ctx: AudioContext, options: RealTimeVADOptions, frameProcessor: FrameProcessor, frameSamples: number, msPerFrame: number);
    private setupAudioNode;
    pause: () => void;
    start: () => void;
    receive: (node: AudioNode) => void;
    processFrame: (frame: Float32Array) => Promise<void>;
    handleFrameProcessorEvent: (ev: FrameProcessorEvent) => void;
    destroy: () => void;
    setFrameProcessorOptions: (options: Partial<FrameProcessorOptions>) => void;
}
export {};
//# sourceMappingURL=real-time-vad.d.ts.map