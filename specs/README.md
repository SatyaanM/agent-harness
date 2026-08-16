---
summary: Location, lifecycle, and naming conventions for active Agent Harness specifications and implementation plans.
read_when:
  - Starting, locating, or closing planned repository work.
  - Deciding how to organize a multi-session change under specs.
---

# Specifications and plans

Create one kebab-case directory per substantial initiative. Keep its spec, plan, tasks, and handoffs together; link any governing ADRs rather than duplicating decisions.

Use the templates in `docs/templates/`. Record status and owners only when they are meaningful. Keep current behavior, desired behavior, and open questions distinct. Plans should remain updateable evidence, not a diary.

When work completes, move lasting decisions or current-state facts into the appropriate `docs/` location, then remove the completed initiative directory. Git history preserves execution detail without keeping stale plans in the active documentation index. Do not store product runtime skills here; `.agents/skills/` contains repository-development workflows.
