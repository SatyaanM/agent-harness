import { describe, expect, it } from "vitest";
import {
  getTracer,
  NoopSpan,
  NoopTracer,
  resetGlobalTracer,
  SpanKind,
  SpanStatusCode,
  setGlobalTracer,
  W3CTraceContext,
  W3CTraceParentSchema,
} from "./tracing.js";

describe("tracing contracts and W3C context", () => {
  it("parses valid W3C traceparent headers", () => {
    const header = "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01";
    const parsed = W3CTraceContext.parseTraceParent(header);
    expect(parsed).toEqual({
      traceId: "4bf92f3577b34da6a3ce929d0e0e4736",
      spanId: "00f067aa0ba902b7",
      traceFlags: 1,
    });
  });

  it("serializes W3C traceparent headers accurately", () => {
    const context = {
      traceId: "4bf92f3577b34da6a3ce929d0e0e4736",
      spanId: "00f067aa0ba902b7",
      traceFlags: 1,
    };
    const header = W3CTraceContext.serializeTraceParent(context);
    expect(header).toBe("00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01");
  });

  it("rejects invalid or all-zero traceparent headers", () => {
    expect(W3CTraceContext.parseTraceParent("invalid")).toBeUndefined();
    expect(
      W3CTraceContext.parseTraceParent("00-00000000000000000000000000000000-00f067aa0ba902b7-01"),
    ).toBeUndefined();
    expect(
      W3CTraceContext.parseTraceParent("00-4bf92f3577b34da6a3ce929d0e0e4736-0000000000000000-01"),
    ).toBeUndefined();
  });

  it("validates headers with Zod schema", () => {
    expect(
      W3CTraceParentSchema.safeParse("00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01")
        .success,
    ).toBe(true);
    expect(W3CTraceParentSchema.safeParse("invalid-traceparent").success).toBe(false);
    expect(
      W3CTraceParentSchema.safeParse("00-00000000000000000000000000000000-00f067aa0ba902b7-01")
        .success,
    ).toBe(false);
    expect(
      W3CTraceParentSchema.safeParse("00-4bf92f3577b34da6a3ce929d0e0e4736-0000000000000000-01")
        .success,
    ).toBe(false);
  });

  it("extracts and injects trace context from carriers", () => {
    const carrier: Record<string, string> = {};
    const context = {
      traceId: "4bf92f3577b34da6a3ce929d0e0e4736",
      spanId: "00f067aa0ba902b7",
      traceFlags: 1,
      traceState: "congo=t61rcWkgMzE",
    };

    W3CTraceContext.inject(context, carrier);
    expect(carrier.traceparent).toBe("00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01");
    expect(carrier.tracestate).toBe("congo=t61rcWkgMzE");

    const extracted = W3CTraceContext.extract(carrier);
    expect(extracted).toEqual(context);
  });

  it("provides zero-overhead NoopTracer and NoopSpan by default", async () => {
    resetGlobalTracer();
    const tracer = getTracer();
    expect(tracer).toBeInstanceOf(NoopTracer);

    const span = tracer.startSpan("test.operation", { kind: SpanKind.INTERNAL });
    expect(span).toBeInstanceOf(NoopSpan);
    expect(span.isRecording()).toBe(false);

    span.setAttribute("key", "value");
    span.setAttributes({ a: 1, b: true });
    span.setStatus({ code: SpanStatusCode.OK });
    span.recordException(new Error("boom"));
    span.addEvent("event", { attr: "val" });
    span.end();

    const result = await tracer.withSpan(span, async () => {
      return 42;
    });
    expect(result).toBe(42);
  });

  it("allows setting and resetting global tracer", () => {
    const customTracer = new NoopTracer();
    setGlobalTracer(customTracer);
    expect(getTracer()).toBe(customTracer);

    resetGlobalTracer();
    expect(getTracer()).toBe(NoopTracer.instance);
  });

  it("defines OpenTelemetry-compatible SpanKind and SpanStatusCode enums", () => {
    expect(SpanKind.INTERNAL).toBe(0);
    expect(SpanKind.SERVER).toBe(1);
    expect(SpanKind.CLIENT).toBe(2);
    expect(SpanKind.PRODUCER).toBe(3);
    expect(SpanKind.CONSUMER).toBe(4);

    expect(SpanStatusCode.UNSET).toBe(0);
    expect(SpanStatusCode.OK).toBe(1);
    expect(SpanStatusCode.ERROR).toBe(2);
  });
});
