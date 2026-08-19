import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  createDatabaseConnection,
  walCheckpoint,
  withImmediateTransaction,
  withTransaction,
} from "./db.js";

describe("SqliteDatabaseDriver & Connection Factory", () => {
  const tempDirs: string[] = [];

  const createTempDbPath = () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "harness-db-test-"));
    tempDirs.push(dir);
    return path.join(dir, "test.db");
  };

  afterEach(() => {
    for (const dir of tempDirs) {
      try {
        fs.rmSync(dir, { recursive: true, force: true });
      } catch {
        // cleanup best effort
      }
    }
    tempDirs.length = 0;
  });

  it("initializes an in-memory database with required pragmas", () => {
    const db = createDatabaseConnection(":memory:");
    expect(db.isOpen).toBe(true);

    const fkResult = db.prepare<[], { foreign_keys: number }>("PRAGMA foreign_keys;").get();
    expect(fkResult?.foreign_keys).toBe(1);

    const busyResult = db.prepare<[], { timeout: number }>("PRAGMA busy_timeout;").get();
    expect(busyResult?.timeout).toBe(5000);

    db.close();
    expect(db.isOpen).toBe(false);
  });

  it("initializes a disk database with WAL mode and directory creation", () => {
    const dbPath = createTempDbPath();
    const db = createDatabaseConnection(dbPath);

    expect(fs.existsSync(dbPath)).toBe(true);
    expect(db.isOpen).toBe(true);

    const journalResult = db.prepare<[], { journal_mode: string }>("PRAGMA journal_mode;").get();
    expect(journalResult?.journal_mode?.toLowerCase()).toBe("wal");

    const fkResult = db.prepare<[], { foreign_keys: number }>("PRAGMA foreign_keys;").get();
    expect(fkResult?.foreign_keys).toBe(1);

    walCheckpoint(db, "PASSIVE");
    db.close();
  });

  it("executes basic DDL and prepared statements with parameter binding", () => {
    const db = createDatabaseConnection(":memory:");

    db.exec("CREATE TABLE test_items (id TEXT PRIMARY KEY, value INTEGER NOT NULL);");

    const insertStmt = db.prepare<[string, number]>(
      "INSERT INTO test_items (id, value) VALUES (?, ?);",
    );
    const res1 = insertStmt.run("item-1", 42);
    expect(res1.changes).toBe(1);

    const selectStmt = db.prepare<[string], { id: string; value: number }>(
      "SELECT id, value FROM test_items WHERE id = ?;",
    );
    const item = selectStmt.get("item-1");
    expect(item).toEqual({ id: "item-1", value: 42 });

    const selectAllStmt = db.prepare<[], { id: string; value: number }>(
      "SELECT id, value FROM test_items;",
    );
    const items = selectAllStmt.all();
    expect(items).toHaveLength(1);

    db.close();
  });

  it("handles rollback on transaction failure", () => {
    const db = createDatabaseConnection(":memory:");
    db.exec("CREATE TABLE test_tx (id TEXT PRIMARY KEY, val TEXT);");

    expect(() => {
      withTransaction(db, () => {
        db.prepare<[string, string]>("INSERT INTO test_tx (id, val) VALUES (?, ?);").run(
          "t1",
          "first",
        );
        throw new Error("Simulated failure");
      });
    }).toThrow("Simulated failure");

    const count = db.prepare<[], { count: number }>("SELECT COUNT(*) as count FROM test_tx;").get();
    expect(count?.count).toBe(0);

    db.close();
  });

  it("executes immediate transactions atomically", () => {
    const db = createDatabaseConnection(":memory:");
    db.exec("CREATE TABLE test_imm (id TEXT PRIMARY KEY, val TEXT);");

    const res = withImmediateTransaction(db, () => {
      db.prepare<[string, string]>("INSERT INTO test_imm (id, val) VALUES (?, ?);").run(
        "i1",
        "imm",
      );
      return "success";
    });

    expect(res).toBe("success");
    const row = db
      .prepare<[string], { id: string; val: string }>("SELECT id, val FROM test_imm WHERE id = ?;")
      .get("i1");
    expect(row?.val).toBe("imm");

    db.close();
  });

  it("prevents executing queries on a closed database", () => {
    const db = createDatabaseConnection(":memory:");
    db.close();

    expect(() => db.exec("SELECT 1;")).toThrow(/closed/);
    expect(() => db.prepare("SELECT 1;")).toThrow(/closed/);
  });
});
