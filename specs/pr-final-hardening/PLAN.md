---
summary: Dependency-ordered implementation plan for the final pull-request hardening pass.
read_when:
  - Implementing or verifying the final PR hardening work.
---

# Final pull-request hardening implementation plan

Status: Implemented; publication pending 2026-08-15

## Inputs

- [Hardening specification](README.md)
- [Architecture decisions](../../docs/ARCHITECTURE_DECISIONS.md)
- [Delegate feature specification](../../docs/DELEGATE_FEATURE_SPEC.md)
- [Current architecture](../../docs/architecture/CURRENT_STATE.md)
- [Security boundary](../../docs/SECURITY.md)

The branch starts clean at `f0e57aa28e001e0e85c965388ef62178ff61bf84`; `corepack npm run check` passes 37 files and 155 tests. Review probes, rather than the existing suite, reproduce the defects.

## Sequence

1. **Durable delivery and audit integrity.** Change `MailboxLog`/`SessionStore`, `SessionRuntime`, `Worker`, and delegation to materialize-before-acknowledge, share canonical ordering, persist partial records, remove the live bus leak, and handle every detached failure. Add persistence/runtime/delegation fault and cancellation tests.
2. **Server-owned lifecycle.** Extend `SessionManager` worker ownership and deleted-session guards; wire close/delete unloading, child cancellation, before middleware, and late-completion cleanup. Add route and manager lifecycle tests.
3. **Provider and core boundaries.** Tighten message/response schemas, finish-reason mapping, reasoning separation, capability overrides, index ordering, inbox rollback, grep traversal accounting, and web-fetch cancellation. Add focused core tests.
4. **Plugin and artifact security.** Add recoverable plugin-state repair, deterministic duplicate handling, plugin-qualified commands, and non-executable/no-egress artifact rendering. Add server/dashboard tests.
5. **Dashboard contracts.** Add server-owned raw agent-source round trips, open-state invariants and repair, truthful voice configuration, abortable TTS, terminal worker loading, bounded projections, and correct CSV/source rendering. Add server/dashboard tests.
6. **Documentation and independent review.** Update current-state, security, delegate, and remediation evidence; run focused and full checks; review the complete base-to-head diff again; correct every remaining material finding; commit and push the PR branch.

## Risks and compatibility

- Mailbox acknowledgement rewrites the remaining JSONL file atomically; existing mailbox records remain readable and use `taskId` for idempotency.
- Tightened message schemas may classify previously accepted but unusable transcripts as invalid; collection diagnostics preserve their bytes.
- Removing the unused `Orchestrator` export is an intentional pre-1.0 API correction. The server path is unaffected.
- Agent source endpoints are additive; the existing structured endpoints remain compatible for other clients.
- Closing no longer leaves a runtime loaded. Workers continue and their result remains durable until the conversation is deliberately reopened.
- Renderer restrictions may change previews that depended on active scripts or remote assets; raw files remain unchanged and editable.

## Completion evidence

Run focused tests after every red-green slice, then:

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
