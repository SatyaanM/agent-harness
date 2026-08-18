---
summary: Phased implementation plan for Knip, Lefthook git automation, Biome expansions, pnpm migration, and Playwright E2E tests.
read_when:
  - Executing implementation tasks for DX and tooling upgrades.
  - Reviewing the rollout sequence for developer experience improvements.
---

# Developer Experience (DX) and Tooling Implementation Plan

Status: Completed

## Inputs

- Governing Specification: `specs/dx-tooling-modernization/SPEC.md`
- Governing ADR: `docs/decisions/0002-boundary-validation-and-quality-gates.md`
- Current Codebase: `lefthook.yml`, `biome.jsonc`, `package.json`, `scripts/run-checks.mjs`

## Sequence

### Phase 1: Repository Agent Skills Expansion
- **Objective**: Add `sqlite-schema-migration`, `benchmark-runner`, and `architecture-linter` skills to `.agents/skills/`.
- **Files/Symbols**:
  - [NEW] `.agents/skills/sqlite-schema-migration/SKILL.md`
  - [NEW] `.agents/skills/benchmark-runner/SKILL.md`
  - [NEW] `.agents/skills/architecture-linter/SKILL.md`
- **Behavior**: Validates with `scripts/validate-skills.mjs`.
- **Verification**: `node scripts/validate-skills.mjs`.

### Phase 2: Knip Monorepo Configuration & AST Policy Check
- **Objective**: Install and configure Knip to detect dead code and unreferenced exports, respecting package entry points and public contracts.
- **Files/Symbols**:
  - [NEW] `knip.jsonc`
  - [MODIFY] `package.json` (add `knip` script)
  - [MODIFY] `scripts/check-quality-policy.mjs` (disallow wildcard ignores in `knip.jsonc`)
  - [MODIFY] `scripts/run-checks.mjs` (integrate Knip in check suites)
- **Behavior**: Runs Knip across packages, validates clean contract surfaces.
- **Verification**: `npm run knip`.

### Phase 3: Fast Lefthook Git Automation & Biome Enhancements
- **Objective**: Expand Lefthook git hooks with a consolidated staged runner (< 350ms budget) and Conventional Commits; tighten Biome rules pragmatically.
- **Files/Symbols**:
  - [NEW] `scripts/run-staged-gates.mjs`
  - [MODIFY] `lefthook.yml`
  - [NEW] `commitlint.config.mjs`
  - [MODIFY] `biome.jsonc`
- **Behavior**: Pre-commit hooks run Biome staged and in-process staged checks in parallel; commit-msg verifies semantic commit format; Biome enforces import hygiene and complexity threshold 25 (warn).
- **Verification**: Test commit message validation; run `npm run quality`.

### Phase 4: Playwright End-to-End Test Suite
- **Objective**: Set up Playwright for deterministic mock-first browser testing and a live Express server smoke test.
- **Files/Symbols**:
  - [NEW] `packages/dashboard/playwright.config.ts`
  - [NEW] `packages/dashboard/e2e/chat-stream.spec.ts`
  - [NEW] `packages/dashboard/e2e/inbox-renderers.spec.ts`
  - [NEW] `packages/dashboard/e2e/live-smoke.spec.ts`
  - [MODIFY] `package.json` (add `test:e2e` scripts)
- **Behavior**: Runs headless Chromium tests for chat SSE streams and inbox previews.
- **Verification**: `npm run test:e2e`.

### Phase 5: Package Manager Migration to `pnpm 11+` with Catalogs
- **Objective**: Transition root and workspace package management to pnpm 11 with centralized dependency Catalogs.
- **Files/Symbols**:
  - [NEW] `pnpm-workspace.yaml`
  - [NEW] `.npmrc`
  - [MODIFY] `package.json` (`packageManager: "pnpm@11.22.0"`, `catalog:` references, `onlyBuiltDependencies`)
  - [MODIFY] `packages/core/package.json`
  - [MODIFY] `packages/server/package.json`
  - [MODIFY] `packages/dashboard/package.json`
  - [MODIFY] `scripts/run-checks.mjs`
  - [DELETE] `package-lock.json`
  - [NEW] `pnpm-lock.yaml`
- **Behavior**: Centralizes dependency versions, eliminates duplicate disk storage, validates strict dependency boundaries.
- **Verification**: `corepack pnpm run check`.

## Risks and compatibility

- **CI Runner Setup**: Ensure GitHub Actions workflows install pnpm and Playwright browser binaries with caching.
- **Cross-platform**: Ensure Lefthook git hooks and `run-staged-gates.mjs` execute identically on Windows PowerShell, macOS, and Linux bash.

## Completion evidence

- `corepack pnpm run knip` returns 0 issues.
- `corepack pnpm run test:e2e` passes all browser journeys.
- `node scripts/run-staged-gates.mjs` executes in < 150ms.
- Full `corepack pnpm run check` passes completely.
