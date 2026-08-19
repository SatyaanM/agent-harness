# Changelog

All notable changes to `@agent-harness/core` will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.1.0] - 2026-08-18

### Added
- Core in-memory `Agent.run` execution loop with token budgeting, step limits, and cancellation signal propagation.
- `SessionRuntime` providing serialized delivery queues, replay deduplication, and mailbox completion materialization.
- `SessionStore` file-I/O persistence for transcripts, append-only JSONL mailbox logs, and derived `.index.json` projections.
- Background worker task delegation (`createDelegateTool`, `Worker.run`).
- Framework-neutral `ToolRegistry` with file operations, shell commands, web search/scraping, and knowledge inbox management.
- Provider integration layer supporting OpenAI and Anthropic compatible models via AI SDK.
- Shared structured logging (`contracts/logging.ts`), error normalization (`contracts/errors.ts`), TTS utilities, and capability discovery.
