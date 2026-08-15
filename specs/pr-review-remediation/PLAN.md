---
summary: Dependency-ordered implementation plan for correcting the comprehensive PR review findings.
read_when:
  - Implementing or verifying the PR review remediation initiative.
---

# Pull-request review remediation implementation plan

Status: Completed and verified 2026-08-15

## Inputs

- [Remediation specification](README.md)
- [ADR 0002](../../docs/decisions/0002-boundary-validation-and-quality-gates.md)
- [Quality hardening](../quality-hardening/README.md)
- [Current architecture](../../docs/architecture/CURRENT_STATE.md)
- [Security boundary](../../docs/SECURITY.md)

The branch is clean at PR head `d4bcbf85253d45c8a2cf2c1c6359618c037b0f6f`. The existing 123-test suite and CI pass, so every correction needs a focused failure-path assertion rather than relying on the global suite.

## Sequence

1. **Runtime cancellation and transcript integrity.** Extend `Tool` and `ExecutionLimiter` with optional abort contexts, correct the AI SDK option, propagate HTTP disconnects, balance budget-stopped tool calls, and capture completion time after execution. Add core agent/limiter/session-runtime and server chat tests.
2. **External capability and security boundaries.** Correct models.dev provider/model parsing, pin validated outbound addresses, bound regex evaluation, harden plugin paths/state, and cancel declared-oversize response bodies. Add core capability/tool/contract and server registry tests.
3. **Durable-state and transport repair.** Add safe transcript diagnostics, repair-time quarantine for open sessions/settings, metadata-only collection listing, compatible individual response limits, route-specific inbox parsing, and environment-owned `ROOT`. Add core persistence plus server/dashboard boundary tests.
4. **Product adapter correctness.** Make agent writes complete, validated, and atomic; fix chat chunking, TTS base/persona/error behavior, title clearing, and path containment. Add route, provider, and store tests.
5. **Repository controls and documentation.** Serialize the mutating pre-commit step, narrow security exceptions, update current-state/security/README facts, and close the spec/task evidence.
6. **Verification and delivery.** Run focused tests after each vertical slice, then package typechecks, `check`, coverage, audit, docs/skills checks, builds, diff/status review, commit, and push the PR branch.

## Risks and compatibility

- Cancellation API changes are additive: third-party tools may ignore the optional second argument, while built-ins can honor it.
- Metadata-only session collections change an underused API shape; `/api/sessions/:id` remains the full-record contract and `/meta` remains an alias.
- Legacy settings containing `ROOT` continue to parse, but the value no longer appears as editable state.
- Quarantine copies intentionally retain invalid bytes and therefore require operator cleanup after diagnosis.
- Pinned network connections use one validated address per attempt; redirect and response budgets remain unchanged.
- Regex CPU timeouts trade completeness for availability and return an explicit bounded error rather than blocking the event loop indefinitely.

## Completion evidence

Verified from the final implementation tree on 2026-08-15:

- `corepack npm run check` passed, including formatting/lint, repository policy, docs/skills validation, all strict typechecks, 37 Vitest files / 155 tests, production builds, and diff whitespace checks.
- `corepack npm run test:coverage` passed at 34.13% statements, 26.84% branches, 28.10% functions, and 36.33% lines.
- `corepack npm run security:audit` passed with no unaccepted high/critical production findings.

```powershell
corepack npm run typecheck --workspace @agent-harness/core
corepack npm test --workspace @agent-harness/core
corepack npm run typecheck --workspace @agent-harness/server
corepack npm test --workspace @agent-harness/server
corepack npm run typecheck --workspace @agent-harness/dashboard
corepack npm test --workspace @agent-harness/dashboard
corepack npm run check
corepack npm run test:coverage
corepack npm run security:audit
corepack npm run docs:check
corepack npm run skills:validate
git diff --check
```
