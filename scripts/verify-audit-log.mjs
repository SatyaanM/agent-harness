#!/usr/bin/env node
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

export const GENESIS_PREV_HASH = "0000000000000000000000000000000000000000000000000000000000000000";

export function computeAuditEventHash(event) {
  const fields = [
    event.prevHash,
    event.timestamp.toString(),
    event.actorType,
    event.actorId,
    event.action,
    event.resourceType,
    event.resourceId,
    event.canonicalPayload,
  ];

  const preimage = fields.map((field) => `${field.length}:${field}`).join("|");

  return crypto.createHash("sha256").update(preimage, "utf8").digest("hex");
}

export function verifyAuditLedger(dbPathOrInstance, options = {}) {
  const chunkSize = options.chunkSize ?? 500;
  const db =
    typeof dbPathOrInstance === "string"
      ? new DatabaseSync(dbPathOrInstance, { readOnly: true })
      : dbPathOrInstance;

  try {
    const tableCheck = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='audit_events'")
      .get();
    if (!tableCheck) {
      return {
        valid: true,
        totalEvents: 0,
        message: "No audit_events table found (empty ledger).",
      };
    }

    let lastSeqId = 0;
    let expectedPrevHash = GENESIS_PREV_HASH;
    let totalVerified = 0;

    const stmt = db.prepare(
      "SELECT seq_id, prev_hash, current_hash, timestamp, actor_type, actor_id, action, resource_type, resource_id, payload, signature FROM audit_events WHERE seq_id > ? ORDER BY seq_id ASC LIMIT ?",
    );

    while (true) {
      const rows = stmt.all(lastSeqId, chunkSize);
      if (rows.length === 0) break;

      for (const row of rows) {
        if (row.seq_id !== lastSeqId + 1) {
          return {
            valid: false,
            totalEvents: totalVerified,
            failedSeqId: row.seq_id,
            error: `Sequence gap detected: expected ${lastSeqId + 1}, got ${row.seq_id}`,
          };
        }

        if (row.prev_hash !== expectedPrevHash) {
          return {
            valid: false,
            totalEvents: totalVerified,
            failedSeqId: row.seq_id,
            error: `Hash chain break at seq ${row.seq_id}: expected prev_hash ${expectedPrevHash}, got ${row.prev_hash}`,
          };
        }

        const calculatedHash = computeAuditEventHash({
          prevHash: row.prev_hash,
          timestamp: row.timestamp,
          actorType: row.actor_type,
          actorId: row.actor_id,
          action: row.action,
          resourceType: row.resource_type,
          resourceId: row.resource_id,
          canonicalPayload: row.payload,
        });

        if (calculatedHash !== row.current_hash) {
          return {
            valid: false,
            totalEvents: totalVerified,
            failedSeqId: row.seq_id,
            error: `Payload tampering at seq ${row.seq_id}: calculated hash ${calculatedHash}, stored ${row.current_hash}`,
          };
        }

        expectedPrevHash = row.current_hash;
        lastSeqId = row.seq_id;
        totalVerified += 1;
      }
    }

    return {
      valid: true,
      totalEvents: totalVerified,
      message: `Audit ledger verified successfully: ${totalVerified} events validated.`,
    };
  } finally {
    if (typeof dbPathOrInstance === "string") {
      db.close();
    }
  }
}

// CLI Execution
if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename ?? "")) {
  const dbArgIndex = process.argv.indexOf("--db");
  const dbPath =
    dbArgIndex !== -1 && process.argv[dbArgIndex + 1]
      ? process.argv[dbArgIndex + 1]
      : path.join(process.cwd(), "sessions", ".harness", "harness.db");

  if (!fs.existsSync(dbPath)) {
    console.log(`Audit database not found at ${dbPath}; assuming pristine environment.`);
    process.exit(0);
  }

  const startTime = Date.now();
  const result = verifyAuditLedger(dbPath);
  const duration = Date.now() - startTime;

  if (result.valid) {
    console.log(`[PASS] ${result.message} (${duration}ms)`);
    process.exit(0);
  } else {
    console.error(`[FAIL] Verification failed: ${result.error}`);
    process.exit(1);
  }
}
