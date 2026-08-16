---
name: test-driven-development
description: Implement a behavior change through a focused red-green-refactor loop. Use when adding or fixing deterministic code behavior and a useful automated test can express the requirement before production changes. Do not use for pure documentation, exploratory diagnosis, generated artifacts, or changes whose only meaningful verification is an external manual flow.
---

# Test-Driven Development

## Red

1. Locate the nearest existing test style and the public behavior boundary.
2. Add the smallest test that expresses one required behavior, including the important failure or concurrency case when relevant.
3. Run the focused test and confirm it fails for the intended reason. A syntax, fixture, or environment failure is not a valid red state.

## Green

1. Make the smallest production change that satisfies the test while preserving repository invariants.
2. Run the focused test until it passes. Do not weaken the assertion or mock away the behavior under test.

## Refactor

1. Improve names or structure only after green, keeping behavior stable.
2. Add the next test for another acceptance criterion and repeat.
3. Run the package test/typecheck commands, then proportional root checks.

Prefer observable contracts over private implementation details. For persistence and delegation, cover ordering, durability, cancellation, and error paths rather than only happy-path object construction.
