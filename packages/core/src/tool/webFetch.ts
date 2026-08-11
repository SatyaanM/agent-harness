import { z } from "zod";
import { isRecord } from "../validation.js";
import type { Tool } from "./types.js";

const WebFetchParams = z.object({
  url: z.string().url(),
  format: z.enum(["text", "json"]).optional().default("text"),
});

const MAX_BODY_BYTES = 1024 * 1024;

export const webFetchTool: Tool<typeof WebFetchParams> = {
  name: "webFetch",
  description: "Fetch content from a URL. Returns the response body as text or JSON.",
  parameters: WebFetchParams,

  async execute(args) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15_000);

    try {
      const res = await fetch(args.url, {
        signal: controller.signal,
        headers: { "User-Agent": "agent-harness/0.1.0" },
        redirect: "follow",
      });

      if (!res.ok) {
        return `[error] HTTP ${res.status} ${res.statusText}`;
      }

      const reader = res.body?.getReader();
      if (!reader) {
        return "[error] Response has no body.";
      }

      const chunks: Uint8Array[] = [];
      let total = 0;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
        total += value.byteLength;
        if (total > MAX_BODY_BYTES) {
          reader.cancel().catch(() => {});
          return "[error] Response body exceeds maximum size (1 MB).";
        }
      }

      const decoder = new TextDecoder("utf-8", { fatal: false });
      const text = chunks.map((c) => decoder.decode(c)).join("");

      if (args.format === "json") {
        try {
          const parsed = JSON.parse(text);
          return JSON.stringify(parsed, null, 2);
        } catch {
          return text;
        }
      }

      return text;
    } catch (err: unknown) {
      if (isRecord(err) && err.name === "AbortError") {
        return "[error] Request timed out after 15 seconds.";
      }
      const message = err instanceof Error ? err.message : String(err);
      return `[error] ${message}`;
    } finally {
      clearTimeout(timeout);
    }
  },
};
