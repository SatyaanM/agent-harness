import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createDatabaseConnection, SqliteMigrator } from "@agent-harness/core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

describe("Windows NTFS File Locking & WAL Cleanliness", () => {
  let tmpDir: string;
  let dbPath: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "harness-lock-"));
    dbPath = path.join(tmpDir, "harness.db");
  });

  afterEach(() => {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {}
  });

  it("releases all SQLite file locks immediately upon driver close without EBUSY", async () => {
    const db = createDatabaseConnection(dbPath);
    const migrator = new SqliteMigrator(db);
    migrator.up();

    // Perform intensive WAL transactions
    for (let i = 0; i < 50; i++) {
      db.transaction(() => {
        db.prepare(
          "INSERT INTO sessions (id, agent_name, prompt, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
        ).run(`session-lock-test-${i}`, "orchestrator", `Prompt ${i}`, Date.now(), Date.now());
      })();
    }

    // Verify database is readable
    const countRow = db
      .prepare<[], { count: number }>("SELECT COUNT(*) as count FROM sessions")
      .get();
    expect(countRow?.count).toBe(50);

    // Close the database driver
    db.close();

    // On Windows NTFS, if file handles are leaked, unlinking or renaming throws EBUSY or EPERM.
    // Assert that we can rename and delete the files immediately without error:
    const renamedPath = path.join(tmpDir, "harness-renamed.db");
    expect(() => {
      fs.renameSync(dbPath, renamedPath);
      fs.unlinkSync(renamedPath);
    }).not.toThrow();
  });
});
