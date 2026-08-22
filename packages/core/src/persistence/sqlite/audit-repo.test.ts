import { describe, expect, it } from "vitest";
import { z } from "zod";
import { computeAuditEventHash, GENESIS_PREV_HASH } from "../../crypto/audit-hash.js";
import { canonicalJsonStringify } from "../../crypto/canonical-json.js";
import { parseJsonBoundary } from "../../validation.js";
import { AuditRepository } from "./audit-repo.js";

import { SqliteDatabaseDriver } from "./db.js";
import { SqliteMigrator } from "./migrator.js";

describe("AuditRepository & Cryptographic Hash Chaining", () => {
  it("initializes migration 002 and chains hashes sequentially from genesis", () => {
    const driver = new SqliteDatabaseDriver(":memory:");
    const migrator = new SqliteMigrator(driver);
    migrator.up();

    const repo = new AuditRepository(driver);

    // 1. Genesis entry
    const first = repo.append({
      actorType: "user",
      actorId: "user_1",
      action: "session.create",
      resourceType: "session",
      resourceId: "ses_1",
      payload: { prompt: "Analyze the codebase", agentName: "orchestrator" },
    });

    expect(first.seq_id).toBe(1);
    expect(first.prev_hash).toBe(GENESIS_PREV_HASH);
    expect(first.current_hash.length).toBe(64);

    // 2. Second entry (linked)
    const second = repo.append({
      actorType: "agent",
      actorId: "orchestrator",
      action: "tool.exec.shell",
      resourceType: "system",
      resourceId: "git status",
      payload: { command: "git status", exitCode: 0, durationMs: 45 },
    });

    expect(second.seq_id).toBe(2);
    expect(second.prev_hash).toBe(first.current_hash);
    expect(second.current_hash.length).toBe(64);

    // 3. Third entry (linked)
    const third = repo.append({
      actorType: "user",
      actorId: "user_1",
      action: "session.rename",
      resourceType: "session",
      resourceId: "ses_1",
      payload: { oldTitle: null, newTitle: "Git Investigation" },
    });

    expect(third.seq_id).toBe(3);
    expect(third.prev_hash).toBe(second.current_hash);

    // Query tests
    expect(repo.getLatest()?.seq_id).toBe(3);
    expect(repo.get(1)?.action).toBe("session.create");
    expect(repo.get(2)?.action).toBe("tool.exec.shell");

    const listed = repo.list({ limit: 10 });
    expect(listed.total).toBe(3);
    expect(listed.events.length).toBe(3);

    const filtered = repo.list({ action: "tool.exec.shell" });
    expect(filtered.total).toBe(1);
    expect(filtered.events[0]?.actor_id).toBe("orchestrator");

    driver.close();
  });

  it("redacts sensitive keys and API keys from audit payload", () => {
    const driver = new SqliteDatabaseDriver(":memory:");
    const migrator = new SqliteMigrator(driver);
    migrator.up();

    const repo = new AuditRepository(driver);

    const event = repo.append({
      actorType: "agent",
      actorId: "orchestrator",
      action: "tool.exec.shell",
      resourceType: "system",
      resourceId: "curl",
      payload: {
        command: "curl -H 'Authorization: Bearer secret-token-12345' https://api.example.com",
        api_key: ["sk-", "123456789012345678901234567890"].join(""),
        nested: {
          token: ["ghp_", "123456789012345678901234567890123456"].join(""),
          safe: "public_value",
        },
      },
    });

    const parsed = parseJsonBoundary(
      z.object({
        command: z.string(),
        api_key: z.string(),
        nested: z.object({
          token: z.string(),
          safe: z.string(),
        }),
      }),
      event.payload,
      "audit test payload",
    );
    expect(parsed.api_key).toBe("[REDACTED]");
    expect(parsed.nested.token).toBe("[REDACTED]");
    expect(parsed.nested.safe).toBe("public_value");
    expect(parsed.command).toContain("[REDACTED]");

    driver.close();
  });

  it("bounds oversized payloads (>64KB) with SHA-256 digest reference", () => {
    const driver = new SqliteDatabaseDriver(":memory:");
    const migrator = new SqliteMigrator(driver);
    migrator.up();

    const repo = new AuditRepository(driver);

    const largeData = "x".repeat(80_000);
    const event = repo.append({
      actorType: "agent",
      actorId: "orchestrator",
      action: "tool.exec.file_write",
      resourceType: "file",
      resourceId: "large.txt",
      payload: { content: largeData },
    });

    const parsed = parseJsonBoundary(
      z
        .object({
          _truncated: z.boolean(),
          originalByteLength: z.number(),
          originalSha256: z.string(),
        })
        .passthrough(),
      event.payload,
      "audit test truncated payload",
    );
    expect(parsed._truncated).toBe(true);
    expect(parsed.originalByteLength).toBeGreaterThan(65_536);
    expect(parsed.originalSha256).toBeDefined();

    driver.close();
  });

  it("produces deterministic canonical JSON with sorted keys", () => {
    const objA = { b: 2, a: 1, c: { y: 20, x: 10 } };
    const objB = { a: 1, c: { x: 10, y: 20 }, b: 2 };

    const strA = canonicalJsonStringify(objA);
    const strB = canonicalJsonStringify(objB);

    expect(strA).toBe(strB);
    expect(strA).toBe('{"a":1,"b":2,"c":{"x":10,"y":20}}');
  });

  it("prevents delimiter injection collisions when fields contain pipe characters", () => {
    const hash1 = computeAuditEventHash({
      prevHash: GENESIS_PREV_HASH,
      timestamp: 1000,
      actorType: "user",
      actorId: "user|session.delete",
      action: "test",
      resourceType: "session",
      resourceId: "s1",
      canonicalPayload: "{}",
    });

    const hash2 = computeAuditEventHash({
      prevHash: GENESIS_PREV_HASH,
      timestamp: 1000,
      actorType: "user",
      actorId: "user",
      action: "session.delete|test",
      resourceType: "session",
      resourceId: "s1",
      canonicalPayload: "{}",
    });

    expect(hash1).not.toBe(hash2);
  });
});
