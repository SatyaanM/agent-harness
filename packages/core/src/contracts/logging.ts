/**
 * Browser-safe structured logging contract.
 *
 * A single, dependency-free logger is shared by core, server, and dashboard.
 * Namespaces identify the emitting module; `child(fields)` attaches stable
 * correlation context (sessionId, runId, requestId, taskId) so a run can be
 * traced across the HTTP edge, the runtime, workers, and WebSocket events.
 *
 * The default sink writes one human-readable, greppable line per record.
 * Tests and adapters inject their own sink to capture records without
 * touching the console.
 */

export type LogLevel = "debug" | "info" | "warn" | "error";

export interface LogRecord {
  level: LogLevel;
  namespace: string;
  message: string;
  fields: Record<string, unknown>;
  timestamp: string;
}

export type LogSink = (record: LogRecord) => void;

export interface Logger {
  debug(message: string, fields?: Record<string, unknown>): void;
  info(message: string, fields?: Record<string, unknown>): void;
  warn(message: string, fields?: Record<string, unknown>): void;
  error(message: string, fields?: Record<string, unknown>): void;
  /** Return a logger that always merges the given fields into every record. */
  child(fields: Record<string, unknown>): Logger;
}

const LEVEL_PRIORITY: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

function isLogLevel(value: string): value is LogLevel {
  return value === "debug" || value === "info" || value === "warn" || value === "error";
}

function stringifyValue(value: unknown): string {
  if (value instanceof Error) {
    const stack = value.stack ? ` (${value.stack})` : "";
    return `${value.name}: ${value.message}${stack}`;
  }
  if (typeof value === "string") return value;
  try {
    const serialized = JSON.stringify(value);
    return serialized ?? String(value);
  } catch {
    return String(value);
  }
}

function needsQuoting(value: string): boolean {
  // Field values may contain spaces, tabs, newlines, quotes, or characters
  // that break greppability when written as bare tokens. Quoting is the
  // difference between an unambiguous record and one that parses as more
  // tokens than were actually written.
  if (value.length === 0) return true;
  if (/[\s"'\\=]/u.test(value)) return true;
  return false;
}

function quoteValue(value: string): string {
  // Use backslash escapes for control characters and quote characters that
  // would otherwise break simple shell-style parsing; everything else passes
  // through inside double-quotes.
  const escaped = value
    .replace(/\\/gu, "\\\\")
    .replace(/"/gu, '\\"')
    .replace(/\n/gu, "\\n")
    .replace(/\r/gu, "\\r")
    .replace(/\t/gu, "\\t");
  return `"${escaped}"`;
}

function serializeFields(fields: Record<string, unknown>): string {
  const entries = Object.entries(fields);
  if (entries.length === 0) return "";
  return entries
    .map(([key, value]) => {
      const stringified = stringifyValue(value);
      return `${key}=${needsQuoting(stringified) ? quoteValue(stringified) : stringified}`;
    })
    .join(" ");
}

/** Default sink: one greppable line per record via the matching console method. */
export function consoleSink(record: LogRecord): void {
  const fields = serializeFields(record.fields);
  const suffix = fields.length > 0 ? ` ${fields}` : "";
  const line = `[${record.timestamp}] ${record.level.toUpperCase()} ${record.namespace}: ${record.message}${suffix}`;
  switch (record.level) {
    case "debug":
      console.debug(line);
      break;
    case "info":
      console.info(line);
      break;
    case "warn":
      console.warn(line);
      break;
    case "error":
      console.error(line);
      break;
  }
}

export interface LoggerOptions {
  level?: LogLevel;
  sink?: LogSink;
}

export function createLogger(namespace: string, options?: LoggerOptions): Logger {
  const sink = options?.sink ?? consoleSink;
  const levelValue = options?.level ?? "info";
  const threshold: LogLevel = isLogLevel(levelValue) ? levelValue : "info";

  function build(fields: Record<string, unknown>): Logger {
    function log(level: LogLevel, message: string, recordFields?: Record<string, unknown>): void {
      if (LEVEL_PRIORITY[level] < LEVEL_PRIORITY[threshold]) return;
      sink({
        level,
        namespace,
        message,
        fields: { ...fields, ...recordFields },
        timestamp: new Date().toISOString(),
      });
    }

    return {
      debug(message, recordFields) {
        log("debug", message, recordFields);
      },
      info(message, recordFields) {
        log("info", message, recordFields);
      },
      warn(message, recordFields) {
        log("warn", message, recordFields);
      },
      error(message, recordFields) {
        log("error", message, recordFields);
      },
      child(extra) {
        return build({ ...fields, ...extra });
      },
    };
  }

  return build({});
}
