import { parseJsonResponseBoundary } from "@agent-harness/core/contracts";
import { z } from "zod";

export type PlaybackState = "idle" | "playing" | "paused";

const TTS_BASE_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";
const MAX_AUDIO_BYTES = 25_000_000;
const TTSErrorSchema = z.object({ error: z.string().optional() }).passthrough();

export interface TTSPlayer {
  play(text: string, options?: TTSPlayOptions): Promise<void>;
  stop(): void;
  pause(): void;
  resume(): void;
  getState(): PlaybackState;
  onStateChange(callback: (state: PlaybackState) => void): void;
}

export interface TTSPlayOptions {
  voice?: string;
  persona?: string;
  emotiveTags?: boolean;
  tagStyle?: "conservative" | "balanced" | "expressive";
  customTagInstructions?: string;
}

interface AudioQueueItem {
  buffer: AudioBuffer;
}

export function createTTSPlayer(): TTSPlayer {
  let audioContext: AudioContext | null = null;
  let currentSource: AudioBufferSourceNode | null = null;
  let state: PlaybackState = "idle";
  const stateCallbacks: Array<(state: PlaybackState) => void> = [];
  let audioQueue: AudioQueueItem[] = [];
  let isPlaying = false;

  function notifyStateChange(newState: PlaybackState) {
    state = newState;
    stateCallbacks.forEach((callback) => {
      callback(newState);
    });
  }

  function getAudioContext(): AudioContext {
    if (!audioContext) {
      audioContext = new AudioContext();
    }
    return audioContext;
  }

  async function decodeAudioChunk(
    pcmData: ArrayBuffer,
    sampleRate: number = 24000,
  ): Promise<AudioBuffer> {
    const ctx = getAudioContext();
    // Convert Int16 PCM to Float32 for Web Audio API
    const int16Array = new Int16Array(pcmData);
    const float32Array = new Float32Array(int16Array.length);
    for (let i = 0; i < int16Array.length; i++) {
      float32Array[i] = int16Array[i] / 32768.0;
    }

    const audioBuffer = ctx.createBuffer(1, float32Array.length, sampleRate);
    audioBuffer.getChannelData(0).set(float32Array);
    return audioBuffer;
  }

  function playFromQueue() {
    if (isPlaying || audioQueue.length === 0) return;

    isPlaying = true;
    const item = audioQueue.shift();
    if (!item) {
      isPlaying = false;
      return;
    }
    const ctx = getAudioContext();

    const source = ctx.createBufferSource();
    source.buffer = item.buffer;
    source.connect(ctx.destination);

    currentSource = source;

    source.onended = () => {
      currentSource = null;
      isPlaying = false;
      if (audioQueue.length > 0) {
        playFromQueue();
      } else if (state === "playing") {
        notifyStateChange("idle");
      }
    };

    source.start(0);
    notifyStateChange("playing");
  }

  function addFadeEnvelope(
    buffer: AudioBuffer,
    fadeInMs: number = 5,
    fadeOutMs: number = 5,
  ): AudioBuffer {
    const ctx = getAudioContext();
    const newBuffer = ctx.createBuffer(buffer.numberOfChannels, buffer.length, buffer.sampleRate);

    const fadeInSamples = Math.floor((fadeInMs / 1000) * buffer.sampleRate);
    const fadeOutSamples = Math.floor((fadeOutMs / 1000) * buffer.sampleRate);

    for (let channel = 0; channel < buffer.numberOfChannels; channel++) {
      const inputData = buffer.getChannelData(channel);
      const outputData = newBuffer.getChannelData(channel);

      for (let i = 0; i < inputData.length; i++) {
        let gain = 1.0;
        if (i < fadeInSamples) {
          gain = i / fadeInSamples;
        } else if (i > inputData.length - fadeOutSamples) {
          gain = (inputData.length - i) / fadeOutSamples;
        }
        outputData[i] = inputData[i] * gain;
      }
    }

    return newBuffer;
  }

  return {
    async play(text: string, options?: TTSPlayOptions): Promise<void> {
      this.stop();

      try {
        const response = await fetch(`${TTS_BASE_URL}/api/tts`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            text,
            voice: options?.voice || "Gacrux",
            persona: options?.persona || "",
            emotiveTags: options?.emotiveTags ?? true,
            tagStyle: options?.tagStyle ?? "balanced",
            customTagInstructions: options?.customTagInstructions || "",
          }),
        });

        if (!response.ok) {
          const error = await parseJsonResponseBoundary(
            response,
            TTSErrorSchema,
            "TTS error response",
            64_000,
          );
          throw new Error(error.error || "TTS request failed");
        }

        const declaredLength = Number(response.headers.get("content-length"));
        if (Number.isFinite(declaredLength) && declaredLength > MAX_AUDIO_BYTES) {
          await response.body?.cancel();
          throw new Error("TTS audio exceeds maximum size");
        }

        const reader = response.body?.getReader();
        if (!reader) throw new Error("No response body");

        const chunks: Uint8Array[] = [];
        let totalLength = 0;
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          chunks.push(value);
          totalLength += value.byteLength;
          if (totalLength > MAX_AUDIO_BYTES) {
            await reader.cancel();
            throw new Error("TTS audio exceeds maximum size");
          }
        }

        // Combine all chunks into a single buffer
        const combinedBuffer = new Uint8Array(totalLength);
        let offset = 0;
        for (const chunk of chunks) {
          combinedBuffer.set(chunk, offset);
          offset += chunk.length;
        }

        // Decode and add to queue
        const audioBuffer = await decodeAudioChunk(combinedBuffer.buffer);
        const fadedBuffer = addFadeEnvelope(audioBuffer);
        audioQueue.push({ buffer: fadedBuffer });

        playFromQueue();
      } catch (error) {
        console.error("[TTS Player] Error:", error);
        notifyStateChange("idle");
        throw error;
      }
    },

    stop(): void {
      if (currentSource) {
        currentSource.stop();
        currentSource = null;
      }
      audioQueue = [];
      isPlaying = false;
      notifyStateChange("idle");
    },

    pause(): void {
      if (audioContext && state === "playing") {
        audioContext.suspend();
        notifyStateChange("paused");
      }
    },

    resume(): void {
      if (audioContext && state === "paused") {
        audioContext.resume();
        notifyStateChange("playing");
      }
    },

    getState(): PlaybackState {
      return state;
    },

    onStateChange(callback: (state: PlaybackState) => void): void {
      stateCallbacks.push(callback);
    },
  };
}
