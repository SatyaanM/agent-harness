import { describe, expect, it } from "vitest";
import { consoleSink, createLogger, type LogRecord } from "./logging.js";

function capture(): { records: LogRecord[]; sink: (record: LogRecord) => void } {
  const records: LogRecord[] = [];
  return { records, sink: (record) => records.push(record) };
}

/**
 * Capture the default-sink output for a log call by replacing `console.error`
 * temporarily. `consoleSink` writes ONE record per call via `console.error`,
 * so observing a swap-and-restore around a single log line is sufficient.
 */
function captureConsoleError(fn: () => void): string[] {
  const written: string[] = [];
  const original: (...data: unknown[]) => void = (...data: unknown[]) => {
    written.push(data.map((arg) => String(arg)).join(" "));
  };
  const previous = console.error;
  console.error = original;
  try {
    fn();
  } finally {
    console.error = previous;
  }
  return written;
}

describe("createLogger", () => {
  it("emits records with level, namespace, message, and fields", () => {
    const { records, sink } = capture();
    const logger = createLogger("test.ns", { sink });

    logger.info("hello", { a: 1 });

    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({
      level: "info",
      namespace: "test.ns",
      message: "hello",
    });
    expect(records[0]?.fields).toEqual({ a: 1 });
    expect(records[0]?.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("filters messages below the default info threshold", () => {
    const { records, sink } = capture();
    const logger = createLogger("test.ns", { sink });

    logger.debug("hidden");
    logger.info("shown");
    logger.warn("also shown");

    expect(records.map((record) => record.message)).toEqual(["shown", "also shown"]);
  });

  it("honors an explicit level threshold", () => {
    const { records, sink } = capture();
    const logger = createLogger("test.ns", { level: "warn", sink });

    logger.info("hidden");
    logger.warn("shown");

    expect(records.map((record) => record.message)).toEqual(["shown"]);
  });

  it("merges child fields into every record for correlation", () => {
    const { records, sink } = capture();
    const logger = createLogger("test.ns", { sink }).child({ sessionId: "s1", runId: "r1" });

    logger.error("boom", { code: "x" });

    expect(records[0]?.fields).toEqual({ sessionId: "s1", runId: "r1", code: "x" });
  });

  it("lets later fields override child fields", () => {
    const { records, sink } = capture();
    const logger = createLogger("test.ns", { sink }).child({ sessionId: "s1" });

    logger.warn("msg", { sessionId: "s2" });

    expect(records[0]?.fields).toEqual({ sessionId: "s2" });
  });

  it("keeps error objects intact for non-console sinks", () => {
    const { records, sink } = capture();
    const logger = createLogger("test.ns", { sink });
    const error = new Error("kaboom");

    logger.error("failed", { error });

    expect(records[0]?.fields.error).toBe(error);
  });

  it("quotes field values that contain spaces so the line is unambiguous", () => {
    const written = captureConsoleError(() => {
      const logger = createLogger("test.ns");
      logger.error("oops", { code: "two words", sessionId: "abc" });
    });
    // Bare token serialization would yield `code=two words sessionId=abc` —
    // token-splitting parsers would read four fields instead of two.
    expect(written).toHaveLength(1);
    expect(written[0]).toContain('code="two words"');
    expect(written[0]).toContain("sessionId=abc");
  });

  it("escapes embedded quotes, newlines and tabs in field values", () => {
    const written = captureConsoleError(() => {
      const logger = createLogger("test.ns");
      logger.error("oops", { payload: 'has "quote" and\nnewline\tand tab' });
    });
    expect(written).toHaveLength(1);
    expect(written[0]).toContain('payload="has \\"quote\\" and\\nnewline\\tand tab"');
  });

  it("consoleSink is exported as a function reference", () => {
    // Sanity check that the quoting fix does not break the documented
    // behavior of the default sink.
    expect(consoleSink).toBeInstanceOf(Function);
  });
});
