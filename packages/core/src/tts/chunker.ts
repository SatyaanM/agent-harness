import type { ChunkerConfig } from "./types.js";

const SENTENCE_ENDINGS = /[.!?;](?:\s|$)|(?:\r?\n)+/g;

function stripBracketTags(text: string): string {
  const visibleParts: string[] = [];
  let visibleStart = 0;
  let tagStart = -1;

  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (character === "[" && tagStart === -1) {
      tagStart = index;
      continue;
    }
    if (character !== "]" || tagStart === -1) continue;

    if (index === tagStart + 1) {
      // The previous expression required at least one character inside a tag.
      tagStart = -1;
      continue;
    }

    visibleParts.push(text.slice(visibleStart, tagStart));
    visibleStart = index + 1;
    tagStart = -1;
  }

  visibleParts.push(text.slice(visibleStart));
  return visibleParts.join("");
}

export interface SpeechChunker {
  addToken(token: string): string[];
  flush(): string;
  reset(): void;
}

export function createSpeechChunker(config: ChunkerConfig): SpeechChunker {
  let buffer = "";

  function countSentences(text: string): number {
    const matches = text.match(SENTENCE_ENDINGS);
    return matches ? matches.length : 0;
  }

  function hasMinimumContent(text: string): boolean {
    const strippedTags = stripBracketTags(text).trim();
    return strippedTags.length >= config.minChars || countSentences(text) >= config.minSentences;
  }

  function findSentenceBoundary(text: string): number {
    let depth = 0;
    let inTag = false;

    for (let i = 0; i < text.length; i++) {
      if (text[i] === "[" && !inTag) {
        inTag = true;
      } else if (text[i] === "]" && inTag) {
        inTag = false;
      } else if (!inTag) {
        const char = text[i];
        const nextChar = text[i + 1];
        const isPunctuationEnding =
          char !== undefined &&
          [".", "!", "?", ";"].includes(char) &&
          (nextChar === undefined || /\s/.test(nextChar));
        const isNewline = char === "\n";

        if (isPunctuationEnding || isNewline) {
          depth++;
          if (depth >= config.minSentences) {
            return i + 1;
          }
        }
      }
    }
    return -1;
  }

  function prepareChunk(text: string, isComplete: boolean): string {
    let chunk = text.trim();

    if (!isComplete) {
      // Replace trailing sentence-ending punctuation with continuation marker
      chunk = chunk.replace(/[.!?]\s*$/, ", ");
      if (!chunk.endsWith("...")) {
        chunk = `${chunk.trimEnd()}...`;
      }
    }

    return chunk;
  }

  return {
    addToken(token: string): string[] {
      buffer += token;
      const chunks: string[] = [];

      while (hasMinimumContent(buffer)) {
        const boundary = findSentenceBoundary(buffer);
        if (boundary === -1) break;

        const chunk = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary);

        chunks.push(prepareChunk(chunk, false));
      }

      return chunks;
    },

    flush(): string {
      if (buffer.trim().length === 0) {
        return "";
      }

      const chunk = prepareChunk(buffer, true);
      buffer = "";
      return chunk;
    },

    reset(): void {
      buffer = "";
    },
  };
}
