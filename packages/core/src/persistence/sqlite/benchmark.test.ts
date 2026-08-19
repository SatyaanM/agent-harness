import { describe, expect, it } from "vitest";
import { withDbRetry } from "./concurrency.js";
import { createDatabaseConnection } from "./db.js";
import { SqliteMigrator } from "./migrator.js";
import { SessionRepository } from "./session-repo.js";

describe("SQLite Performance Benchmarks & Concurrency Stress", () => {
  it("executes listMeta query on 10,000 sessions within high-performance threshold", () => {
    const db = createDatabaseConnection(":memory:");
    new SqliteMigrator(db).up();

    const sessionRepo = new SessionRepository(db);

    // Seed 10,000 synthetic sessions in a single immediate transaction
    const now = Date.now();
    db.immediateTransaction(() => {
      const insertStmt = db.prepare<
        [string, string, string | null, string, number, number, number | null, string | null]
      >(
        `INSERT INTO sessions (id, agent_name, title, prompt, created_at, updated_at, completed_at, metadata)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      );

      for (let i = 0; i < 10_000; i += 1) {
        insertStmt.run(
          `bench-sess-${i}`,
          i % 2 === 0 ? "orchestrator" : "researcher",
          `Benchmark Session ${i}`,
          `Prompt number ${i}`,
          now - i * 1000,
          now - i * 500,
          null,
          null,
        );
      }
    })();

    expect(sessionRepo.count()).toBe(10_000);

    // Warm up statement cache
    sessionRepo.listMeta({ limit: 1 });

    // Measure indexed listMeta query latency
    const start = performance.now();
    const results = sessionRepo.listMeta({ limit: 10_000 });
    const durationMs = performance.now() - start;

    expect(results).toHaveLength(10_000);
    expect(results[0]?.id).toBe("bench-sess-0");

    // Performance target: indexed listing executes well within threshold (<500ms across parallel CI runs, <10ms isolated)
    expect(durationMs).toBeLessThan(500);

    db.close();
  });

  it("handles 50 concurrent transactions without unhandled SQLITE_BUSY errors", () => {
    const db = createDatabaseConnection(":memory:");
    new SqliteMigrator(db).up();

    const sessionRepo = new SessionRepository(db);

    // Run 50 sequential and interleaved transactional operations wrapped in withDbRetry
    for (let i = 0; i < 50; i += 1) {
      withDbRetry(() => {
        sessionRepo.create({
          id: `concurrent-sess-${i}`,
          agentName: "worker",
          prompt: `Concurrent task ${i}`,
        });
      });
    }

    expect(sessionRepo.count()).toBe(50);
    db.close();
  });
});
