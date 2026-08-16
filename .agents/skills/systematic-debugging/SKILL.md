---
name: systematic-debugging
description: Diagnose an observed failure to a supported root cause before proposing or implementing a fix. Use for failing tests, runtime errors, regressions, flaky behavior, state divergence, or performance problems where the cause is unknown. Do not use when the defect and required change are already established.
---

# Systematic Debugging

## Reproduce and bound

1. Capture the exact symptom, environment, inputs, expected behavior, and smallest reliable reproduction.
2. Read applicable instructions and trace the real execution path across package, API, event, and persistence boundaries.
3. Reduce the failing surface without changing production behavior.

## Form and test hypotheses

1. Collect evidence at state transitions: inputs, durable state, emitted events, and outputs.
2. List plausible causes and rank them by evidence, not familiarity.
3. Change one diagnostic variable at a time. Use focused tests or temporary instrumentation and remove diagnostic residue.
4. Distinguish root cause from downstream symptoms and unrelated warnings.

## Conclude

Report the root cause with file/symbol evidence, reproduction, impact, and remaining uncertainty. If a fix is requested, add a regression test that fails for the root cause, apply the smallest correction, and run focused plus proportional verification. Do not implement speculative fixes merely because they are nearby.
