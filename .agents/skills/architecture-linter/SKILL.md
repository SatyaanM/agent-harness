---
name: architecture-linter
description: Enforce, diagnose, and extend architectural boundaries and AST quality policies. Use when reviewing package import isolation, boundary schema validation, Express route handlers, or adding new quality rules.
---

# Architecture Linter

## Diagnosis
1. Run `node scripts/check-quality-policy.mjs` to execute static AST policy checks across all packages.
2. If violations occur, identify the violated architectural invariant:
   - `boundaries/core-isolation`: Core must never import UI, server frameworks, or adapter packages.
   - `boundaries/dashboard-contracts-only`: Dashboard must only import from `@agent-harness/core/contracts`.
   - `boundaries/validate-request`: Express routes must pass inputs through `validateRequest`.
   - `boundaries/validated-json`: Serialization must use `parseJsonBoundary` with an explicit Zod schema.
   - `persistence/single-writer-only`: Writes must route through designated persistence managers.

## Remediation
1. Refactor imports to respect package layer boundaries. Move shared contracts into `packages/core/src/contracts/`.
2. Wrap external ingress points with Zod schemas. Never cast unvalidated data using `as` or `any`.

## Policy Extension
1. When defining new architectural rules, add an AST visitor in `scripts/check-quality-policy.mjs`.
2. Add corresponding test cases in `scripts/check-quality-policy.test.mts`.
3. Verify with `corepack pnpm run quality:policy` and unit tests.
