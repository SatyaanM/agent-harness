import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

function read(path: string): string {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

describe("required CI gates", () => {
  it("keeps the credential-free PR gate suite and full-stack check required by workflow", () => {
    const workflow = read(".github/workflows/ci.yml");
    const checks = read("scripts/run-checks.mjs");

    expect(workflow).toContain("pull_request:");
    expect(workflow).toContain("name: Required repository gates");
    expect(workflow).toContain("name: Required full-stack gate");
    expect(workflow).toContain("corepack pnpm install --frozen-lockfile");
    expect(workflow).toContain("corepack pnpm run check:ci");
    expect(workflow).toContain("corepack pnpm run test:fullstack");
    for (const command of [
      "quality:ci",
      "typecheck",
      "test:coverage",
      "build",
      "security:audit",
      "test:security",
    ]) {
      expect(checks).toContain(`"${command}"`);
    }
  });

  it("fails CodeQL on locally evaluated High/Critical SARIF results", () => {
    const workflow = read(".github/workflows/codeql.yml");

    expect(workflow).toContain("name: Required CodeQL High/Critical gate");
    expect(workflow).toContain("output: codeql-results");
    expect(workflow).toContain("node scripts/check-codeql-results.mjs codeql-results");
  });

  it("allows informational ZAP warnings but fails actionable alerts", () => {
    const workflow = read(".github/workflows/zap-scan.yml");

    expect(workflow).toContain("fail_action: true");
    expect(workflow).toContain('cmd_options: "-I"');
    expect(workflow).not.toContain("fail_action: false");
  });
});
