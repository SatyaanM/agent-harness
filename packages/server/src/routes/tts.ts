import { Router } from "express";
import { createGeminiTTSProvider, GEMINI_VOICES } from "@agent-harness/core";
import type { TTSConfig } from "@agent-harness/core";

export const ttsRouter = Router();

ttsRouter.post("/", async (req, res) => {
  const {
    text,
    voice,
    persona,
    emotiveTags,
    tagStyle,
    customTagInstructions,
  } = req.body as {
    text?: string;
    voice?: string;
    persona?: string;
    emotiveTags?: boolean;
    tagStyle?: "conservative" | "balanced" | "expressive";
    customTagInstructions?: string;
  };

  if (!text) {
    res.status(400).json({ error: "text is required" });
    return;
  }

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
      emotiveTags: emotiveTags ?? true,
      tagStyle: tagStyle ?? "balanced",
      customTagInstructions: customTagInstructions ?? "",
    });

    console.log("[tts] Paraphrasing...", { textLength: text.length });

    const paraphraseResponse = await fetch(
      "https://opencode.ai/zen/go/v1/chat/completions",
      {
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
      }
    );

    let paraphrasedText = text; // fallback to original

    if (paraphraseResponse.ok) {
      const result = (await paraphraseResponse.json()) as {
        choices?: Array<{
          message?: {
            content?: string | null;
            reasoning?: string | null;
            reasoning_content?: string | null;
          };
        }>;
      };
      const message = result.choices?.[0]?.message;
      const content =
        message?.content || message?.reasoning || message?.reasoning_content || "";
      if (content) {
        paraphrasedText = content;
        console.log("[tts] Paraphrased:", {
          original: text.length,
          paraphrased: paraphrasedText.length,
        });
      }
    } else {
      console.log("[tts] Paraphrase failed, using original text");
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
  } catch (error) {
    console.error("[tts] Error:", error);
    const errorMessage = error instanceof Error ? error.message : String(error);
    res.status(500).json({ error: errorMessage });
  }
});

function buildParaphrasePrompt(
  text: string,
  options: {
    emotiveTags: boolean;
    tagStyle: string;
    customTagInstructions: string;
  }
): string {
  const parts: string[] = [];

  parts.push(`You are a voice narrator. Rewrite the following agent response
as a natural spoken summary. Strip all code, file paths, UUIDs,
hashes, and technical identifiers. Use conversational prose.
Keep it under 5 sentences. Do not add greetings or closings.`);

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
