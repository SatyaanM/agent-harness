# Repository baseline (T00)

This file records the evidence gathered for pre-development bootstrap task T00. The baseline was observed on 2026-08-10 in `E:\Projects\agent-harness`. No product/runtime behavior, dependency versions, branches, commits, or tracked source files were intentionally changed.

## Environment

Commands were run from PowerShell on Windows unless noted otherwise.

| Fact | Observed value |
| --- | --- |
| Timestamp | `2026-08-10T21:48:22-04:00` |
| Time zone | `SA Western Standard Time` (`UTC-04:00`) |
| OS | `Microsoft Windows NT 10.0.26200.0` |
| OS/process architecture | `X64` / `X64` |
| Working directory | `E:\Projects\agent-harness` |
| Git | `git version 2.55.0.windows.3` |
| Node.js | `v24.19.0` |
| npm command shim used | `npm.cmd`, version `11.17.0` |
| Declared package manager | `npm@10.9.2` from root `package.json` |
| Lockfile | `package-lock.json`, lockfile version `3`, root package `agent-harness@0.1.0` |

Exact environment commands:

```powershell
Get-Date -Format "yyyy-MM-ddTHH:mm:ssK"
Get-TimeZone | Select-Object Id,DisplayName
[System.Environment]::OSVersion.VersionString
[System.Runtime.InteropServices.RuntimeInformation]::OSArchitecture
[System.Runtime.InteropServices.RuntimeInformation]::ProcessArchitecture
git --version
node --version
npm.cmd --version
node -e "const l=require('./package-lock.json'); console.log('name='+l.name); console.log('version='+l.version); console.log('lockfileVersion='+l.lockfileVersion); console.log('requires='+l.requires)"
```

PowerShell's direct `npm` resolution is not usable under the current execution policy. For example, `npm --version` failed before npm started with:

```text
npm : File C:\Program Files\nodejs\npm.ps1 cannot be loaded because running scripts is disabled on this system.
FullyQualifiedErrorId : UnauthorizedAccess
```

The standard Windows `npm.cmd` shim works, so all npm evidence below uses it. The installed npm (`11.17.0`) is newer than the repository's declared `npm@10.9.2`; this task did not change or reconcile that mismatch. Node.js 24 satisfies the README's documented Node.js 18.18+ minimum and 20.x-or-newer recommendation.

## Git and remotes

The initial read-only inspection used:

```powershell
git status --short --branch
git status --porcelain=v1 -uall
git branch --show-current
git rev-parse HEAD
git remote -v
git remote
```

Initial facts:

- Active branch: `main`, tracking `origin/main`.
- HEAD: `8b6066858ac63641202d33ae71094b105d54ca19` (`Merge pull request #1 from damain/feat/testing`).
- `origin`: `https://github.com/SatyaanM/agent-harness` for fetch and push. This is the user's `SatyaanM` fork, not the `damain/agent-harness` source repository.
- No `upstream` remote was configured.
- The worktree was dirty only because `.codex/` and `specs/` were untracked; there were no tracked modifications in the initial status.

Initial concise status:

```text
## main...origin/main
?? .codex/
?? specs/
```

The expanded initial untracked set was:

```text
?? .codex/agents/worker.toml
?? .codex/config.toml
?? specs/pre-development-bootstrap/README.md
?? specs/pre-development-bootstrap/T00-baseline.md
?? specs/pre-development-bootstrap/T01-instruction-hierarchy.md
?? specs/pre-development-bootstrap/T02-documentation-index.md
?? specs/pre-development-bootstrap/T03-development-skills.md
?? specs/pre-development-bootstrap/T04-skill-validation.md
?? specs/pre-development-bootstrap/T05-codex-specialists.md
?? specs/pre-development-bootstrap/T06-planning-artifacts.md
?? specs/pre-development-bootstrap/T07-provenance-research.md
?? specs/pre-development-bootstrap/T08-verification-hooks.md
?? specs/pre-development-bootstrap/T09-architecture-backlog.md
?? specs/pre-development-bootstrap/T10-dogfood-review.md
```

After confirming the remote was absent, T00 added and fetched the specified upstream:

```powershell
git remote add upstream https://github.com/damain/agent-harness
git fetch --all
```

Both commands exited `0`. Fetch output confirmed `origin` and `upstream` were fetched and created local remote-tracking refs for `upstream/feat/testing` and `upstream/main`.

Post-fetch remote configuration:

```text
origin   https://github.com/SatyaanM/agent-harness (fetch)
origin   https://github.com/SatyaanM/agent-harness (push)
upstream https://github.com/damain/agent-harness (fetch)
upstream https://github.com/damain/agent-harness (push)
```

At observation time, `HEAD`, `origin/main`, and `upstream/main` all resolved to `8b6066858ac63641202d33ae71094b105d54ca19`. Both `git rev-list --left-right --count HEAD...origin/main` and `git rev-list --left-right --count HEAD...upstream/main` returned `0 0`.

No branch was created because the user explicitly prohibited branch creation without separate authorization. No commit or push was performed.

## Dependency installation state

No dependency installation was run: the existing dependency tree was preserved rather than risking lockfile or `node_modules` changes. The following inspection established its state:

```powershell
Test-Path -LiteralPath node_modules -PathType Container
npm.cmd ls --depth=0
```

Results:

- `node_modules` exists (observed last-write time `2026-08-10 20:45:16` local time).
- `npm.cmd ls --depth=0` exited `0` for `agent-harness@0.1.0` and listed all three linked workspaces (`@agent-harness/core`, `@agent-harness/dashboard`, and `@agent-harness/server`) plus the root development dependencies without missing, invalid, or extraneous dependency errors.

## Required verification

The checks were run without repairing or masking failures.

### Typecheck

