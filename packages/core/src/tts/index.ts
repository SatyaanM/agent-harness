export type {
  TTSConfig,
  ParaphraseConfig,
  ChunkerConfig,
  AudioChunk,
  TTSProvider,
  ParaphraseResult,
} from "./types.js";

export { GEMINI_VOICES, TAG_INDICATORS } from "./types.js";
export type { GeminiVoiceName } from "./types.js";

export { createGeminiTTSProvider } from "./gemini.js";
export { paraphrase } from "./paraphrase.js";
export { createSpeechChunker } from "./chunker.js";
export type { SpeechChunker } from "./chunker.js";
