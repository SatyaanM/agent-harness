import { getTracer, parseJsonBoundary, SpanKind, SpanStatusCode } from "@agent-harness/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import {
  createOtlpHttpExporter,
  getServerTracer,
  initTelemetry,
  ServerTracer,
  type SpanRecord,
  shutdownTelemetry,
} from "./tracer.js";

describe("ServerTracer and Telemetry", () => {
  beforeEach(async () => {
    await shutdownTelemetry();
  });

  afterEach(async () => {
    vi.unstubAllGlobals();
    await shutdownTelemetry();
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

  it("creates a fresh root trace when options.root is true even within an active span", async () => {
    const tracer = new ServerTracer();
    const parent = tracer.startSpan("parent");

    await tracer.withSpan(parent, async () => {
      const rootSpan = tracer.startSpan("independent_root", { root: true });
      expect(rootSpan.spanContext().traceId).not.toBe(parent.spanContext().traceId);
      rootSpan.end();
    });

    parent.end();

    const finished = tracer.getFinishedSpans();
    const rootRecord = finished.find((s) => s.name === "independent_root");
    expect(rootRecord?.parentSpanId).toBeUndefined();
  });

  it("awaits shutdown of flushable exporter in shutdownTelemetry", async () => {
    let shutdownCalled = false;
    const fakeFlushableExporter = Object.assign(() => {}, {
      flush: async () => {},
      shutdown: async () => {
        await new Promise((resolve) => setTimeout(resolve, 10));
        shutdownCalled = true;
      },
    });

    initTelemetry({ enabled: true, exporter: fakeFlushableExporter });
    await shutdownTelemetry();
    expect(shutdownCalled).toBe(true);
  });

  it("correctly serializes integers, floats, and arrays into OTLP payload without errors", async () => {
    let capturedBody: string | undefined;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: unknown, init?: { body?: string }) => {
        capturedBody = init?.body;
        return new Response(null, { status: 200 });
      }),
    );

    const exporter = createOtlpHttpExporter("http://localhost:4318/v1/traces");
    const record: SpanRecord = {
      traceId: "4bf92f3577b34da6a3ce929d0e0e4736",
      spanId: "00f067aa0ba902b7",
      name: "test.otlp",
      kind: SpanKind.INTERNAL,
      startTime: 1000.5, // float timestamp
      endTime: 1050.2, // float timestamp
      durationMs: 49.7,
      status: { code: SpanStatusCode.OK },
      attributes: {
        intAttr: 42,
        floatAttr: 3.14,
        strAttr: "hello",
        boolAttr: true,
        arrayAttr: ["a", "b"],
        numArrayAttr: [1, 2.5],
      },
      events: [],
      links: [],
    };

    await exporter([record]);
    expect(capturedBody).toBeDefined();
    if (!capturedBody) throw new Error("Expected capturedBody");

    const OtlpPayloadSchema = z.object({
      resourceSpans: z.array(
        z.object({
          scopeSpans: z.array(
            z.object({
              spans: z.array(
                z.object({
                  startTimeUnixNano: z.string(),
                  endTimeUnixNano: z.string(),
                  attributes: z.array(
                    z.object({
                      key: z.string(),
                      value: z.unknown(),
                    }),
                  ),
                }),
              ),
            }),
          ),
        }),
      ),
    });

    const parsed = parseJsonBoundary(OtlpPayloadSchema, capturedBody, "otlp payload");
    const span = parsed.resourceSpans[0]?.scopeSpans[0]?.spans[0];
    if (!span) throw new Error("Expected span in parsed OTLP payload");

    expect(span.startTimeUnixNano).toBe("1001000000"); // rounded 1001 * 1e6
    expect(span.endTimeUnixNano).toBe("1050000000"); // rounded 1050 * 1e6

    const attrs = Object.fromEntries(span.attributes.map((a) => [a.key, a.value]));
    expect(attrs.intAttr).toEqual({ intValue: "42" });
    expect(attrs.floatAttr).toEqual({ doubleValue: 3.14 });
    expect(attrs.strAttr).toEqual({ stringValue: "hello" });
    expect(attrs.boolAttr).toEqual({ boolValue: true });
    expect(attrs.arrayAttr).toEqual({
      arrayValue: { values: [{ stringValue: "a" }, { stringValue: "b" }] },
    });
    expect(attrs.numArrayAttr).toEqual({
      arrayValue: { values: [{ intValue: "1" }, { doubleValue: 2.5 }] },
    });
  });
});
