import { describe, expect, it } from "vitest";
import { createSpeechChunker } from "./chunker.js";

describe("SpeechChunker", () => {
  it("chunks streaming tokens on sentence boundaries", () => {
    const chunker = createSpeechChunker({ minChars: 10, minSentences: 1 });

    const chunks1 = chunker.addToken("Hello world. ");
    expect(chunks1).toEqual(["Hello world,..."]);

    const chunks2 = chunker.addToken("How are you today");
    expect(chunks2).toEqual([]);

    const flushed = chunker.flush();
    expect(flushed).toBe("How are you today");
  });

  it("handles multi-sentence thresholds", () => {
    const chunker = createSpeechChunker({ minChars: 10, minSentences: 2 });

    const chunks1 = chunker.addToken("First sentence. Second sentence. Third part");
    expect(chunks1).toEqual(["First sentence. Second sentence,..."]);

    const flushed = chunker.flush();
    expect(flushed).toBe("Third part");
  });

  it("ignores punctuation inside emotive tags [brackets]", () => {
    const chunker = createSpeechChunker({ minChars: 10, minSentences: 1 });

    const chunks1 = chunker.addToken("[whispering: Wait... Don't go!] Are you sure?");
    expect(chunks1).toEqual(["[whispering: Wait... Don't go!] Are you sure,..."]);
  });

  it("handles a long unmatched tag prefix in bounded time", () => {
    const chunker = createSpeechChunker({ minChars: 10, minSentences: 1 });
    const input = "[".repeat(50_000);
    const startedAt = performance.now();

    expect(chunker.addToken(input)).toEqual([]);
    expect(performance.now() - startedAt).toBeLessThan(750);
    expect(chunker.flush()).toBe(input);
  });

  it("preserves chunking around a long valid emotive tag", () => {
    const chunker = createSpeechChunker({ minChars: 10, minSentences: 1 });
    const tag = `[${"quietly ".repeat(10_000)}]`;

    expect(chunker.addToken(`${tag} Ready now. Next`)).toEqual([`${tag} Ready now,...`]);
    expect(chunker.flush()).toBe("Next");
  });

  it("splits on newlines", () => {
    const chunker = createSpeechChunker({ minChars: 5, minSentences: 1 });

    const chunks = chunker.addToken("Line one\nLine two");
    expect(chunks).toEqual(["Line one..."]);
    expect(chunker.flush()).toBe("Line two");
  });

  it("resets internal buffer", () => {
    const chunker = createSpeechChunker({ minChars: 10, minSentences: 1 });
    chunker.addToken("Some incomplete text");
    chunker.reset();
    expect(chunker.flush()).toBe("");
  });
});
