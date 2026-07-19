import type { ParaphraseConfig, ParaphraseResult } from "./types.js";

const TAG_REGEX = /\[([^\]]+)\]/g;

function getTagInstructions(config: ParaphraseConfig): string {
  const base = `
- [excitedly] for good news or achievements
- [sighs] for error summaries or setbacks
- [curious] for questions or suggestions
- [serious] for warnings or critical info
- [whispers] for asides or optional notes
- [laughs] for lighthearted moments`;

  const conservative = `
Use only these essential tags: [excitedly], [sighs], [serious], [whispers]`;

  const balanced = `
Use a moderate variety of tags. Mix emotional, pace, and volume tags as appropriate`;

  const expressive = `
Use creative and frequent tags. Try combinations like [sarcastically, one painfully slow word at a time].
Be inventive with tags to make delivery lively and engaging`;

  let instructions = base;

  switch (config.tagStyle) {
    case "conservative":
      instructions += conservative;
      break;
    case "balanced":
      instructions += balanced;
      break;
    case "expressive":
      instructions += expressive;
      break;
  }

  if (config.customTagInstructions) {
    instructions += `\nAdditional instructions: ${config.customTagInstructions}`;
  }

  return instructions;
}

function buildParaphrasePrompt(
  text: string,
  config: ParaphraseConfig
): string {
  const tagInstructions = config.emotiveTags ? getTagInstructions(config) : "";

  const tagSection = config.emotiveTags
    ? `
Insert emotive audio tags anywhere they enhance delivery:
${tagInstructions}
- Tags can go at the start of a line OR inline within a sentence
- Use multiple tags per sentence when the tone shifts mid-thought

Examples:
[excitedly] I've finished the refactoring! All tests pass.
The build took a while, [sighs] but we got there in the end.
[whispers] By the way, [curious] did you want me to also update the docs?
[excitedly] Tests are green! [serious] But heads up, the deploy script needs attention.`
    : "";

  return `You are a voice narrator. Rewrite the following agent response
as a natural spoken summary. Strip all code, file paths, UUIDs,
hashes, and technical identifiers. Use conversational prose.
Keep it under ${config.maxSentences} sentences. Do not add greetings or closings.
${tagSection}

Agent response:
${text}`;
}

function extractTags(text: string): string[] {
  const tags: string[] = [];
  let match;
  while ((match = TAG_REGEX.exec(text)) !== null) {
    tags.push(match[1]);
  }
  return tags;
}

export async function paraphrase(
  text: string,
  config: ParaphraseConfig,
  llmCall: (prompt: string) => Promise<string>
): Promise<ParaphraseResult> {
  if (!text || text.trim().length === 0) {
    return { text: "", tags: [] };
  }

  const prompt = buildParaphrasePrompt(text, config);
  const result = await llmCall(prompt);
  const tags = extractTags(result);

  return {
    text: result.trim(),
    tags,
  };
}
