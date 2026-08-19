import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  createDatabaseConnection,
  ExecutionLimiter,
  SqliteMigrator,
  withDbRetry,
} from "@agent-harness/core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

describe("Load & Concurrency Benchmarks", () => {
  let tmpDir: string;
  let dbPath: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "harness-load-"));
    dbPath = path.join(tmpDir, "harness.db");
  });

  afterEach(() => {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {}
  });

  it("enforces max concurrency limit under 30 concurrent task bursts", async () => {
    const maxConcurrent = 5;
    const limiter = new ExecutionLimiter(maxConcurrent);
    let peakConcurrency = 0;
    let currentlyRunning = 0;

    const runTask = async (id: number): Promise<number> => {
      return limiter.run(async () => {
        currentlyRunning += 1;
        if (currentlyRunning > peakConcurrency) {
          peakConcurrency = currentlyRunning;
        }

        // Simulate async model work
        await new Promise((resolve) => setTimeout(resolve, 15));

        currentlyRunning -= 1;
        return id * 2;
      });
    };

    const tasks = Array.from({ length: 30 }, (_, i) => runTask(i));
    const results = await Promise.all(tasks);

    expect(results.length).toBe(30);
    expect(peakConcurrency).toBeLessThanOrEqual(maxConcurrent);
  });

  it("handles high SQLite contention across 50 concurrent transactions with withDbRetry", async () => {
    const initDb = createDatabaseConnection(dbPath);
    const migrator = new SqliteMigrator(initDb);
    migrator.up();
    initDb.close();

    const insertSessionConcurrent = async (index: number): Promise<void> => {
      const conn = createDatabaseConnection(dbPath);
      try {
        withDbRetry(() => {
          conn.immediateTransaction(() => {
            conn
              .prepare(
                "INSERT INTO sessions (id, agent_name, prompt, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
              )
              .run(
                `session-stress-${index}`,
                "orchestrator",
                `Stress prompt ${index}`,
                Date.now(),
                Date.now(),
              );
          })();
        });
      } finally {
        conn.close();
      }
    };

    // Execute 50 concurrent insertions across distinct database connections
    const tasks = Array.from({ length: 50 }, (_, i) => insertSessionConcurrent(i));
    await Promise.all(tasks);

    const verifyDb = createDatabaseConnection(dbPath);
    const row = verifyDb
      .prepare<[], { total: number }>("SELECT COUNT(*) as total FROM sessions")
      .get();
    expect(row?.total).toBe(50);
    verifyDb.close();
  });
});
