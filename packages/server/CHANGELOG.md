# Changelog

All notable changes to `@agent-harness/server` will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.1.0] - 2026-08-18

### Added
- Express HTTP server exposing REST APIs for `/api/chat`, `/api/sessions`, `/api/plugins`, `/api/health`, and `/api/metrics`.
- Socket.IO gateway broadcasting real-time agent lifecycle, worker execution, and session state updates.
- In-process `SessionManager` coordinating loaded runtimes, background worker controllers, and tool registries.
- Filesystem-driven `PluginRegistry` supporting manifest discovery and runtime toggle for renderers and commands.
- Server-owned open-sessions store (`.harness/open-sessions.json`) and atomic browser tab state management.
- Lifecycle `HookBus` with veto-capable before-middleware and after-observers for session lifecycle operations.
