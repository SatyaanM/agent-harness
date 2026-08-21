import { describe, expect, it } from "vitest";
import { isRecord } from "../validation.js";
import {
  MAX_AUDIT_PAYLOAD_BYTES,
  redactSecretsRecursive,
  sanitizeAndBoundPayload,
} from "./redaction.js";

describe("redaction", () => {
  describe("redactSecretsRecursive", () => {
    it("redacts API keys and tokens in string values", () => {
      const openAi = ["sk-", "ant-api03-abcdefghijklmnopqrstuvwxyz123456"].join(""); // mock test-key
      const google = ["AIza", "SyD-1234567890abcdefghijklmnopqrs12"].join(""); // mock test-key
      const github = ["ghp_", "0123456789abcdefghijklmnopqrstuvwxyz"].join(""); // mock test-token
      const bearer = ["Bearer ", "ya29.a0AfH6SM-token_val123=="].join(""); // mock test-token

      expect(redactSecretsRecursive(openAi)).toBe("[REDACTED]");
      expect(redactSecretsRecursive(google)).toBe("[REDACTED]");
      expect(redactSecretsRecursive(github)).toBe("[REDACTED]");
      expect(redactSecretsRecursive(bearer)).toBe("[REDACTED]");
    });

    it("redacts PEM private keys of various formats", () => {
      const rsaKey = [
        "-----BEGIN ",
        "RSA PRIVATE KEY-----",
        "\nMIIEowIBAAKCAQEA0+abc...",
        "\n-----END RSA PRIVATE KEY-----",
      ].join(""); // mock test-key

      const pkcs8Key = [
        "-----BEGIN ",
        "PRIVATE KEY-----",
        "\nMIIEvgIBADANBgkqhkiG9w0BAQEFAASCBKgwggSkAgEAAoIBAQC7V3",
        "\n-----END PRIVATE KEY-----",
      ].join(""); // mock test-key

      const ecKey = [
        "-----BEGIN ",
        "EC PRIVATE KEY-----",
        "\nMHcCAQEEI...",
        "\n-----END EC PRIVATE KEY-----",
      ].join(""); // mock test-key

      const opensshKey = [
        "-----BEGIN ",
        "OPENSSH PRIVATE KEY-----",
        "\nb3BlbnNzaC1rZXktdjEAAAA...",
        "\n-----END OPENSSH PRIVATE KEY-----",
      ].join(""); // mock test-key

      const encryptedKey = [
        "-----BEGIN ",
        "RSA PRIVATE KEY-----",
        "\nProc-Type: 4,ENCRYPTED\nDEK-Info: AES-128-CBC,F18A34237B19C0E2\n\nMIIEowIBAAKCAQEA...",
        "\n-----END RSA PRIVATE KEY-----",
      ].join(""); // mock test-key

      expect(redactSecretsRecursive(rsaKey)).toBe("[REDACTED]");
      expect(redactSecretsRecursive(pkcs8Key)).toBe("[REDACTED]");
      expect(redactSecretsRecursive(ecKey)).toBe("[REDACTED]");
      expect(redactSecretsRecursive(opensshKey)).toBe("[REDACTED]");
      expect(redactSecretsRecursive(encryptedKey)).toBe("[REDACTED]");
    });

    it("handles repeated PEM patterns linearly without ReDoS", () => {
      const start = Date.now();
      const malicious = ["-----BEGIN ", "PRIVATE KEY----- "].join("").repeat(5_000); // mock test-key
      const result = redactSecretsRecursive(malicious);
      const elapsedMs = Date.now() - start;

      expect(result).toBe(malicious);
      expect(elapsedMs).toBeLessThan(1_000);
    });

    it("redacts sensitive object keys recursively", () => {
      const input = {
        password: "super-secret-password", // mock
        secret_token: "my-token", // mock
        nested: {
          apiKey: "my-api-key", // mock
          regularField: "regular value",
          authorization: "Basic 12345", // mock
        },
        list: [{ token: "token-in-list" }, { safe: "hello" }], // mock
      };

      const redacted = redactSecretsRecursive(input);
      expect(isRecord(redacted)).toBe(true);
      if (!isRecord(redacted)) throw new Error("Expected object");

      expect(redacted.password).toBe("[REDACTED]");
      expect(redacted.secret_token).toBe("[REDACTED]");

      const nested = redacted.nested;
      expect(isRecord(nested)).toBe(true);
      if (!isRecord(nested)) throw new Error("Expected nested object");

      expect(nested.apiKey).toBe("[REDACTED]");
      expect(nested.regularField).toBe("regular value");
      expect(nested.authorization).toBe("[REDACTED]");

      const list = redacted.list;
      expect(Array.isArray(list)).toBe(true);
      if (!Array.isArray(list)) throw new Error("Expected array");

      const [first, second] = list;
      expect(isRecord(first) && first.token).toBe("[REDACTED]");
      expect(isRecord(second) && second.safe).toBe("hello");
    });

    it("preserves non-sensitive primitives", () => {
      expect(redactSecretsRecursive(123)).toBe(123);
      expect(redactSecretsRecursive(true)).toBe(true);
      expect(redactSecretsRecursive(null)).toBe(null);
      expect(redactSecretsRecursive(undefined)).toBe(undefined);
    });
  });

  describe("sanitizeAndBoundPayload", () => {
    it("sanitizes and serializes normal sized payload", () => {
      const payload = { user: "test", key: ["sk-", "12345678901234567890"].join("") }; // mock test-key
      const serialized = sanitizeAndBoundPayload(payload);
      expect(serialized).toBe('{"key":"[REDACTED]","user":"test"}');
    });

    it("truncates payloads that exceed MAX_AUDIT_PAYLOAD_BYTES with cryptographic hash", () => {
      const largeData = "x".repeat(MAX_AUDIT_PAYLOAD_BYTES + 100);
      const payload = { big: largeData };
      const serialized = sanitizeAndBoundPayload(payload);
      const parsed = JSON.parse(serialized);

      expect(parsed._truncated).toBe(true);
      expect(parsed.originalByteLength).toBeGreaterThan(MAX_AUDIT_PAYLOAD_BYTES);
      expect(typeof parsed.originalSha256).toBe("string");
      expect(parsed.originalSha256).toHaveLength(64);
      expect(typeof parsed.preview).toBe("string");
    });
  });
});
