import { describe, expect, it } from "vitest";
import { z } from "zod";
import { parseJsonResponseBoundary, readResponseTextBounded } from "./http.js";

describe("bounded HTTP response parsing", () => {
  it("decodes streamed UTF-8 without splitting multibyte characters", async () => {
    const bytes = new TextEncoder().encode("A🙂B");
    const response = new Response(
      new ReadableStream({
        start(controller) {
          controller.enqueue(bytes.slice(0, 3));
          controller.enqueue(bytes.slice(3));
          controller.close();
        },
      }),
    );

    await expect(readResponseTextBounded(response, 64, "test response")).resolves.toBe("A🙂B");
  });

  it("rejects an oversized declared content length before reading", async () => {
    const response = new Response("small", { headers: { "Content-Length": "100" } });

    await expect(readResponseTextBounded(response, 10, "test response")).rejects.toThrow(
      "exceeds 10 bytes",
    );
  });

  it("rejects an oversized streamed body", async () => {
    const response = new Response("eleven-byte");

    await expect(readResponseTextBounded(response, 10, "test response")).rejects.toThrow(
      "exceeds 10 bytes",
    );
  });

  it("validates JSON after enforcing the byte limit", async () => {
    const response = new Response(JSON.stringify({ ok: true }));

    await expect(
      parseJsonResponseBoundary(response, z.object({ ok: z.literal(true) }), "test response", 64),
    ).resolves.toEqual({ ok: true });
  });
});
