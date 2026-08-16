import { isRecord } from "./validation.js";

/**
 * Stable, browser-safe error descriptor used to normalize any thrown value
 * into a machine-readable envelope before logging or emitting it across a
 * boundary (WebSocket, HTTP, worker result). It never leaks stack traces into
 * the descriptor; callers that need the stack read it from the original error.
 */
export interface ErrorDescriptor {
  /** Error class or category name (e.g. "AgentCancelledError"). */
  name: string;
  /** Stable machine-readable code: a Node-style `code` when present, else `name`. */
  code: string;
  /** Human-readable message, stringified safely for non-Error throw values. */
  message: string;
}

function stringifyUnknown(value: unknown): string {
  if (typeof value === "string") return value;
  try {
    const serialized = JSON.stringify(value);
    return serialized ?? String(value);
  } catch {
    return String(value);
  }
}

export function describeError(error: unknown): ErrorDescriptor {
  if (error instanceof Error) {
    const code = isRecord(error) && typeof error.code === "string" ? error.code : error.name;
    return { name: error.name, code, message: error.message };
  }
  return {
    name: "UnknownError",
    code: "unknown_error",
    message: stringifyUnknown(error),
  };
}
