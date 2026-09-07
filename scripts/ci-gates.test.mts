import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

function read(path: string): string {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

describe("required CI gates", () => {
  it("keeps the credential-free PR gate suite and full-stack check required by workflow", () => {
    const workflow = read(".github/workflows/ci.yml");
    const fullstackWorkflow = read(".github/workflows/fullstack.yml");
    const checks = read("scripts/run-checks.mjs");

    expect(workflow).toContain("pull_request:");
    expect(workflow).toContain("name: Required repository gates");
    expect(workflow).toContain("corepack pnpm install --frozen-lockfile");
    expect(workflow).toContain("corepack pnpm run check:ci");
    expect(fullstackWorkflow).toContain("pull_request:");
    expect(fullstackWorkflow).toContain("name: Required full-stack gate");
    expect(fullstackWorkflow).toContain("corepack pnpm install --frozen-lockfile");
    expect(fullstackWorkflow).toContain("corepack pnpm run test:fullstack");
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
    expect(workflow).toContain("zaproxy/action-baseline@de8ad967d3548d44ef623df22cf95c3b0baf8b25");
    expect(workflow).not.toContain("52c50259e86016c68e2193b22e1b4b1a41dbad76");
  });

  it("configures Nightly quality workflow with Node 24 actions and check:nightly", () => {
    const workflow = read(".github/workflows/nightly.yml");

    expect(workflow).toContain("schedule:");
    expect(workflow).toContain("name: Nightly quality");
    expect(workflow).toContain("actions/checkout@08c6903cd8c0fde910a37f88322edcfb5dd907a8");
    expect(workflow).toContain("actions/setup-node@a0853c24544627f65ddf259abe73b1d18a591444");
    expect(workflow).toContain("corepack pnpm install --frozen-lockfile");
    expect(workflow).toContain("corepack pnpm run check:nightly");
  });

  it("ensures perf-report script builds core workspace via pnpm", () => {
    const perfReport = read("scripts/perf-report.mjs");

    expect(perfReport).toContain('"pnpm"');
    expect(perfReport).toContain('"@agent-harness/core"');
    expect(perfReport).not.toContain('"npm"');
  });
});
