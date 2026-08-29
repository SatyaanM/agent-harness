import { spawnSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { checkSecrets, scanContent } from "./check-secrets.mjs";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

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

describe("checkSecrets", () => {
  it("keeps full-directory scanning strength without a separate metadata check", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "agent-harness-secrets-"));
    tempDirs.push(root);
    await writeFile(
      path.join(root, "credentials.txt"),
      "sk-proj-abcdef12345678901234567890\n",
      "utf8",
    );

    expect(checkSecrets(root)).toMatchObject([
      { file: "credentials.txt", line: 1, rule: "openai-api-key" },
    ]);
  });

  it("scans staged bytes even when the working-tree file has been replaced", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "agent-harness-staged-secrets-"));
    tempDirs.push(root);
    expect(spawnSync("git", ["init", "--quiet"], { cwd: root }).status).toBe(0);
    const file = path.join(root, "credentials.txt");
    await writeFile(file, "sk-proj-abcdef12345678901234567890\n", "utf8");
    expect(spawnSync("git", ["add", "credentials.txt"], { cwd: root }).status).toBe(0);
    await writeFile(file, "clean working tree\n", "utf8");

    expect(checkSecrets(root, true)).toMatchObject([
      { file: "credentials.txt", line: 1, rule: "openai-api-key" },
    ]);
  });

  it.skipIf(process.platform === "win32")(
    "parses NUL-delimited staged filenames containing newlines",
    async () => {
      const root = await mkdtemp(path.join(tmpdir(), "agent-harness-staged-nul-"));
      tempDirs.push(root);
      expect(spawnSync("git", ["init", "--quiet"], { cwd: root }).status).toBe(0);
      const unusualName = "line\nbreak.txt";
      await writeFile(path.join(root, unusualName), "sk-proj-abcdef12345678901234567890\n", "utf8");
      expect(spawnSync("git", ["add", unusualName], { cwd: root }).status).toBe(0);

      expect(checkSecrets(root, true)).toMatchObject([
        { file: unusualName, line: 1, rule: "openai-api-key" },
      ]);
    },
  );
});
