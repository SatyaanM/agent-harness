import type { TTSConfig } from "@agent-harness/core";
import {
  createGeminiTTSProvider,
  GEMINI_VOICES,
  parseJsonResponseBoundary,
} from "@agent-harness/core";
import { Router } from "express";
import { z } from "zod";
import { asyncHandler } from "../http/async-handler.js";
import { validateRequest } from "../http/validation.js";

export const ttsRouter = Router();

const TTSRequestSchema = z
  .object({
    text: z.string().min(1).max(20_000),
    voice: z.string().min(1).max(128).optional(),
    persona: z.string().max(10_000).optional(),
    emotiveTags: z.boolean().optional(),
    tagStyle: z.enum(["conservative", "balanced", "expressive"]).optional(),
    customTagInstructions: z.string().max(10_000).optional(),
  })
  .strict();
const ParaphraseResponseSchema = z.object({
  choices: z
    .array(
      z.object({
        message: z
          .object({
            content: z.string().nullable().optional(),
            reasoning: z.string().nullable().optional(),
            reasoning_content: z.string().nullable().optional(),
          })
          .optional(),
      }),
    )
    .optional(),
});

ttsRouter.post(
  "/",
  asyncHandler(async (req, res) => {
    const request = validateRequest(TTSRequestSchema, req.body, res);
    if (!request) return;
    const { text, voice, persona, emotiveTags, tagStyle, customTagInstructions } = request;

    const geminiApiKey = process.env.GEMINI_API_KEY;
    const openCodeApiKey = process.env.OPENCODE_API_KEY;

    if (!geminiApiKey) {
      res.status(503).json({
        error: "Voice requires a Gemini API key. Configure in Settings > Voice.",
      });
      return;
    }

    try {
      // Step 1: Paraphrase with MiMo-V2.5
      const paraphrasePrompt = buildParaphrasePrompt(text, {
        persona: persona ?? "",
        emotiveTags: emotiveTags ?? true,
        tagStyle: tagStyle ?? "balanced",
        customTagInstructions: customTagInstructions ?? "",
      });

      let paraphrasedText = text; // fallback to original

      if (openCodeApiKey) {
        const paraphraseResponse = await fetch("https://opencode.ai/zen/go/v1/chat/completions", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${openCodeApiKey}`,
          },
          body: JSON.stringify({
            model: "mimo-v2.5",
            messages: [{ role: "user", content: paraphrasePrompt }],
            temperature: 0.7,
          }),
          signal: AbortSignal.timeout(15_000),
        });

        if (paraphraseResponse.ok) {
          const result = await parseJsonResponseBoundary(
            paraphraseResponse,
            ParaphraseResponseSchema,
            "TTS paraphrase response",
            1_000_000,
          );
          const message = result.choices?.[0]?.message;
          const content =
            message?.content || message?.reasoning || message?.reasoning_content || "";
          if (content) paraphrasedText = content;
        }
      }

      // Step 2: Synthesize with Gemini TTS
      const ttsConfig: TTSConfig = {
        provider: "gemini",
        model: "gemini-3.1-flash-tts-preview",
        voice: voice || "Gacrux",
        persona: persona || "",
        emotiveTags: emotiveTags ?? true,
        tagStyle: tagStyle ?? "balanced",
        customTagInstructions: customTagInstructions ?? "",
        apiKey: geminiApiKey,
      };

      const ttsProvider = createGeminiTTSProvider();
      const audioChunks = await ttsProvider.synthesize(paraphrasedText, ttsConfig);

      // Stream audio chunks to client
      res.setHeader("Content-Type", "application/octet-stream");
      res.setHeader("Cache-Control", "no-cache");
      res.setHeader("Connection", "keep-alive");
      res.flushHeaders();

      for await (const chunk of audioChunks) {
        const buffer = Buffer.from(chunk.data.buffer);
        res.write(buffer);
      }

      res.end();
    } catch {
      console.error("[tts] Request failed");
      if (res.headersSent) {
        res.end();
        return;
      }
      res.status(502).json({ error: "Voice generation failed" });
    }
  }),
);

function buildParaphrasePrompt(
  text: string,
  options: {
    persona: string;
    emotiveTags: boolean;
    tagStyle: string;
    customTagInstructions: string;
  },
): string {
  const parts: string[] = [];

  parts.push(`You are a voice narrator. Rewrite the following agent response
as a natural spoken summary. Strip all code, file paths, UUIDs,
hashes, and technical identifiers. Use conversational prose.
Keep it under 5 sentences. Do not add greetings or closings.`);

  if (options.persona.trim()) {
    parts.push(`Narration persona: ${options.persona.trim()}`);
  }

  if (options.emotiveTags) {
    parts.push(`Insert emotive audio tags anywhere they enhance delivery:
- [excitedly] for good news or achievements
- [sighs] for error summaries or setbacks
- [curious] for questions or suggestions
- [serious] for warnings or critical info
- [whispers] for asides or optional notes
- [laughs] for lighthearted moments
- Tags can go at the start of a line OR inline within a sentence
- Use multiple tags per sentence when the tone shifts mid-thought`);

    const styleMap: Record<string, string> = {
      conservative: "Use only essential tags: [excitedly], [sighs], [serious], [whispers]",
      balanced: "Use a moderate variety of tags",
      expressive: "Use creative and frequent tags. Be inventive to make delivery lively",
    };
    parts.push(styleMap[options.tagStyle] || styleMap.balanced);
  }

  if (options.customTagInstructions) {
    parts.push(`Additional instructions: ${options.customTagInstructions}`);
  }

  parts.push(`Agent response:\n${text}`);

  return parts.join("\n\n");
}

// GET /api/tts/voices - List available voices
ttsRouter.get("/voices", (_req, res) => {
  res.json(GEMINI_VOICES);
});
