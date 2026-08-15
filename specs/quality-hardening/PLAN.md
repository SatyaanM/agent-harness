---
summary: Dependency-ordered implementation plan for repository quality policy, validation, tests, hardening, and runtime budgets.
read_when:
  - Implementing or reviewing the quality-hardening initiative.
---

# Quality hardening implementation plan

Status: Completed — initial baseline verified 2026-08-11; corrective increment verified 2026-08-12

## Inputs

- [Quality hardening specification](README.md)
- [ADR 0002](../../docs/decisions/0002-boundary-validation-and-quality-gates.md)
- [`docs/architecture/CURRENT_STATE.md`](../../docs/architecture/CURRENT_STATE.md)
- The verified toolchain checkpoint commit `b3c252e`

## Sequence

1. **Policy and durable rules.** Add the accepted spec/ADR, update scoped `AGENTS.md` files, implement an AST/config policy checker, and test it with failing fixtures. This step does not claim boundary completeness.
2. **Validated boundary primitives.** Add shared domain schemas, server request/error helpers, dashboard response/event parsers, and validated JSON helpers. Migrate direct boundary access without moving Express or browser concerns into core.
3. **Critical invariant tests.** Cover session/mailbox persistence, serialized delivery, wake guards, cancellation, route rejection, identifier/path containment, provider/tool result parsing, and dashboard resynchronization. Add coverage ratchets only after the protected modules have meaningful tests.
4. **Hardening.** Minimize subprocess environments, bound request/tool/provider data, make path authorization symlink-aware, constrain outbound fetches, restrict CORS/binding defaults, and add dependency-audit exception policy.
5. **Runtime budgets.** Enforce configured concurrency and deterministic step, delegation, retry, time, byte, and model-usage budgets. Add fake-provider tests and stable-runner benchmark reporting.
6. **Layered automation.** Wire `check:fast`, `check`, `check:ci`, `security:audit`, `perf:report`, and `check:nightly`; keep pre-commit cheap, pre-push comprehensive, and CI authoritative. Update current-state evidence and close the initiative only after fresh verification.
7. **Adversarial-review corrections.** Preserve raw tool results while bounding only provider context; contain glob patterns and matches; share session/inbox response-size contracts; reuse plugin identifier validation; and reconcile delegation documentation. Drive each deterministic correction through a focused failing test before the production edit, then repeat the full handoff suite.

Each step should land as a coherent commit. Later steps may refine exact files when earlier schemas expose ownership constraints, but may not weaken the package, persistence, delivery, or transcript invariants.

## Risks and compatibility

- Strict persisted schemas can make previously tolerated corrupt or legacy files unreadable. Preserve invalid durable bytes and provide explicit diagnostics or migration rather than destructive fallback.
- Zod parsing can clone objects. Validate at ingress, not inside hot loops, and benchmark large transcript loads before adding repeated parsing.
- Stronger identifier and URL policies can reject currently accepted values. Route errors and migrations must be explicit.
- Timing thresholds are noisy outside a stable runner; deterministic limits remain blocking everywhere.
- Transcript fidelity prevents silent content redaction. Secrets must be kept out of subprocess environments and tool output at the capability boundary.

## Completion evidence

Run focused tests during each red-green-refactor loop, then:

```powershell
corepack npm run check:ci
corepack npm run test:coverage
corepack npm run security:audit
corepack npm run docs:check
corepack npm run skills:validate
git diff --check
```

Network-dependent audit evidence is reported separately from the credential-free check suite.
