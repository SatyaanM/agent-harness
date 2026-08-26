---
name: playwright-esm-dual-load
description: Diagnose and fix Playwright ESM loader failures (exports-not-defined, missing named exports) caused by dual module loading, star re-export barrels, or prefix-matching aliases.
---

# Playwright ESM Dual-Module-Loading Failures

## Overview

Playwright's test runner resolves modules through a different pipeline than
Node's native ESM loader. When a spec file statically imports named exports
from a workspace package, Playwright runs that import through a CJS-interop
transform (cjs-module-lexer) to statically detect the exported names. If the
same package — or anything in its dependency graph — is also loaded via a
dynamic `import()` elsewhere in the same worker (e.g., from a test fixture),
the two loading paths produce distinct module identities and fail at link
time.

This skill documents the three failure signatures we hit in this repo, their
root causes, and the fixes applied so they don't regress.

## Failure Signatures

### 1. "does not provide an export named X"

```
SyntaxError: The requested module '@agent-harness/core/contracts'
  does not provide an export named 'parseBoundary'
```

**Root cause:** The package entry point uses `export * from "./x.js"` barrel
re-exports. Node's cjs-module-lexer cannot statically detect names re-exported
through star barrels, so when it tries to enumerate exports for CJS interop it
finds nothing and rejects every named import.

**Fix:** Replace `export *` with explicit named re-exports listing every
symbol:

```ts
// packages/core/src/contracts/index.ts
export { BoundaryValidationError, isRecord, parseBoundary } from "./validation.js";
export { AgentConfigSchema, AgentResultSchema } from "./agent.js";
// ... etc for every public symbol
export type { AgentConfig, Message, TaskId } from "./agent.js";
```

### 2. "exports is not defined in ES module scope"

```
ReferenceError: exports is not defined in ES module scope
This file is being treated as an ES module because it has a '.js' file
extension and 'packages/core/package.json' contains "type": "module".
```

**Root cause:** Dual module loading. A spec statically imports named exports
from a workspace package (triggering Playwright's CJS-interop transform), and
a fixture in the same worker dynamically imports something that transitively
loads the same package via true ESM. The two identities clash: the ESM load
finds the CJS-shaped module record already registered and chokes on its
`exports` binding.

**Fix:** In test helpers loaded at runtime by fixtures, avoid static or
dynamic ESM imports of workspace packages entirely. Load them through
`createRequire` instead, targeting the compiled output:

```ts
import { createRequire } from "node:module";

const require_ = createRequire(import.meta.url);

type AppModule = typeof import("../../packages/server/dist/app.js");

function requireTyped<T extends object>(spec: string): T {
  const typed: T = require_(spec);
  if (typeof typed !== "object" || typed === null) {
    throw new Error(`Expected module object from ${spec}`);
  }
  return typed;
}

const { createApp } = requireTyped<AppModule>("../../packages/server/dist/app.js");
```

This keeps a single CommonJS module identity for the entire server graph,
regardless of what the spec files do.

> Note: `createRequire` requires compiled `.js` output, not raw `.ts`. The CI
> job must build workspace packages **before** running Playwright suites that
> depend on these helpers.

### 3. "Cannot find module '.../src/index.ts/contracts'"

```
Error: Cannot find package '@agent-harness/core/contracts' imported from
  packages/server/src/server-config.ts
Error: ENOTDIR: not a directory, open 'packages/core/src/index.ts/contracts'
```

**Root cause:** Vitest/Vite resolve aliases using prefix matching on string
keys. An alias `"@agent-harness/core"` also matches the longer specifier
`"@agent-harness/core/contracts"`, replacing only the prefix portion and
producing the malformed path `src/index.ts/contracts`.

**Fix:** Use array-form aliases with the most specific specifier first:

```ts
resolve: {
  alias: [
    {
      find: "@agent-harness/core/contracts",
      replacement: path.resolve(currentDirectory, "../core/src/contracts/index.ts"),
    },
    {
      find: "@agent-harness/core",
      replacement: path.resolve(currentDirectory, "../core/src/index.ts"),
    },
  ],
},
```

Array entries are matched exactly (or by regex), in order, without prefix
bleed. String-keyed alias objects are still fine for aliases with no subpath
variants.

## Verification

After applying fixes, confirm all three failure modes are gone:

1. Run the affected Playwright suite locally against a clean build:
   ```bash
   pnpm --filter @agent-harness/core run build
   pnpm --filter @agent-harness/server run build
   pnpm run test:fullstack
   ```
2. Run the vitest suites that share aliases with the Playwright config to
   confirm no regression:
   ```bash
   pnpm run test
   ```
3. Grep for any remaining `export *` in package entry points
   (`packages/*/src/*/index.ts`) and convert them to explicit named re-exports.

## CI Implication

If test helpers now load compiled output (`dist/*.js`) rather than raw source,
CI jobs running those tests must build workspace packages first. Add explicit
build steps before Playwright/test steps in the workflow, or reorder the check
orchestrator so builds precede test execution.
