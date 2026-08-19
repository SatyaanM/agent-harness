---
name: browser-qa-triage
description: Analyze Playwright test traces, screenshots, and server logs to isolate UI regressions and codify them into deterministic assertions.
---

# Browser QA Triage

## Overview

When Playwright tests fail or detect non-deterministic behavior, this workflow guides systematic triage, root-cause isolation, and codification into deterministic regression tests.

## Triage Procedure

1. **Inspect Failure Artifacts**:
   - Locate generated Playwright traces in `test-results/` or dashboard trace logs.
   - Open trace in viewer: `pnpm exec playwright show-trace test-results/<path>/trace.zip`.
   - Inspect console logs, network payloads, and DOM snapshots at the exact point of assertion failure.

2. **Isolate Component vs Integration**:
   - If the failure is purely visual layout or event binding, check the corresponding Vitest component test in `packages/dashboard/src/components/`.
   - If the failure involves state rehydration, tab sync, or SSE streaming, check the server routes (`packages/server/src/routes/`) and SessionRuntime SQLite queries.

3. **Codify Regression**:
   - Write a minimal failing test reproducing the exact timing or state condition before applying fixes.
   - Verify the test passes reliably across 5 consecutive runs.
