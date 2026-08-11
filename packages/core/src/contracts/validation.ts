import type { z } from "zod";

export class BoundaryValidationError extends Error {
  constructor(
    readonly boundary: string,
    message: string,
    options?: { cause?: unknown },
  ) {
    super(`Invalid data at ${boundary}: ${message}`, options);
    this.name = "BoundaryValidationError";
  }
}

export function parseBoundary<TSchema extends z.ZodTypeAny>(
  schema: TSchema,
  value: unknown,
  boundary: string,
): z.output<TSchema> {
  const result = schema.safeParse(value);
  if (!result.success) {
    throw new BoundaryValidationError(boundary, result.error.message, { cause: result.error });
  }
  return result.data;
}

export function parseJsonBoundary<TSchema extends z.ZodTypeAny>(
  schema: TSchema,
  text: string,
  boundary: string,
): z.output<TSchema> {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch (error) {
    const message = error instanceof Error ? error.message : "malformed JSON";
    throw new BoundaryValidationError(boundary, message, { cause: error });
  }
  return parseBoundary(schema, value, boundary);
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
