import crypto from "node:crypto";
import { isRecord } from "../validation.js";
import { canonicalJsonStringify } from "./canonical-json.js";

export const MAX_AUDIT_PAYLOAD_BYTES = 65_536;

const SENSITIVE_KEY_REGEX =
  /password|secret|token|api_key|authorization|bearer|private_key|credential/i;

const SENSITIVE_VALUE_PATTERNS = [
  /sk-[a-zA-Z0-9_-]{20,}/g, // OpenAI/Anthropic keys
  /AIza[0-9A-Za-z-_]{35}/g, // Google API keys
  /ghp_[0-9a-zA-Z]{36}/g, // GitHub PATs
  /Bearer\s+[a-zA-Z0-9._~+/-]+=*/gi, // Bearer headers
  /-----BEGIN [A-Z ]+PRIVATE KEY-----[\s\S]+?-----END [A-Z ]+PRIVATE KEY-----/g,
];

export function redactSecretsRecursive(val: unknown): unknown {
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

  if (Array.isArray(val)) {
    return val.map((item) => redactSecretsRecursive(item));
  }

  if (!isRecord(val)) {
    return val;
  }

  const result: Record<string, unknown> = {};
  for (const [key, propVal] of Object.entries(val)) {
    if (SENSITIVE_KEY_REGEX.test(key)) {
      result[key] = "[REDACTED]";
    } else {
      result[key] = redactSecretsRecursive(propVal);
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
