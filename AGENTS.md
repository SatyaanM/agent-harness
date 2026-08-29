# Repository Rules & Guidance for AI Agents

This document contains operational guidance for autonomous agents and AI assistants working in this repository.

## PR Creation & Markdown Formatting
1. **Never pass raw markdown with backticks via inline CLI strings (`gh pr create -b "..."`)**: Shell interpreters (especially Windows PowerShell) mangle backticks into escape sequences or raw backslashes.
2. **Always write PR descriptions to a file and supply `--body-file`**:
   ```bash
   gh pr create --title "..." --body-file ".pr_body.md"
   ```
3. **Follow Conventional Commits**: `feat(scope): ...`, `fix(scope): ...`, `security(scope): ...`, `docs(scope): ...`.

## Quality & Verification Gates
Before proposing or pushing changes:
1. Run all tests: `npm test` (or `pnpm test`)
2. Run typechecks: `npm run typecheck` (or `pnpm run typecheck`)
3. Ensure no trailing whitespace or CRLF formatting corruption.
