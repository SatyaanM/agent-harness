---
name: code-review
description: Review a diff, branch, pull request, or proposed patch for correctness, regressions, security, invariant violations, and missing tests. Use when the requested outcome is findings and risk assessment rather than implementation. Do not trigger for ordinary self-review during implementation unless an independent review is explicitly requested.
---

# Code Review

## Establish scope

1. Identify the comparison base and inspect repository instructions, relevant docs, the full diff, and affected call paths.
2. Understand intended behavior before judging the implementation. Verify claims against source and tests.

## Find material issues

Prioritize:

- incorrect behavior and unhandled failure paths;
- persistence ordering, concurrency, cancellation, and state-authority violations;
- security boundary regressions in filesystem, command, network, or API handling;
- incompatible contracts across core, server, dashboard, and stored data;
- missing tests that allow a plausible regression to pass.

Ignore preference-only style unless it hides a real risk. Do not report speculation as a defect; investigate until the impact is supportable.

## Report

Lead with findings ordered by severity. For each, cite a tight file/line location, explain the failing scenario and impact, and give a concise correction direction. Then list open questions and a short verification summary. If there are no findings, say so and identify residual test or coverage risk. Do not edit unless the user asks for fixes.
