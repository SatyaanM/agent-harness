import { describe, expect, it } from "vitest";
import {
  llmDurationHistogram,
  mailboxEventsCounter,
  metricRegistry,
  tokensTotalCounter,
  toolDurationHistogram,
  ttftHistogram,
} from "./index.js";
import { MetricCounter, MetricGauge, MetricHistogram, MetricRegistry } from "./metrics.js";
import {
  sanitizeAgentName,
  sanitizeLabelName,
  sanitizeLabelValue,
  sanitizeModelId,
} from "./sanitization.js";

describe("metrics registry and sanitization", () => {
  it("increments counters monotonically and handles labels", () => {
    const counter = new MetricCounter<"agent" | "model">({
      name: "test_counter",
      help: "A test counter",
      type: "counter",
    });

    counter.inc({ agent: "orchestrator", model: "gpt-4o" }, 5);
    counter.inc({ agent: "orchestrator", model: "gpt-4o" }, 3);
    counter.inc({ agent: "worker", model: "qwen" }, 2);

    const samples = counter.collect();
    expect(samples.length).toBe(2);

    const orchestratorSample = samples.find(
      (s) => s.labels.agent === "orchestrator" && s.labels.model === "gpt-4o",
    );
    expect(orchestratorSample?.value).toBe(8);

    expect(() => counter.inc(undefined, -1)).toThrow(RangeError);
  });

  it("sets, increments, and decrements gauges", () => {
    const gauge = new MetricGauge({
      name: "test_gauge",
      help: "A test gauge",
      type: "gauge",
    });

    gauge.set(undefined, 10);
    expect(gauge.collect()[0]?.value).toBe(10);

    gauge.inc(undefined, 5);
    expect(gauge.collect()[0]?.value).toBe(15);

    gauge.dec(undefined, 3);
    expect(gauge.collect()[0]?.value).toBe(12);
  });

  it("observes values in histograms with cumulative buckets", () => {
    const histogram = new MetricHistogram<"status">({
      name: "test_duration",
      help: "Test duration in seconds",
      buckets: [0.1, 0.5, 1.0, 5.0],
      type: "histogram",
    });

    histogram.observe({ status: "success" }, 0.05);
    histogram.observe({ status: "success" }, 0.4);
    histogram.observe({ status: "success" }, 0.8);
    histogram.observe({ status: "success" }, 2.0);

    const buckets = histogram.collectBuckets();
    const b01 = buckets.find((b) => b.labels.le === "0.1");
    const b05 = buckets.find((b) => b.labels.le === "0.5");
    const b10 = buckets.find((b) => b.labels.le === "1");
    const b50 = buckets.find((b) => b.labels.le === "5");
    const bInf = buckets.find((b) => b.labels.le === "+Inf");

    expect(b01?.value).toBe(1);
    expect(b05?.value).toBe(2);
    expect(b10?.value).toBe(3);
    expect(b50?.value).toBe(4);
    expect(bInf?.value).toBe(4);

    const counts = histogram.collectCounts();
    expect(counts[0]?.value).toBe(4);

    const timer = histogram.startTimer({ status: "success" });
    const duration = timer();
    expect(duration).toBeGreaterThanOrEqual(0);
  });

  it("serializes metrics into Prometheus exposition format", () => {
    const registry = new MetricRegistry();
    const counter = registry.registerCounter({
      name: "requests_total",
      help: "Total requests",
      type: "counter",
    });
    counter.inc(undefined, 10);

    const text = registry.metrics();
    expect(text).toContain("# HELP requests_total Total requests");
    expect(text).toContain("# TYPE requests_total counter");
    expect(text).toContain("requests_total 10");
  });

  it("exports and updates predefined telemetry metrics", () => {
    tokensTotalCounter.inc({ type: "input", model: "qwen", agent: "orchestrator" }, 100);
    llmDurationHistogram.observe({ agent: "orchestrator", model: "qwen", status: "success" }, 0.5);
    ttftHistogram.observe({ agent: "orchestrator", model: "qwen" }, 0.1);
    toolDurationHistogram.observe({ tool: "readFile", status: "success" }, 0.02);
    mailboxEventsCounter.inc({ status: "success" }, 1);

    const metricsText = metricRegistry.metrics();
    expect(metricsText).toContain("agent_harness_tokens_total");
    expect(metricsText).toContain("agent_harness_llm_duration_seconds");
    expect(metricsText).toContain("agent_harness_ttft_seconds");
    expect(metricsText).toContain("agent_harness_tool_duration_seconds");
    expect(metricsText).toContain("agent_harness_mailbox_events_total");
  });

  it("sanitizes agent names and models to prevent cardinality issues", () => {
    expect(sanitizeAgentName("../../bad/agent")).toBe("______bad_agent");
    expect(sanitizeAgentName("")).toBe("orchestrator");
    expect(sanitizeAgentName("valid-agent_1")).toBe("valid-agent_1");

    expect(sanitizeModelId("opencode-go/qwen3.7-plus?key=123")).toBe("qwen3.7-plus");
    expect(sanitizeModelId("claude-3-5-sonnet@20241022")).toBe("claude-3-5-sonnet");

    expect(sanitizeLabelName("1invalid")).toBe("_1invalid");
    expect(sanitizeLabelValue('hello "world"\nnew')).toBe('hello \\"world\\"\\nnew');
  });
});
