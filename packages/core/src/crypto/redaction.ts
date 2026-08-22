import crypto from "node:crypto";
import { isRecord } from "../validation.js";
import { canonicalJsonStringify } from "./canonical-json.js";

export const MAX_AUDIT_PAYLOAD_BYTES = 65_536;

const SENSITIVE_KEY_REGEX =
  /password|secret|token|api[-_]?key|authorization|bearer|private[-_]?key|credential/i;

const SENSITIVE_VALUE_PATTERNS = [
  /sk-[a-zA-Z0-9_-]{20,}/g, // OpenAI/Anthropic keys
  /AIza[0-9A-Za-z-_]{35}/g, // Google API keys
  /ghp_[0-9a-zA-Z]{36}/g, // GitHub classic PATs
  /github_pat_[0-9a-zA-Z_]{22,}/g, // GitHub fine-grained PATs
  /gh[osru]_[0-9a-zA-Z]{36}/g, // GitHub OAuth/app/refresh tokens
  /AKIA[0-9A-Z]{16}/g, // AWS Access Key IDs
  /xox[baprs]-[0-9a-zA-Z-]{10,80}/g, // Slack tokens
  /eyJ[a-zA-Z0-9_-]{10,}\.[a-zA-Z0-9_-]{10,}\.[a-zA-Z0-9_-]{10,}/g, // Standalone JWTs
  /Bearer\s+[a-zA-Z0-9._~+/-]+=*/gi, // Bearer headers
  /-----BEGIN (?:[A-Z0-9_-]+ )?PRIVATE KEY-----(?:(?!-----BEGIN)[\s\S])+?-----END (?:[A-Z0-9_-]+ )?PRIVATE KEY-----/g,
];

export function redactSecretsRecursive(val: unknown, seen = new WeakSet<object>()): unknown {
  if (val === null || typeof val !== "object") {
    if (typeof val === "string") {
      let redacted = val;
      for (const pattern of SENSITIVE_VALUE_PATTERNS) {
        redacted = redacted.replace(pattern, "[REDACTED]");
      }
      return redacted;
    }
    return val;
  }

  if (seen.has(val)) {
    return "[CIRCULAR]";
  }
  seen.add(val);

  if (Array.isArray(val)) {
    return val.map((item) => redactSecretsRecursive(item, seen));
  }

  if (!isRecord(val)) {
    return val;
  }

  const result: Record<string, unknown> = {};
  for (const [key, propVal] of Object.entries(val)) {
    if (SENSITIVE_KEY_REGEX.test(key)) {
      result[key] = "[REDACTED]";
    } else {
      result[key] = redactSecretsRecursive(propVal, seen);
    }
  }
  return result;
}

export function sanitizeAndBoundPayload(payload: Record<string, unknown>): string {
  const sanitized = redactSecretsRecursive(payload);
  const serialized = canonicalJsonStringify(sanitized);
  const byteLength = Buffer.byteLength(serialized, "utf8");

  if (byteLength <= MAX_AUDIT_PAYLOAD_BYTES) {
    return serialized;
  }

  const payloadHash = crypto.createHash("sha256").update(serialized, "utf8").digest("hex");
  const overflowNotice = {
    _truncated: true,
    originalByteLength: byteLength,
    originalSha256: payloadHash,
    preview: serialized.slice(0, 1024),
  };
  return canonicalJsonStringify(overflowNotice);
}
