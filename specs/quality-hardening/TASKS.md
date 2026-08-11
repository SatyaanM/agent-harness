---
summary: Track reviewable quality-hardening tasks and their acceptance evidence.
read_when:
  - Selecting or handing off the next quality-hardening implementation task.
---

# Quality hardening tasks

- [x] **T00 - Preserve the toolchain baseline**
  - Depends on: pre-development bootstrap
  - Scope: Biome, Lefthook, root Vitest projects/coverage, deterministic root check, formatting baseline
  - Acceptance: full check and coverage command pass; commit `b3c252e`
  - Verify: `corepack npm run check`; `corepack npm run test:coverage`
  - Docs/handoff: baseline and current-state verification updated
- [x] **T01 - Enforce repository quality policy**
  - Depends on: T00
  - Scope: spec, ADR, `AGENTS.md`, `scripts/check-quality-policy.mjs`, policy fixtures/tests, root scripts
  - Acceptance: resolved TypeScript strictness and forbidden source patterns are checked; negative fixtures fail for the intended reason
  - Verify: focused tooling tests; `corepack npm run quality:policy`; root check
  - Docs/handoff: mark implemented policy checks distinctly from planned checks
- [x] **T02 - Validate transport and serialized boundaries**
  - Depends on: T01
  - Scope: core schemas and JSON helpers; server request parsing; dashboard API/event parsing; provider result guards
  - Acceptance: boundary values enter as `unknown`; invalid API, disk, provider, and browser payloads cannot enter trusted state
  - Verify: core/server/dashboard focused contract tests and root check
  - Docs/handoff: update current-state validation evidence and compatibility notes
- [x] **T03 - Protect critical runtime invariants**
  - Depends on: T02
  - Scope: SessionStore/mailbox, SessionRuntime, delegation/wake/cancellation, path authorization
  - Acceptance: ordering, corruption, concurrency, cancellation, and failure paths have deterministic tests
  - Verify: focused package tests, coverage report, root check
  - Docs/handoff: record threshold baseline and uncovered residual risk
- [x] **T04 - Harden privileged capabilities and supply chain**
  - Depends on: T02
  - Scope: subprocess environment/policy, filesystem containment, outbound fetch policy, server exposure, audit exceptions
  - Acceptance: privileged operations default to bounded behavior; new high/critical production advisories fail without an unexpired exception
  - Verify: hardening tests; security audit; root check
  - Docs/handoff: threat-boundary and exception policy documentation
- [x] **T05 - Enforce runtime performance and cost budgets**
  - Depends on: T03
  - Scope: concurrency limiter, run/delegation/tool/provider budgets, metrics, deterministic budget tests, benchmark reporting
  - Acceptance: configured limits are enforced and observable; no paid provider calls are required
  - Verify: budget tests; `perf:report`; root check
  - Docs/handoff: measured baselines and stable-runner requirements
- [x] **T06 - Make CI authoritative and close the baseline**
  - Depends on: T01-T05
  - Scope: layered scripts, CI/nightly workflows, branch-check documentation, final adversarial review
  - Acceptance: clean checkout reproduces required checks; hooks mirror but do not replace CI; current-state docs match implementation
  - Verify: `check:ci`, coverage, security audit, docs/skills, diff check
  - Docs/handoff: mark initiative complete and list deferred runtime/provider work
