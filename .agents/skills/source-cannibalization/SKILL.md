---
name: source-cannibalization
description: Research and deliberately adapt a small concept from external code, prompts, skills, documentation, or agent projects. Use before copying or translating third-party material, comparing upstream patterns, or importing an architectural idea. Do not use for ordinary dependency usage governed by its public API.
---

# Source Cannibalization

## Establish provenance first

1. Prefer primary upstream repositories and official documentation over catalogs or summaries.
2. Record the canonical URL, exact revision or release, access date, and license. Do not guess missing license terms.
3. Distinguish discovery catalogs from endorsed sources and copied text from independently implemented ideas.

## Minimize the adaptation

1. State the local problem before reading broadly.
2. Extract the smallest useful concept, compare it with current Agent Harness behavior and invariants, and document non-adoptions.
3. Reimplement from the concept when practical. Preserve required notices and attribution for copied or adapted material.
4. Avoid importing frameworks, prompt suites, or abstractions wholesale when a small local pattern suffices.

## Record and verify

Update `THIRD_PARTY_NOTICES.md` with provenance, license uncertainty, the adopted concept, local destination, and modifications. Verify the adapted behavior with repository tests and ensure documentation does not imply endorsement or upstream compatibility. Research-only sources that did not inform repository content do not need a durable catalog entry.
