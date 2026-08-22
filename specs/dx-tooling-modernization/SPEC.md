---
summary: Specification for Developer Experience modernization including Knip dead-code pruning, Lefthook git automation, Biome expansions, pnpm catalog migration, and Playwright E2E testing.
read_when:
  - Improving developer experience, package management, CI workflows, git hooks, or testing tooling.
  - Evaluating Knip, Lefthook, pnpm, or Playwright integrations.
---

# Developer Experience (DX) and Tooling Modernization Specification

Status: Implemented

## Problem and evidence

1. **Unused Exports and Dead Code Accumulation**: As the monorepo evolves rapidly, unused exports, dead files, and unreferenced packages can linger unnoticed without automated detection.
2. **Git Hook Execution Overhead & Verification Boundaries**: Running individual Node processes in pre-commit hooks blows past execution budgets on Windows. Hook orchestration requires sub-350ms staged validation, Conventional Commits verification, and pre-push full checks.
3. **Package Manager Disk Overhead & Version Drift**: Standard npm duplicates `node_modules` across git worktrees and lacks centralized dependency catalogs for shared monorepo versions.
4. **End-to-End Browser Testing Gap**: Vitest unit/component tests do not exercise full end-to-end browser flows (Next.js client SSE streaming, tab switching, and inbox file preview renderers).

## Goals and non-goals

### Goals
- Integrate **Knip** for monorepo-wide dead code, unused export, unlisted dependency, and orphaned asset detection, respecting package entry points and public contracts.
- Expand **Lefthook** git hooks: sub-350ms consolidated staged checks, conventional commit message linting (`commitlint`), and pre-push verification.
- Expand **Biome** rules for code hygiene, unused imports/variables, and performance, with pragmatic warnings on complexity (threshold 25) and targeted UI overrides.
- Migrate to **pnpm 9+ with Catalogs** for centralized versions, isolated dependency trees, and hard-link deduplication across worktrees.
- Integrate **Playwright** for deterministic, mock-first browser testing of critical dashboard journeys, plus a live server smoke test.
- Create new development agent skills in `.agents/skills/` for SQLite migrations, benchmarking, and AST policy enforcement.

### Non-goals
- Weakening strict compiler options or AST quality gates.
- Allowing wildcard ignores in Knip.
- Slowing down pre-commit with heavy AST or full-repo builds.

## Required behavior

### 1. Knip Configuration (`knip.jsonc`)
Monorepo workspace configuration detecting:
- Unused exported symbols in `@agent-harness/core`, `@agent-harness/server`, `@agent-harness/dashboard`.
- Unused dependencies in `package.json` files.
- Unlisted dependencies in production files.
- Package entry points configured: `packages/core/src/{index,contracts/index}.ts`, Next.js plugin for dashboard App Router, and Vitest plugin for test fixtures.
- AST quality policy verifies no wildcard ignores are introduced in `knip.jsonc`.

### 2. Lefthook Git Hooks Orchestration (`lefthook.yml`)
```yaml
min_version: 2.1.10

pre-commit:
  parallel: true
  commands:
    biome-staged:
      glob: "*.{js,ts,tsx,json,jsonc,css}"
      run: npx @biomejs/biome check --write --staged --no-errors-on-unmatched {staged_files}
      stage_fixed: true
    staged-gates:
      run: node scripts/run-staged-gates.mjs

commit-msg:
  commands:
    conventional-commits:
      run: npx --no-install commitlint --edit {1}

pre-push:
  commands:
    full-check:
      run: corepack pnpm run check:fast
```

### 3. Biome Linter & Formatter Enhancements (`biome.jsonc`)
Enable pragmatic rule groups:
- `correctness`: `noUnusedVariables` (error), `noUnusedImports` (error).
- `security`: `noGlobalEval` (error), `noDangerouslySetInnerHtml` (error with targeted renderer overrides).
- `performance`: `noAccumulatingSpread` (error), `noDelete` (warn).
- `complexity`: `noExcessiveCognitiveComplexity` (warn, threshold 25), `noUselessFragments` (error).

### 4. Package Manager Migration Strategy (`pnpm 11+` with Catalogs)
- Pinned `pnpm@11.22.0` in `packageManager`.
- Use `pnpm-workspace.yaml` with centralized dependency catalog (`catalog:`) and `onlyBuiltDependencies` allowlists.
- Strict non-hoisted symlinked virtual store (`node_modules/.pnpm`).
- `.npmrc` configured with `public-hoist-pattern` for bundler and typing dependencies, non-interactive purge confirmation, and supply chain release policies.
- Translated root overrides and peer dependency rules.

### 5. Playwright E2E Testing Suite
- Test suite located in `packages/dashboard/e2e/`.
- Test scenarios:
  1. `chat-stream.spec.ts`: Mock-first SSE stream chunks rendering and session lifecycle.
  2. `inbox-renderers.spec.ts`: File preview renderers (Markdown, CSV, Image, Excalidraw readiness).
  3. `live-smoke.spec.ts`: Live Express server handshake on ephemeral port.
- PR CI runs headless Chromium (< 30s); nightly runs Chromium, Firefox, WebKit.

### 6. Development Agent Skills Expansion (`.agents/skills/`)
- `.agents/skills/sqlite-schema-migration/`: Automates creation of up/down SQLite migration files with schema snapshot tests.
- `.agents/skills/benchmark-runner/`: Runs automated latency, throughput, and memory profiling against harness server.
- `.agents/skills/architecture-linter/`: Validates package boundaries and verifies core zero-dependency invariant.

## Acceptance criteria

1. `corepack pnpm run knip` executes in CI/pre-push and returns 0 unused files or dependencies.
2. Staged commits trigger parallel pre-commit checks in `< 350ms`.
3. Commit messages violating Conventional Commits format are rejected with descriptive syntax guidance.
4. Playwright test suite executes headlessly in CI.
5. All `.agents/skills/` validate cleanly with `node scripts/validate-skills.mjs`.
