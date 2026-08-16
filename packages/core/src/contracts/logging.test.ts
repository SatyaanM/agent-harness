import { describe, expect, it } from "vitest";
import { createLogger, type LogRecord } from "./logging.js";

function capture(): { records: LogRecord[]; sink: (record: LogRecord) => void } {
  const records: LogRecord[] = [];
  return { records, sink: (record) => records.push(record) };
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
});
