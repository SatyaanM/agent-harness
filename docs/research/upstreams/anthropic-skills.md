---
summary: Assess Anthropic's skills repository while preserving its per-directory license boundaries.
read_when:
  - Evaluating example skills or document-processing capabilities.
---

# Anthropic skills

- Source: https://github.com/anthropics/skills
- Revision: `f17010c9bb483898c1d9c9f42dde2b3a98889434` (`HEAD` observed 2026-08-10)
- License: mixed. Many skills are Apache-2.0; document-related `docx`, `pdfs`, `pptx`, and `spreadsheets` directories use separate source-available terms. The license at the exact path is authoritative.

## Assessment

- Useful concepts: self-contained capability packages, domain-focused references, and scripts that keep deterministic work outside the prompt.
- Smallest immediate adoption: none beyond the standard-compatible local layout already in place; review individual examples only when a matching need exists.
- Deferred: document-processing capabilities until the product or contributor workflow requires them and their terms are reviewed.
- Not adopted: any skill body, asset, or restricted document-processing implementation.
- Agent Harness mapping: useful later as interoperability research for runtime skills, not as a bundled skill library.
