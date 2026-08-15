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
- `webFetch` is disabled by default and requires `ENABLE_WEB_FETCH=true`. When enabled, it permits only HTTP(S), rejects embedded credentials and local/private/reserved IP addresses, resolves hostnames before use, revalidates every redirect, caps redirects at five, times out after 15 seconds, and caps response bodies at 1 MiB.
- Agent runs have step, tool-call, tool-result, provider-output, reported-or-estimated total-token, wall-time, and process-wide concurrency limits. `/api/metrics` exposes active and queued execution counts. Workers cannot use the parent-bound delegate tool recursively.
- Provider, browser, tool-file, directory, search, request-body, and audio reads have explicit byte or entry ceilings before untrusted data can grow without bound. Missing provider usage is charged using a conservative token estimate.
- `security:audit` fails on new high or critical production advisories. An exception must be recorded in `security-audit-exceptions.json` with a reason and ISO expiry; expired exceptions fail even when the package no longer appears in the audit.
- CI actions are pinned to full commit SHAs and repository policy rejects mutable action references.

## Residual risks

- Filesystem authorization is subject to time-of-check/time-of-use races if another process can replace a checked path before the operation. Use OS permissions or container isolation where hostile concurrent mutation is possible.
- DNS validation and the subsequent platform fetch resolution are separate operations. A hostile DNS service could attempt rebinding between them. Network egress policy remains the authoritative control for high-risk deployments.
- CORS is a browser control, not authentication. Binding beyond loopback without an authenticating reverse proxy exposes privileged APIs.
- Shell commands can perform anything permitted to the harness OS account and can explicitly read files containing secrets. Removing ambient credential variables reduces accidental disclosure but does not make shell execution safe for untrusted instructions.
- Active workers and their abort controllers are process-local and are not recovered after a server restart. Mailbox durability does not provide crash-safe execution recovery.

## Dependency response

Use the repository-pinned package manager and commit `package-lock.json`. Run `corepack npm run security:audit` after dependency changes and in CI. Prefer a patched compatible release or narrow override with a green build/test suite. If no verified fix exists, add the smallest time-bounded exception and document compensating controls; do not lower the audit threshold or add an unbounded allowlist.
