import { describeError } from "../../contracts/errors.js";

export interface RetryOptions {
  maxRetries?: number;
  initialDelayMs?: number;
  maxDelayMs?: number;
}

export function isSqliteBusyError(error: unknown): boolean {
  if (!error) return false;
  const desc = describeError(error);
  const msg = (error instanceof Error ? error.message : desc.message).toLowerCase();
  const code = (desc.code ?? "").toLowerCase();
  return (
    code.includes("sqlite_busy") ||
    code.includes("sqlite_locked") ||
    msg.includes("sqlite_busy") ||
    msg.includes("sqlite_locked") ||
    msg.includes("database is locked") ||
    msg.includes("database is busy")
  );
}

function sleepSync(ms: number): void {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    // synchronous spin-wait for lock release
  }
}

export function withDbRetry<T>(fn: () => T, options: RetryOptions = {}): T {
  const maxRetries = options.maxRetries ?? 5;
  const initialDelay = options.initialDelayMs ?? 10;
  const maxDelay = options.maxDelayMs ?? 200;

  let attempt = 0;
  while (true) {
    try {
      return fn();
    } catch (err) {
      attempt += 1;
      if (attempt > maxRetries || !isSqliteBusyError(err)) {
        throw err;
      }
      const rawDelay = Math.min(maxDelay, initialDelay * 2 ** (attempt - 1));
      const jitter = 0.8 + Math.random() * 0.4;
      const delay = Math.round(rawDelay * jitter);
      sleepSync(delay);
    }
  }
}

export async function withDbRetryAsync<T>(
  fn: () => Promise<T>,
  options: RetryOptions = {},
): Promise<T> {
  const maxRetries = options.maxRetries ?? 5;
  const initialDelay = options.initialDelayMs ?? 10;
  const maxDelay = options.maxDelayMs ?? 200;

  let attempt = 0;
  while (true) {
    try {
      return await fn();
    } catch (err) {
      attempt += 1;
      if (attempt > maxRetries || !isSqliteBusyError(err)) {
        throw err;
      }
      const rawDelay = Math.min(maxDelay, initialDelay * 2 ** (attempt - 1));
      const jitter = 0.8 + Math.random() * 0.4;
      const delay = Math.round(rawDelay * jitter);
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
}
