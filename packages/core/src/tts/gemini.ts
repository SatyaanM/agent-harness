import { z } from "zod";
import { parseJsonResponseBoundary } from "../contracts/http.js";
import type { AudioChunk, TTSConfig, TTSProvider } from "./types.js";

const GEMINI_TTS_ENDPOINT =
  "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-tts-preview:generateContent";

const GeminiResponseSchema = z.object({
  candidates: z
    .array(
      z.object({
        content: z
          .object({
            parts: z
              .array(
                z.object({
                  inlineData: z.object({ mimeType: z.string(), data: z.string() }).optional(),
                }),
              )
              .optional(),
          })
          .optional(),
      }),
    )
    .optional(),
  error: z.object({ code: z.number(), message: z.string() }).optional(),
});

export function createGeminiTTSProvider(): TTSProvider {
  return {
    async synthesize(text: string, config: TTSConfig): Promise<AsyncIterable<AudioChunk>> {
      if (!config.apiKey) {
        throw new Error("Gemini API key is required");
      }

      const url = `${GEMINI_TTS_ENDPOINT}?key=${config.apiKey}`;

      const narrationText = config.persona.trim()
        ? `Narration persona: ${config.persona.trim()}\n\n${text}`
        : text;

      const requestBody = {
        contents: [{ parts: [{ text: narrationText }] }],
        generation_config: {
          response_modalities: ["AUDIO"],
          speech_config: {
            voice_config: {
              prebuilt_voice_config: {
                voice_name: config.voice,
              },
            },
          },
        },
      };

      const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(requestBody),
        signal: AbortSignal.timeout(30_000),
      });

      if (!response.ok) {
        throw new Error(`Gemini TTS request failed with status ${response.status}`);
      }

      const result = await parseJsonResponseBoundary(
        response,
        GeminiResponseSchema,
        "Gemini TTS response",
        25_000_000,
      );

      if (result.error) {
        throw new Error(`Gemini TTS request failed with provider code ${result.error.code}`);
      }

      const audioData = result.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
      if (!audioData) {
        throw new Error("No audio data in Gemini TTS response");
      }

      // Decode base64 to Int16Array
      const binaryString = atob(audioData);
      const bytes = new Uint8Array(binaryString.length);
      for (let i = 0; i < binaryString.length; i++) {
        bytes[i] = binaryString.charCodeAt(i);
      }
      const int16Array = new Int16Array(bytes.buffer);

      // Return as async iterable (single chunk for non-streaming)
      return (async function* () {
        yield {
          data: int16Array,
          sampleRate: 24000,
          channels: 1,
        };
      })();
    },
  };
}
