import crypto from "node:crypto";

export const GENESIS_PREV_HASH = "0000000000000000000000000000000000000000000000000000000000000000";

export interface AuditHashInput {
  readonly prevHash: string;
  readonly timestamp: number;
  readonly actorType: string;
  readonly actorId: string;
  readonly action: string;
  readonly resourceType: string;
  readonly resourceId: string;
  readonly canonicalPayload: string;
}

export function computeAuditEventHash(event: AuditHashInput): string {
  const preimage = [
    event.prevHash,
    event.timestamp.toString(),
    event.actorType,
    event.actorId,
    event.action,
    event.resourceType,
    event.resourceId,
    event.canonicalPayload,
  ].join("|");

  return crypto.createHash("sha256").update(preimage, "utf8").digest("hex");
}
