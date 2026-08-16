import type { ChunkerConfig } from "./types.js";

const SENTENCE_ENDINGS = /[.!?;]\s|\n/;
const TAG_PATTERN = /\[([^\]]+)\]/g;

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
    const strippedTags = text.replace(TAG_PATTERN, "").trim();
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
      } else if (!inTag && SENTENCE_ENDINGS.test(text[i])) {
        depth++;
        if (depth >= config.minSentences) {
          return i + 1;
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
