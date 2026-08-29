---
summary: Define the implemented harness security boundary, privileged capability controls, dependency policy, and residual risks.
read_when:
  - Changing filesystem, subprocess, network, server exposure, agent budgets, dependencies, or production deployment.
  - Changing CI security gates, coverage policy, or protected-branch requirements.
---

# Security boundary

Agent Harness is hardened for a mainly restricted, trusted-operator deployment. It is not a security sandbox for hostile agents or tenants. Run it under an operating-system account and network boundary whose permissions match the damage an agent is allowed to cause.

## Enforced controls

- The HTTP and WebSocket server binds to `127.0.0.1` by default and grants browser CORS access only to the local dashboard origins. External exposure requires deliberate `HOST` and `CORS_ORIGINS` configuration.
- Request, persisted-state, plugin, provider, browser-response, and agent/tool inputs have explicit schemas. Malformed JSON and internal failures use stable public error envelopes rather than returning parser, stack, or filesystem details.
- Agent-configuration and inbox routes use server-owned fixed-window classes for configuration reads/writes, filesystem reads/writes, and explorer process launches. They return the stable `rate_limited` `429` envelope before the protected handler runs. Counters use the Express-derived network identity rather than caller-selected forwarding headers, and each store evicts its oldest identity at a fixed capacity (1,024 identities for configuration/filesystem classes and 256 for process launches).
- File tools perform lexical containment and resolve existing paths or the nearest existing write ancestor before authorization. Directory traversal through an existing symlink is rejected; glob patterns must be relative and non-traversing, every glob match is re-authorized after resolution, and globbing and grep traversal do not follow symbolic links. Bounded reads validate and consume the same opened file handle. `editFile` compares the opened file's device/inode identity with the authorized path before and after writing through that handle, rejecting deterministic path-retargeting races instead of writing the replacement target.
- `runCommand` is disabled by default and requires `ENABLE_RUN_COMMAND=true`. When enabled, it runs inside the repository root, checks a symlink-resolved working directory, inherits only an operating-system allowlist rather than provider credentials, times out after 30 seconds, and caps buffered output at 1 MiB.
- `webFetch` is disabled by default and requires `ENABLE_WEB_FETCH=true`. When enabled, it permits only HTTP(S), rejects embedded credentials and local/private/reserved IP addresses, resolves and validates the hostname, pins the connection to a validated address while retaining the original HTTP Host and TLS server name, revalidates every redirect, caps redirects at five, times out after 15 seconds, and caps response bodies at 1 MiB.
- Agent runs have step, tool-call, tool-result, provider-output, reported-or-estimated total-token, wall-time, and process-wide concurrency limits. Cancellation reaches queued execution, provider calls, and built-in long-running tools; the server aborts a chat run when its client disconnects. `/api/metrics` exposes active and queued execution counts. Workers cannot use the parent-bound delegate tool recursively.
- Provider, browser, tool-file, directory, search, request-body, and audio reads have explicit byte or entry ceilings before untrusted data can grow without bound. Regex content search runs in a time-bounded VM context so a pathological expression cannot indefinitely block the main application context. TTS bracket-tag filtering uses a single-pass parser rather than a potentially polynomial regular expression, including for long unmatched prefixes. Missing provider usage is charged using a conservative token estimate.
- Invalid session transcripts and mailboxes remain byte-preserved and are surfaced through safe diagnostics. Explicit repair writes quarantine invalid small settings or open-session state before replacing the primary file.
- Settings persistence is bounded to 20 updates per client per minute. Rejected updates return `429` before filesystem mutation, runtime reconfiguration, or audit emission.
- Tamper-evident cryptographic audit logs (`audit_events`) record all administrative actions (session create/rename/delete, agent create/update/delete, settings updates) and privileged tool execution dispatches (`tool.exec.*`) in an immutable, append-only SQLite table with SHA-256 hash chaining and RFC 8785 canonical JSON serialization. Sensitive fields (tokens, authorization headers, passwords, keys) are automatically redacted before hashing. Ledger integrity is verifiable via `corepack pnpm run audit:verify` in $O(1)$ streaming memory.
- HTML inbox artifacts run in a scriptless, no-network sandbox with a restrictive CSP; Markdown previews do not load remote images implicitly. Gemini credentials are sent in request headers rather than URLs, and client disconnect or replacement aborts upstream voice work.
- `security:audit` fails on new high or critical production advisories. An exception must identify both the affected package and exact advisory, include a reason and ISO expiry, and expired exceptions fail even when the package no longer appears in the audit.
- Staged secret scanning reads each staged blob from Git's index, so replacing the working-tree path after staging cannot change the bytes being checked. Full-directory scans continue to inspect local working-tree files.
- CI actions are pinned to full commit SHAs and repository policy rejects mutable action references. Pull requests run named Linux and Windows repository gates, a separate full-stack browser gate, and a CodeQL gate that rejects unsuppressed SARIF results with security severity 7.0 or higher. The scheduled/manual ZAP baseline fails on ZAP `FAIL` findings while retaining `WARN` results for issue-based triage. Coverage CI enforces fixed overall and security-sensitive path floors plus at least 70% line coverage for newly added production source files.

