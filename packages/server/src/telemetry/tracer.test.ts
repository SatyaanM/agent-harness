import { getTracer, SpanKind, SpanStatusCode } from "@agent-harness/core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  getServerTracer,
  initTelemetry,
  ServerTracer,
  type SpanRecord,
  shutdownTelemetry,
} from "./tracer.js";

describe("ServerTracer and Telemetry", () => {
  beforeEach(() => {
    shutdownTelemetry();
  });

  afterEach(() => {
    shutdownTelemetry();
  });

  it("creates and records server spans accurately", () => {
    const tracer = new ServerTracer();
    const span = tracer.startSpan("test.operation", {
      kind: SpanKind.SERVER,
      attributes: { "http.method": "POST" },
    });

    expect(span.isRecording()).toBe(true);
    span.setAttribute("http.status_code", 200);
    span.addEvent("request_processed", { count: 1 });
    span.setStatus({ code: SpanStatusCode.OK });
    span.end();

    expect(span.isRecording()).toBe(false);
    const finished = tracer.getFinishedSpans();
    expect(finished.length).toBe(1);
    expect(finished[0]?.name).toBe("test.operation");
    expect(finished[0]?.kind).toBe(SpanKind.SERVER);
    expect(finished[0]?.attributes["http.method"]).toBe("POST");
    expect(finished[0]?.attributes["http.status_code"]).toBe(200);
    expect(finished[0]?.events.length).toBe(1);
    expect(finished[0]?.status.code).toBe(SpanStatusCode.OK);
  });

  it("propagates trace context across async withSpan execution", async () => {
    const tracer = new ServerTracer();
    const parentSpan = tracer.startSpan("parent.task");

    await tracer.withSpan(parentSpan, async (activeParent) => {
      expect(tracer.currentSpan()).toBe(activeParent);
      expect(tracer.currentContext()?.traceId).toBe(activeParent.spanContext().traceId);

      const childSpan = tracer.startSpan("child.task");
      expect(childSpan.spanContext().traceId).toBe(activeParent.spanContext().traceId);

      await tracer.withSpan(childSpan, async () => {
        expect(tracer.currentContext()?.spanId).toBe(childSpan.spanContext().spanId);
      });

      childSpan.end();
    });

    parentSpan.end();

    const finished = tracer.getFinishedSpans();
    expect(finished.length).toBe(2);
    const childRecord = finished.find((s) => s.name === "child.task");
    const parentRecord = finished.find((s) => s.name === "parent.task");
    expect(childRecord?.traceId).toBe(parentRecord?.traceId);
    expect(childRecord?.parentSpanId).toBe(parentRecord?.spanId);
  });

  it("records exceptions and sets error status on failures", async () => {
    const tracer = new ServerTracer();
    const span = tracer.startSpan("failing.operation");

    await expect(
      tracer.withSpan(span, async () => {
        throw new Error("Operation failed");
      }),
    ).rejects.toThrow("Operation failed");

    span.end();

    const finished = tracer.getFinishedSpans();
    expect(finished.length).toBe(1);
    expect(finished[0]?.status.code).toBe(SpanStatusCode.ERROR);
    expect(finished[0]?.events.some((e) => e.name === "exception")).toBe(true);
  });

  it("initializes and registers global tracer with exporter", async () => {
    const exported: SpanRecord[] = [];
    const tracer = initTelemetry({
      enabled: true,
      exporter: (spans) => {
        exported.push(...spans);
      },
    });

    expect(tracer).toBeDefined();
    expect(getTracer()).toBe(tracer);
    expect(getServerTracer()).toBe(tracer);

    const span = getTracer().startSpan("global.action");
    span.end();

    expect(exported.length).toBe(1);
    expect(exported[0]?.name).toBe("global.action");

    shutdownTelemetry();
    expect(getTracer()).not.toBe(tracer);
    expect(getServerTracer()).toBeUndefined();
  });

  it("buffers spans and flushes when batch limit is reached", async () => {
    const batches: SpanRecord[][] = [];
    const tracer = new ServerTracer({
      exporter: (spans) => {
        batches.push([...spans]);
      },
    });

    const s1 = tracer.startSpan("span_1");
    s1.end();
    const s2 = tracer.startSpan("span_2");
    s2.end();

    expect(batches.length).toBe(2);
    await tracer.flush();
  });
});
