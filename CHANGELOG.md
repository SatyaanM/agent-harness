# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- Wire-compatible deterministic Fake LLM provider server (`test/fake-provider/`) supporting OpenAI (`/v1/chat/completions`) and Anthropic (`/v1/messages`) protocols with streaming SSE, scenario controls, and fault injection.
- Ephemeral full-stack testbed harness (`test/helpers/test-stack.ts`) managing isolated SQLite WAL instances, Express server, Next.js dashboard, and Fake LLM across non-colliding ports.
- Full-stack Playwright E2E test suite (`packages/dashboard/e2e/fullstack/`) testing session lifecycle, tab management, cascade deletion, monotonic sequence ordering, and worker subagent delegation.
- Chaos crash injection and recovery suite (`test/chaos/`) testing abrupt process termination (`SIGKILL`), startup orphan task reconciliation to `abandoned`, and Windows NTFS file locking cleanliness.
- Security CI workflows (`.github/workflows/codeql.yml` for CodeQL SAST, `.github/workflows/zap-scan.yml` for OWASP ZAP baseline) and adversarial red-team test suite (`test/security/security-redteam.test.ts`).
- High-concurrency load and contention benchmark suite (`test/load/`) validating `MAX_CONCURRENT_AGENTS` queue limits and SQLite `withDbRetry` under burst traffic.
- Repository development skills for coding agents: `fullstack-e2e`, `browser-qa-triage`, `provider-contract`, and `security-redteam`.

## [0.1.0] - 2026-08-18

### Added
- Initial baseline release of Agent Harness multi-agent orchestration platform.
- Multi-agent orchestration harness enabling delegating agents to dispatch background tasks to specialized worker agents.
- Persistent split-panel web dashboard connecting interactive chat sessions with an integrated knowledge inbox.
- Knowledge inbox filesystem integration for depositing reports, diagrams, data files, and structured artifacts.
- File-based agent configuration using Markdown files with YAML frontmatter in `agents/`.
- Real-time event streaming and state synchronization over WebSocket connections.
- Framework-neutral core library (`@agent-harness/core`), Express host server (`@agent-harness/server`), and Next.js frontend (`@agent-harness/dashboard`).
