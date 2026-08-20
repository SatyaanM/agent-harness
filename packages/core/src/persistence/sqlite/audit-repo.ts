import { computeAuditEventHash, GENESIS_PREV_HASH } from "../../crypto/audit-hash.js";
import { sanitizeAndBoundPayload } from "../../crypto/redaction.js";
import type { ISqliteDatabase } from "./types.js";

export type AuditActorType = "user" | "agent" | "system";

export interface AuditEventRow {
  readonly seq_id: number;
  readonly prev_hash: string;
  readonly current_hash: string;
  readonly timestamp: number;
  readonly actor_type: AuditActorType;
  readonly actor_id: string;
  readonly action: string;
  readonly resource_type: string;
  readonly resource_id: string;
  readonly payload: string;
  readonly signature: string | null;
}

export interface AppendAuditEventInput {
  readonly actorType: AuditActorType;
  readonly actorId: string;
  readonly action: string;
  readonly resourceType: string;
  readonly resourceId: string;
  readonly payload: Record<string, unknown>;
  readonly timestamp?: number | undefined;
  readonly signature?: string | null | undefined;
}

export class AuditRepository {
  constructor(private readonly db: ISqliteDatabase) {}

  append(input: AppendAuditEventInput): AuditEventRow {
    return this.db.immediateTransaction(() => {
      const latestStmt = this.db.prepare<[], { seq_id: number; current_hash: string }>(
        "SELECT seq_id, current_hash FROM audit_events ORDER BY seq_id DESC LIMIT 1",
      );
      const latest = latestStmt.get();

      const nextSeqId = (latest?.seq_id ?? 0) + 1;
      const prevHash = latest?.current_hash ?? GENESIS_PREV_HASH;
      const timestamp = input.timestamp ?? Date.now();
      const canonicalPayload = sanitizeAndBoundPayload(input.payload);

      const currentHash = computeAuditEventHash({
        prevHash,
        timestamp,
        actorType: input.actorType,
        actorId: input.actorId,
        action: input.action,
        resourceType: input.resourceType,
        resourceId: input.resourceId,
        canonicalPayload,
      });

      const insertStmt = this.db.prepare<
        [
          number,
          string,
          string,
          number,
          string,
          string,
          string,
          string,
          string,
          string,
          string | null,
        ]
      >(
        `INSERT INTO audit_events (
          seq_id, prev_hash, current_hash, timestamp, actor_type, actor_id,
          action, resource_type, resource_id, payload, signature
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      );

      insertStmt.run(
        nextSeqId,
        prevHash,
        currentHash,
        timestamp,
        input.actorType,
        input.actorId,
        input.action,
        input.resourceType,
        input.resourceId,
        canonicalPayload,
        input.signature ?? null,
      );

      return {
        seq_id: nextSeqId,
        prev_hash: prevHash,
        current_hash: currentHash,
        timestamp,
        actor_type: input.actorType,
        actor_id: input.actorId,
        action: input.action,
        resource_type: input.resourceType,
        resource_id: input.resourceId,
        payload: canonicalPayload,
        signature: input.signature ?? null,
      };
    })();
  }

  getLatest(): AuditEventRow | undefined {
    const stmt = this.db.prepare<[], AuditEventRow>(
      "SELECT * FROM audit_events ORDER BY seq_id DESC LIMIT 1",
    );
    return stmt.get();
  }

  get(seqId: number): AuditEventRow | undefined {
    const stmt = this.db.prepare<[number], AuditEventRow>(
      "SELECT * FROM audit_events WHERE seq_id = ?",
    );
    return stmt.get(seqId);
  }

  list(options?: {
    limit?: number;
    offset?: number;
    action?: string;
    actorId?: string;
    resourceType?: string;
  }): { events: readonly AuditEventRow[]; total: number } {
    const limit = Math.max(1, Math.min(options?.limit ?? 100, 1000));
    const offset = Math.max(0, options?.offset ?? 0);

    const conditions: string[] = [];
    const params: string[] = [];

    if (options?.action) {
      conditions.push("action = ?");
      params.push(options.action);
    }
    if (options?.actorId) {
      conditions.push("actor_id = ?");
      params.push(options.actorId);
    }
    if (options?.resourceType) {
      conditions.push("resource_type = ?");
      params.push(options.resourceType);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

    const countStmt = this.db.prepare<string[], { count: number }>(
      `SELECT COUNT(*) as count FROM audit_events ${whereClause}`,
    );
    const countResult = countStmt.get(...params);
    const total = countResult?.count ?? 0;

    const listStmt = this.db.prepare<[...string[], number, number], AuditEventRow>(
      `SELECT * FROM audit_events ${whereClause} ORDER BY seq_id DESC LIMIT ? OFFSET ?`,
    );
    const events = listStmt.all(...params, limit, offset);

    return { events, total };
  }
}
