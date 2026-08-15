import type { z } from "zod";
import { BoundaryValidationError, parseJsonBoundary } from "./validation.js";

export async function readResponseTextBounded(
  response: Response,
  maxBytes: number,
  boundary: string,
): Promise<string> {
  if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0) {
    throw new RangeError("Response byte limit must be a positive safe integer");
  }

  const declaredLength = response.headers.get("content-length");
  if (declaredLength && /^\d+$/u.test(declaredLength) && Number(declaredLength) > maxBytes) {
    await response.body?.cancel().catch(() => undefined);
    throw new BoundaryValidationError(boundary, `body exceeds ${maxBytes} bytes`);
  }

  const reader = response.body?.getReader();
  if (!reader) return "";

  const decoder = new TextDecoder("utf-8", { fatal: false });
  const chunks: string[] = [];
  let totalBytes = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    totalBytes += value.byteLength;
    if (totalBytes > maxBytes) {
      await reader.cancel();
      throw new BoundaryValidationError(boundary, `body exceeds ${maxBytes} bytes`);
    }
    chunks.push(decoder.decode(value, { stream: true }));
  }
  chunks.push(decoder.decode());
  return chunks.join("");
}

export async function parseJsonResponseBoundary<TSchema extends z.ZodTypeAny>(
  response: Response,
  schema: TSchema,
  boundary: string,
  maxBytes: number,
): Promise<z.output<TSchema>> {
  return parseJsonBoundary(
    schema,
    await readResponseTextBounded(response, maxBytes, boundary),
    boundary,
  );
}
