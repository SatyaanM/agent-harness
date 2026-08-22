---
summary: Index and lifecycle rules for development-layer architecture decision records.
read_when:
  - Looking for an adopted development-process or repository-tooling decision.
  - Proposing, accepting, superseding, or retiring an ADR.
---

# Architecture decision records

Use zero-padded sequential filenames. Status values are Proposed, Accepted, Superseded, or Rejected. Never rewrite the rationale of an accepted decision to hide history; add a new ADR and link supersession.

## Index

- [0001 - Separate development-agent tooling from product runtime capabilities](0001-development-agent-layer.md) - Accepted
- [0002 - Parse once at trust boundaries and enforce quality in layers](0002-boundary-validation-and-quality-gates.md) - Accepted
- [0003 - Standardize runtime correlation, structured logging, and error envelopes](0003-structured-logging-correlation-error-envelope.md) - Accepted
- [0004 - Adopt embedded SQLite with WAL mode for ACID persistence and delivery](0004-acid-storage-and-relational-persistence.md) - Accepted
- [0005 - Tamper-evident audit ledger and OpenTelemetry observability](0005-tamper-evident-audit-and-opentelemetry-observability.md) - Accepted
