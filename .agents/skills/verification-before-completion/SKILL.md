---
name: verification-before-completion
description: Gather fresh, proportionate evidence before claiming repository work complete, committing it, or handing it off. Use after implementation or documentation edits and before any success statement. Do not use as a substitute for designing tests or debugging a known failure.
---

# Verification Before Completion

## Verify the actual change

1. Re-read the request, acceptance criteria, applicable instructions, and final diff.
2. Run the narrowest checks that exercise changed behavior, then the required package or root checks.
3. Use `corepack pnpm` so the repository package-manager pin is honored.
4. Run `git diff --check` and inspect `git status` for generated, temporary, secret, or unrelated files.

Do not claim a check passed from an earlier run if relevant files changed afterward. Report cached results as cached. A build exit code does not replace behavior-specific evidence.

## Handle failures honestly

If a check fails, determine whether the change caused it. Fix in-scope failures, record reproducible unrelated failures without masking them, and re-run affected checks after corrections. Keep ignored build output and generated type files out of the diff; do not force-add them.

## Report evidence

State the exact commands, outcomes, changed files, unresolved risks, and skipped checks with reasons. Claim completion only when acceptance criteria are met and no required work remains.
