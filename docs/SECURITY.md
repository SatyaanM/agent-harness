---
summary: Define the implemented harness security boundary, privileged capability controls, dependency policy, and residual risks.
read_when:
  - Changing filesystem, subprocess, network, server exposure, agent budgets, dependencies, or production deployment.
---

# Security boundary

Agent Harness is hardened for a mainly restricted, trusted-operator deployment. It is not a security sandbox for hostile agents or tenants. Run it under an operating-system account and network boundary whose permissions match the damage an agent is allowed to cause.

## Enforced controls

- The HTTP and WebSocket server binds to `127.0.0.1` by default and grants browser CORS access only to the local dashboard origins. External exposure requires deliberate `HOST` and `CORS_ORIGINS` configuration.
- Request, persisted-state, plugin, provider, browser-response, and agent/tool inputs have explicit schemas. Malformed JSON and internal failures use stable public error envelopes rather than returning parser, stack, or filesystem details.
- File tools perform lexical containment and resolve existing paths or the nearest existing write ancestor before authorization. Directory traversal through an existing symlink is rejected; glob patterns must be relative and non-traversing, every glob match is re-authorized after resolution, and globbing and grep traversal do not follow symbolic links.
- `runCommand` is disabled by default and requires `ENABLE_RUN_COMMAND=true`. When enabled, it runs inside the repository root, checks a symlink-resolved working directory, inherits only an operating-system allowlist rather than provider credentials, times out after 30 seconds, and caps buffered output at 1 MiB.
- `webFetch` is disabled by default and requires `ENABLE_WEB_FETCH=true`. When enabled, it permits only HTTP(S), rejects embedded credentials and local/private/reserved IP addresses, resolves and validates the hostname, pins the connection to a validated address while retaining the original HTTP Host and TLS server name, revalidates every redirect, caps redirects at five, times out after 15 seconds, and caps response bodies at 1 MiB.
- Agent runs have step, tool-call, tool-result, provider-output, reported-or-estimated total-token, wall-time, and process-wide concurrency limits. Cancellation reaches queued execution, provider calls, and built-in long-running tools; the server aborts a chat run when its client disconnects. `/api/metrics` exposes active and queued execution counts. Workers cannot use the parent-bound delegate tool recursively.
- Provider, browser, tool-file, directory, search, request-body, and audio reads have explicit byte or entry ceilings before untrusted data can grow without bound. Regex content search runs in a time-bounded VM context so a pathological expression cannot indefinitely block the main application context. Missing provider usage is charged using a conservative token estimate.
- Invalid session transcripts and mailboxes remain byte-preserved and are surfaced through safe diagnostics. Explicit repair writes quarantine invalid small settings or open-session state before replacing the primary file.
- Tamper-evident cryptographic audit logs (`audit_events`) record all administrative actions (session create/rename/delete, agent create/update/delete, settings updates) and privileged tool execution dispatches (`tool.exec.*`) in an immutable, append-only SQLite table with SHA-256 hash chaining and RFC 8785 canonical JSON serialization. Sensitive fields (tokens, authorization headers, passwords, keys) are automatically redacted before hashing. Ledger integrity is verifiable via `corepack pnpm run audit:verify` in $O(1)$ streaming memory.
- HTML inbox artifacts run in a scriptless, no-network sandbox with a restrictive CSP; Markdown previews do not load remote images implicitly. Gemini credentials are sent in request headers rather than URLs, and client disconnect or replacement aborts upstream voice work.
- `security:audit` fails on new high or critical production advisories. An exception must identify both the affected package and exact advisory, include a reason and ISO expiry, and expired exceptions fail even when the package no longer appears in the audit.
- CI actions are pinned to full commit SHAs and repository policy rejects mutable action references.

## Residual risks

- Filesystem authorization is subject to time-of-check/time-of-use races if another process can replace a checked path before the operation. Use OS permissions or container isolation where hostile concurrent mutation is possible.
- Public-address validation and pinning constrain the application request, but network egress policy remains the authoritative defense for high-risk deployments.
- CORS is a browser control, not authentication. Binding beyond loopback without an authenticating reverse proxy exposes privileged APIs.
- Shell commands can perform anything permitted to the harness OS account and can explicitly read files containing secrets. Removing ambient credential variables reduces accidental disclosure but does not make shell execution safe for untrusted instructions.
- Active workers and their abort controllers are process-local and are not recovered after a server restart. Mailbox durability does not provide crash-safe execution recovery.

## Dependency response

Use the repository-pinned package manager and commit `pnpm-lock.yaml`. Run `corepack pnpm run security:audit` after dependency changes and in CI. Prefer a patched compatible release or narrow override with a green build/test suite. If no verified fix exists, add the smallest time-bounded exception and document compensating controls; do not lower the audit threshold or add an unbounded allowlist.
