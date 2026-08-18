---
name: benchmark-runner
description: Execute reproducible latency, token throughput, and memory profiling benchmarks against Agent Harness. Use when evaluating performance optimizations, concurrency limits, or regression thresholds.
---

# Benchmark Runner

## Preparation
1. Ensure the server or test environment runs against an isolated, temporary, or in-memory persistence store.
2. Terminate background processes that could distort CPU or memory measurement.

## Execution
1. Run `node scripts/perf-report.mjs` or the dedicated benchmark command.
2. Execute a warm-up phase (at least 3-5 iterations) before recording metrics to allow V8 JIT optimization.
3. Record P50, P95, and P99 latencies, peak memory RSS, and token throughput.

## Analysis and Ratchet
1. Compare measured metrics against durable baselines in `docs/benchmarks/` or performance reports.
2. If latency or memory exceeds configured budgets, profile hot paths using Node.js `--prof` or V8 CPU sampling.
3. Document confirmed performance improvements or budget updates in the corresponding PR or decision record.
