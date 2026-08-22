import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import {
  computeAuditEventHash,
  GENESIS_PREV_HASH,
  verifyAuditLedger,
} from "./verify-audit-log.mjs";

function setupAuditDb(): DatabaseSync {
  const db = new DatabaseSync(":memory:");
  db.exec(`
    CREATE TABLE audit_events (
      seq_id INTEGER PRIMARY KEY AUTOINCREMENT,
      prev_hash TEXT NOT NULL,
      current_hash TEXT NOT NULL,
      timestamp INTEGER NOT NULL,
      actor_type TEXT NOT NULL,
      actor_id TEXT NOT NULL,
      action TEXT NOT NULL,
      resource_type TEXT NOT NULL,
      resource_id TEXT NOT NULL,
      payload TEXT NOT NULL,
      signature TEXT
    );
  `);
  return db;
}

function insertEvent(
  db: DatabaseSync,
  seqId: number,
  prevHash: string,
  event: {
    timestamp: number;
    actorType: string;
    actorId: string;
    action: string;
    resourceType: string;
    resourceId: string;
    canonicalPayload: string;
  },
  tamperedHash?: string,
) {
  const calculatedHash =
    tamperedHash ??
    computeAuditEventHash({
      prevHash,
      timestamp: event.timestamp,
      actorType: event.actorType,
      actorId: event.actorId,
      action: event.action,
      resourceType: event.resourceType,
      resourceId: event.resourceId,
      canonicalPayload: event.canonicalPayload,
    });

  const stmt = db.prepare(`
    INSERT INTO audit_events (seq_id, prev_hash, current_hash, timestamp, actor_type, actor_id, action, resource_type, resource_id, payload)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  stmt.run(
    seqId,
    prevHash,
    calculatedHash,
    event.timestamp,
    event.actorType,
    event.actorId,
    event.action,
    event.resourceType,
    event.resourceId,
    event.canonicalPayload,
  );

  return calculatedHash;
}

describe("verifyAuditLedger", () => {
  it("verifies a valid hash-chained ledger", () => {
    const db = setupAuditDb();

    const hash1 = insertEvent(db, 1, GENESIS_PREV_HASH, {
      timestamp: 1000,
      actorType: "user",
      actorId: "u1",
      action: "session.create",
      resourceType: "session",
      resourceId: "s1",
      canonicalPayload: '{"prompt":"hello"}',
    });

    const hash2 = insertEvent(db, 2, hash1, {
      timestamp: 1050,
      actorType: "agent",
      actorId: "orchestrator",
      action: "tool.execute",
      resourceType: "tool",
      resourceId: "read_file",
      canonicalPayload: '{"path":"file.txt"}',
    });

    insertEvent(db, 3, hash2, {
      timestamp: 1100,
      actorType: "user",
      actorId: "u1",
      action: "session.delete",
      resourceType: "session",
      resourceId: "s1",
      canonicalPayload: "{}",
    });

    const result = verifyAuditLedger(db);
    expect(result.valid).toBe(true);
    expect(result.totalEvents).toBe(3);

    db.close();
  });

  it("detects payload tampering", () => {
    const db = setupAuditDb();

    const hash1 = insertEvent(db, 1, GENESIS_PREV_HASH, {
      timestamp: 1000,
      actorType: "user",
      actorId: "u1",
      action: "session.create",
      resourceType: "session",
      resourceId: "s1",
      canonicalPayload: '{"prompt":"hello"}',
    });

    insertEvent(db, 2, hash1, {
      timestamp: 1050,
      actorType: "agent",
      actorId: "orchestrator",
      action: "tool.execute",
      resourceType: "tool",
      resourceId: "read_file",
      canonicalPayload: '{"path":"file.txt"}',
    });

    // Tamper row 2 payload directly in DB
    db.prepare("UPDATE audit_events SET payload = ? WHERE seq_id = 2").run(
      '{"path":"tampered.txt"}',
    );

    const result = verifyAuditLedger(db);
    expect(result.valid).toBe(false);
    expect(result.failedSeqId).toBe(2);
    expect(result.error).toContain("Payload tampering");

    db.close();
  });

  it("detects sequence gap from deleted events", () => {
    const db = setupAuditDb();

    const hash1 = insertEvent(db, 1, GENESIS_PREV_HASH, {
      timestamp: 1000,
      actorType: "user",
      actorId: "u1",
      action: "session.create",
      resourceType: "session",
      resourceId: "s1",
      canonicalPayload: '{"prompt":"hello"}',
    });

    const hash2 = insertEvent(db, 2, hash1, {
      timestamp: 1050,
      actorType: "agent",
      actorId: "orchestrator",
      action: "tool.execute",
      resourceType: "tool",
      resourceId: "read_file",
      canonicalPayload: '{"path":"file.txt"}',
    });

    insertEvent(db, 3, hash2, {
      timestamp: 1100,
      actorType: "user",
      actorId: "u1",
      action: "session.delete",
      resourceType: "session",
      resourceId: "s1",
      canonicalPayload: "{}",
    });

    // Delete row 2
    db.prepare("DELETE FROM audit_events WHERE seq_id = 2").run();

    const result = verifyAuditLedger(db);
    expect(result.valid).toBe(false);
    expect(result.failedSeqId).toBe(3);
    expect(result.error).toContain("Sequence gap");

    db.close();
  });

  it("detects broken hash chain from inserted untracked entry", () => {
    const db = setupAuditDb();

    insertEvent(db, 1, "bad_hash_000000000000000000000000000000000000000000000000000000000000", {
      timestamp: 1000,
      actorType: "user",
      actorId: "u1",
      action: "session.create",
      resourceType: "session",
      resourceId: "s1",
      canonicalPayload: '{"prompt":"hello"}',
    });

    const result = verifyAuditLedger(db);
    expect(result.valid).toBe(false);
    expect(result.failedSeqId).toBe(1);
    expect(result.error).toContain("Hash chain break");

    db.close();
  });

  it("prevents delimiter injection collisions when fields contain pipe characters", () => {
    const hash1 = computeAuditEventHash({
      prevHash: GENESIS_PREV_HASH,
      timestamp: 1000,
      actorType: "user",
      actorId: "u1|session.delete",
      action: "test",
      resourceType: "session",
      resourceId: "s1",
      canonicalPayload: "{}",
    });

    const hash2 = computeAuditEventHash({
      prevHash: GENESIS_PREV_HASH,
      timestamp: 1000,
      actorType: "user",
      actorId: "u1",
      action: "session.delete|test",
      resourceType: "session",
      resourceId: "s1",
      canonicalPayload: "{}",
    });

    expect(hash1).not.toBe(hash2);
  });
});
