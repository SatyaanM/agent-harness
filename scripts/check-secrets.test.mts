import { describe, expect, it } from "vitest";
import { scanContent } from "./check-secrets.mjs";

describe("scanContent", () => {
  it("passes clean source code", () => {
    const cleanCode = `
      import { useState } from "react";
      export function Component() {
        const [state, setState] = useState(0);
        return <div>{state}</div>;
      }
    `;
    expect(scanContent("src/Component.tsx", cleanCode)).toEqual([]);
  });

  it("passes safe mock keys and placeholder tokens", () => {
    const mockCode = `
      const OPENAI_API_KEY = "your-openai-key";
      const TEST_TOKEN = "test-token";
      const DUMMY_KEY = "dummy-key";
      const EXAMPLE = "example";
    `;
    expect(scanContent("src/config.test.ts", mockCode)).toEqual([]);
  });

  it.each([
    ["OpenAI key", 'const key = "sk-proj-abcdef12345678901234567890";', "openai-api-key"],
    ["Anthropic key", 'const key = "sk-ant-abcdef12345678901234567890";', "anthropic-api-key"],
    ["Google API key", 'const key = "AIzaSyDa1234567890123456789012345678901";', "google-api-key"],
    ["GitHub Token", 'const token = "ghp_123456789012345678901234567890123456";', "github-token"],
    [
      "Private Key",
      "-----BEGIN RSA PRIVATE KEY-----\nMIIEowIBAAKCAQEA...\n-----END RSA PRIVATE KEY-----",
      "private-key",
    ],
  ])("flags %s", (_label, snippet, expectedRule) => {
    const findings = scanContent("example.ts", snippet);
    expect(findings.length).toBeGreaterThan(0);
    expect(findings[0]?.rule).toBe(expectedRule);
  });
});