## Repository security gates

Repository workflows define checks, but GitHub branch protection must require them before they become merge requirements. A maintainer must configure the `development` branch to require these exact pull-request checks:

- `Required repository gates (ubuntu-latest)` (workflow: `CI`)
- `Required repository gates (windows-latest)` (workflow: `CI`)
- `Required full-stack gate` (workflow: `Full-stack E2E`)
- `Required CodeQL High/Critical gate` (workflow: `CodeQL Analysis`)

The CodeQL gate evaluates SARIF produced by the current workflow run; it does not query or close historical alerts already stored by GitHub. An in-source suppression is accepted only when CodeQL emits it with a non-empty justification, so suppressions still require review. ZAP is scheduled and manually dispatchable rather than a pull-request check; maintainers must monitor its failing runs and triage generated issues, or separately choose to add an appropriate pull-request trigger before making it a protected-branch requirement.

The coverage policy is an explicit approximation, not executable-line differential coverage. It ratchets aggregate statements, branches, functions, and lines against the recorded baseline, applies path-specific line floors, and evaluates whole-file line coverage only for newly added production source files discovered from the pull-request base SHA. Modified-file differential coverage and automatic upward ratcheting are not implemented.

## Residual risks

- Handle-based reads and edits remediate the identified check-then-use patterns, but the harness does not provide general filesystem or process isolation. Other operations and concurrent hostile mutation can still introduce time-of-check/time-of-use races; use OS permissions or container isolation where that threat exists.
- Route-rate counters are process-local fixed windows and reset on restart; separate server processes do not share state. Capacity eviction bounds memory but can also reset the evicted identity's effective allowance under high-cardinality traffic. These limits are availability controls, not user identity, authorization, or authentication.
- Public-address validation and pinning constrain the application request, but network egress policy remains the authoritative defense for high-risk deployments.
- CORS is a browser control, not authentication. Binding beyond loopback without an authenticating reverse proxy exposes privileged APIs.
- Shell commands can perform anything permitted to the harness OS account and can explicitly read files containing secrets. Removing ambient credential variables reduces accidental disclosure but does not make shell execution safe for untrusted instructions.
- Active workers and their abort controllers are process-local and are not recovered after a server restart. Mailbox durability does not provide crash-safe execution recovery.

## Dependency response

Use the repository-pinned package manager and commit `pnpm-lock.yaml`. Run `corepack pnpm run security:audit` after dependency changes and in CI. Prefer a patched compatible release or narrow override with a green build/test suite. If no verified fix exists, add the smallest time-bounded exception and document compensating controls; do not lower the audit threshold or add an unbounded allowlist.
