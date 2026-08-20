import { describe, expect, it } from "vitest";
import { createDatabaseConnection } from "./db.js";
import {
  ChecksumMismatchError,
  computeSqlChecksum,
  type MigrationFile,
  SqliteMigrator,
} from "./migrator.js";

describe("SqliteMigrator", () => {
  it("applies baseline initial schema migration up cleanly", () => {
    const db = createDatabaseConnection(":memory:");
    const migrator = new SqliteMigrator(db);

    const pending = migrator.getPendingMigrations();
    expect(pending).toHaveLength(2);
    expect(pending[0]?.version).toBe(1);
    expect(pending[1]?.version).toBe(2);

    const result = migrator.up();
    expect(result.appliedCount).toBe(2);
    expect(result.versions).toEqual([1, 2]);

    const applied = migrator.getAppliedMigrations();
    expect(applied).toHaveLength(2);
    expect(applied[0]?.version).toBe(1);
    expect(applied[0]?.name).toBe("001_initial_schema");
    expect(applied[1]?.version).toBe(2);
    expect(applied[1]?.name).toBe("002_audit_events");

    // Verify tables exist
    const tables = db
      .prepare<[], { name: string }>(
        "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name ASC;",
      )
      .all();
    const tableNames = tables.map((t) => t.name);

    expect(tableNames).toContain("schema_migrations");
    expect(tableNames).toContain("sessions");
    expect(tableNames).toContain("runs");
    expect(tableNames).toContain("messages");
    expect(tableNames).toContain("tasks");
    expect(tableNames).toContain("mailbox_events");
    expect(tableNames).toContain("open_sessions");
    expect(tableNames).toContain("audit_events");

    // Re-running up is a no-op
    const reUp = migrator.up();
    expect(reUp.appliedCount).toBe(0);

    db.close();
  });

  it("performs clean reversible down migration (up -> down -> up)", () => {
    const db = createDatabaseConnection(":memory:");
    const migrator = new SqliteMigrator(db);

    // 1. Up
    migrator.up();
    expect(migrator.getAppliedMigrations()).toHaveLength(2);

    // 2. Down
    const downRes = migrator.down(0);
    expect(downRes.rolledBackCount).toBe(2);
    expect(downRes.versions).toEqual([2, 1]);

    // Check tables dropped
    const tablesAfterDown = db
      .prepare<[], { name: string }>(
        "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name ASC;",
      )
      .all();
    expect(tablesAfterDown).toHaveLength(0);

    // 3. Up again
    const reUpRes = migrator.up();
    expect(reUpRes.appliedCount).toBe(2);
    expect(migrator.getAppliedMigrations()).toHaveLength(2);

    db.close();
  });

  it("detects SHA-256 checksum mismatch for modified migrations", () => {
    const db = createDatabaseConnection(":memory:");
    const originalMigration: MigrationFile = {
      version: 1,
      name: "001_initial_schema",
      upSql: "CREATE TABLE dummy (id TEXT PRIMARY KEY);",
      downSql: "DROP TABLE dummy;",
    };

    const migrator1 = new SqliteMigrator(db, [originalMigration]);
    migrator1.up();

    // Now instantiate migrator with tampered migration SQL
    const tamperedMigration: MigrationFile = {
      version: 1,
      name: "001_initial_schema",
      upSql: "CREATE TABLE dummy (id TEXT PRIMARY KEY, tampered TEXT);",
      downSql: "DROP TABLE dummy;",
    };

    const migrator2 = new SqliteMigrator(db, [tamperedMigration]);
    expect(() => migrator2.up()).toThrow(ChecksumMismatchError);

    db.close();
  });

  it("computes consistent deterministic checksums", () => {
    const sql1 = "CREATE TABLE test (id TEXT PRIMARY KEY);";
    const sql2 = "  CREATE TABLE test (id TEXT PRIMARY KEY);  \n";
    expect(computeSqlChecksum(sql1)).toBe(computeSqlChecksum(sql2));
  });

  it("propagates SQL execution errors during down migration", () => {
    const db = createDatabaseConnection(":memory:");
    const badDownMigration: MigrationFile = {
      version: 1,
      name: "001_bad_down",
      upSql: "CREATE TABLE bad_down (id TEXT PRIMARY KEY);",
      downSql: "INVALID SYNTAX STATEMENT;",
    };

    const migrator = new SqliteMigrator(db, [badDownMigration]);
    migrator.up();

    expect(() => migrator.down(0)).toThrow();

    db.close();
  });
});
