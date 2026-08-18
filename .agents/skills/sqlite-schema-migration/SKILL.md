---
name: sqlite-schema-migration
description: Author and verify versioned up and down SQLite schema migrations, schema snapshot tests, and rollback integrity. Use when altering persisted relational tables, columns, indexes, or constraints.
---

# SQLite Schema Migration

## Pre-flight
1. Confirm the required schema change against existing tables and ADRs in `docs/decisions/`.
2. Ensure migration scripts reside under the persistence migrations directory.

## Authoring Migrations
1. Create a versioned SQL file with sequential numbering: `NNNN_description.sql` containing the `UP` statements.
2. If down migrations are supported, include explicit, reversible `DOWN` statements.
3. Ensure all table and column names use consistent snake_case naming and explicit data types (`TEXT`, `INTEGER`, `BLOB`, `REAL`).
4. Define explicit `FOREIGN KEY` constraints and appropriate indexes for foreign key and query lookup paths.

## Verification
1. Add a migration test that applies migrations to an in-memory SQLite instance (`:memory:`).
2. Verify bidirectional schema migration (up -> down -> up) produces expected tables and indexes.
3. Update schema snapshot tests to record the new baseline schema definition.
4. Run package tests to ensure no query or serialization regressions.