```powershell
npm.cmd run typecheck
```

Exit code `0`. Turbo reported `4 successful, 4 total`, `0 cached`, in `9.919s`. The count includes the core build dependency plus typechecks for core, server, and dashboard.

### Tests

```powershell
npm.cmd test
```

Exit code `0`. Turbo reported `4 successful, 4 total`, `1 cached`, in `28.159s`. Vitest results were:

- Core: 1 file passed, 3 tests passed.
- Server: 1 file passed, 1 test passed.
- Dashboard: 2 files passed, 4 tests passed.
- Total: 4 files and 8 tests passed.

### Build

```powershell
npm.cmd run build
```

Exit code `0`. Turbo reported `3 successful, 3 total`, `1 cached`, in `20.474s`. The Next.js 16.2.12 dashboard build compiled successfully, completed TypeScript checking, completed its page-generation step (`6/6`), and listed six routes.

The build emitted this non-fatal warning:

```text
WARNING  no output files found for task @agent-harness/dashboard#build. Please check your `outputs` key in `turbo.json`
```

The Next.js build also rewrote the generated `packages/dashboard/next-env.d.ts` route-types import. That file was clean in the initial status, so the generated one-line residue was restored to its exact HEAD content after the check. Its normalized blob hash and `HEAD` blob hash both equal `c4b7818fbb2c2c34c24feb1b627ee824507c5600`, and there is no final staged or unstaged diff for it.

## Preservation and caveats

Before any T00 mutation, all 14 files under the untracked `.codex/` and `specs/` trees were hashed with SHA-256. The same command was run during final review, and every path and hash matched the initial snapshot:

```powershell
Get-ChildItem -LiteralPath .codex,specs -File -Recurse |
  Sort-Object FullName |
  Get-FileHash -Algorithm SHA256
```

Therefore the pre-existing `.codex/` and `specs/` baseline work was preserved exactly. No tracked or untracked pre-existing file was removed, overwritten, cleaned, reset, stashed, mass-formatted, committed, or pushed.

The configured Sol/Luna workflow could not complete its delegated inspection path because this Codex runtime rejected the configured `gpt-5.6-luna` worker model before a worker task started (`Unknown model gpt-5.6-luna`). No worker result or worker edit existed to accept. The primary Sol agent therefore performed the bounded inspection and final evidence review locally.

At T00 completion, the open caveats were the PowerShell `npm.ps1` execution-policy block, the active npm/declaration version mismatch, the non-fatal Turbo dashboard-output warning, and the unavailable configured Luna worker model. None caused a required check to fail. The repository-resolvable items were addressed in the follow-up below.

## Caveat-resolution follow-up (2026-08-10)

### Codex tooling is separate from harness providers

The project-scoped `.codex/config.toml` and `.codex/agents/worker.toml` configure the Codex development client only. They are not read by the Agent Harness runtime and do not add GPT-5.6, OpenAI API, or Codex provider support to the product.

Per project direction, first-class and independently configurable Codex/OpenAI, Gemini, and OpenCode provider support is future product work. It was not started in T00 or this follow-up.

Official OpenAI Codex documentation confirms that project agents belong under `.codex/agents/`, that agent files can pin `model` and `model_reasoning_effort`, and that `gpt-5.6-luna` is a supported model identifier for narrow workers. The repository's Sol/Luna configuration is therefore valid as Codex-only configuration: <https://learn.chatgpt.com/docs/agent-configuration/subagents>.

A fresh worker launch attempt still failed before the worker started because this running Codex host exposed only `gpt-5.6-sol` and `gpt-5.6-terra` to its spawn tool and rejected `gpt-5.6-luna`. The local `codex.exe` version check was also denied by the host even with sandbox escalation. No repository or harness change can correct that active host catalog. Restarting or updating the Codex app/runtime and retrying the worker launch remains an external prerequisite before relying on Luna delegation.

### Declared npm version

Corepack 0.35.0 was used to resolve and cache the root `packageManager` declaration without modifying `package.json` or `package-lock.json`:

```powershell
corepack npm --version
```

The command returned `10.9.2`. A process metadata check reported `npm/10.9.2`, Node.js `v24.19.0`, and the Corepack-managed executable path `C:\Users\satyaan\AppData\Local\node\corepack\v1\npm\10.9.2\bin\npm-cli.js`.

The machine-wide `npm.cmd` remains version `11.17.0`, and PowerShell still blocks `npm.ps1`; neither global setting was changed. Repository verification should use `corepack npm ...` so the existing `npm@10.9.2` pin is honored.

### Turbo dashboard outputs

The root `turbo.json` build outputs were changed from `dist/**` alone to:

```json
["dist/**", ".next/**", "!.next/cache/**"]
```

This preserves the TypeScript package outputs, adds the Next.js dashboard output directory, and excludes Next.js's disposable cache. It changes build-cache metadata only, not product/runtime behavior.

Post-resolution verification used the declared npm version:

```powershell
corepack npm run typecheck
corepack npm test
corepack npm run build
```

Results:

- Typecheck exited `0`: `4 successful, 4 total`, `1 cached`, in `8.89s`.
- Tests exited `0`: `4 successful, 4 total`, `2 cached`; all 4 test files and 8 tests passed.
- Build exited `0`: `3 successful, 3 total`, `1 cached`, in `19.483s`.
- The prior `no output files found for task @agent-harness/dashboard#build` warning was absent from the post-resolution build.

The build again rewrote `packages/dashboard/next-env.d.ts`; it was restored to the same HEAD blob recorded above and has no final staged or unstaged diff.

## Handoff

T00 stops here. The next sequential bootstrap task is [`specs/pre-development-bootstrap/T01-instruction-hierarchy.md`](../specs/pre-development-bootstrap/T01-instruction-hierarchy.md).
