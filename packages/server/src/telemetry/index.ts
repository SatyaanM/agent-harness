import { MetricRegistry } from "./metrics.js";

export * from "./metrics.js";
export * from "./sanitization.js";
export * from "./tracer.js";

export const metricRegistry = new MetricRegistry();

// 1. Tokens Total Counter
export const tokensTotalCounter = metricRegistry.registerCounter<"agent" | "model" | "type">({
  name: "agent_harness_tokens_total",
  help: "Total count of tokens processed by provider LLMs.",
  labelNames: ["agent", "model", "type"],
  type: "counter",
});

// 2. LLM Duration Histogram
export const llmDurationHistogram = metricRegistry.registerHistogram<"agent" | "model" | "status">({
  name: "agent_harness_llm_duration_seconds",
  help: "Latency of provider LLM chat completions in seconds.",
  labelNames: ["agent", "model", "status"],
  buckets: [0.1, 0.25, 0.5, 1, 2.5, 5, 10, 30],
  type: "histogram",
});

// 3. Time To First Token (TTFT) Histogram
export const ttftHistogram = metricRegistry.registerHistogram<"agent" | "model">({
  name: "agent_harness_ttft_seconds",
  help: "Time to first token in streaming LLM completions in seconds.",
  labelNames: ["agent", "model"],
  buckets: [0.05, 0.1, 0.25, 0.5, 1, 2],
  type: "histogram",
});

// 4. Tool Duration Histogram
export const toolDurationHistogram = metricRegistry.registerHistogram<"tool" | "status">({
  name: "agent_harness_tool_duration_seconds",
  help: "Duration of tool executions in seconds.",
  labelNames: ["tool", "status"],
  buckets: [0.01, 0.05, 0.1, 0.5, 1, 5, 10, 30],
  type: "histogram",
});

// 5. Concurrency Active Runs Gauge
export const concurrencyActiveGauge = metricRegistry.registerGauge({
  name: "agent_harness_concurrency_active_runs",
  help: "Current number of actively running agent executions.",
  type: "gauge",
});

// 6. Concurrency Queue Depth Gauge
export const concurrencyQueueDepthGauge = metricRegistry.registerGauge({
  name: "agent_harness_concurrency_queue_depth",
  help: "Number of agent executions waiting for concurrency limiter capacity.",
  type: "gauge",
});

// 7. Mailbox Events Total Counter
export const mailboxEventsCounter = metricRegistry.registerCounter<"status">({
  name: "agent_harness_mailbox_events_total",
  help: "Total count of worker mailbox completion events processed.",
  labelNames: ["status"],
  type: "counter",
});

// 8. Sessions Gauge
export const sessionsGauge = metricRegistry.registerGauge<"state">({
  name: "agent_harness_sessions",
  help: "Current number of sessions (loaded in-memory vs persisted in database).",
  labelNames: ["state"],
  type: "gauge",
});
