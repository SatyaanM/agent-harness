import { describe, expect, it } from "vitest";
import {
  type CoveragePolicy,
  evaluateCoveragePolicy,
  parseLcov,
} from "./check-coverage-policy.mjs";

const policy: CoveragePolicy = {
  version: 1,
  overall: { lines: 70 },
  paths: [
    { path: "packages/core/src/agent/", lines: 80 },
    { path: "packages/server/src/routes/", lines: 75 },
  ],
  changedFiles: { newFilesMinimumLines: 70 },
};

describe("coverage policy", () => {
  it("parses executable and covered lines without double-counting", () => {
    const report = parseLcov(
      ["SF:packages/core/src/agent/example.ts", "DA:1,1", "DA:2,0", "DA:2,1", "end_of_record"].join(
        "\n",
      ),
    );

    expect(report.files.get("packages/core/src/agent/example.ts")).toEqual({
      found: 2,
      covered: 2,
    });
  });

  it("enforces overall, sensitive path, and changed-file floors", () => {
    const report = parseLcov(
      [
        "SF:packages/core/src/agent/good.ts",
        "DA:1,1",
        "DA:2,0",
        "SF:packages/server/src/routes/weak.ts",
        "DA:1,1",
        "DA:2,0",
        "end_of_record",
      ].join("\n"),
    );

    const failures = evaluateCoveragePolicy(report, policy, ["packages/server/src/routes/weak.ts"]);

    expect(failures).toEqual(
      expect.arrayContaining([
        expect.stringContaining("overall line coverage"),
        expect.stringContaining("packages/core/src/agent/"),
        expect.stringContaining("packages/server/src/routes/"),
        expect.stringContaining("new file packages/server/src/routes/weak.ts"),
      ]),
    );
  });

  it("rejects a changed source file absent from coverage instead of silently skipping it", () => {
    const report = parseLcov("SF:packages/core/src/covered.ts\nDA:1,1\nend_of_record\n");

    expect(
      evaluateCoveragePolicy(report, policy, ["packages/core/src/agent/new-file.ts"]),
    ).toContainEqual(expect.stringContaining("has no measurable lines"));
  });

  it("uses package ratchets for modified legacy files instead of pretending to measure diff lines", () => {
    const report = parseLcov(
      "SF:packages/server/src/routes/legacy.ts\nDA:1,1\nDA:2,0\nend_of_record\n",
    );
    const packageOnlyPolicy = { ...policy, paths: [], overall: { lines: 0 } };

    expect(
      evaluateCoveragePolicy(report, packageOnlyPolicy, [
        { status: "M", file: "packages/server/src/routes/legacy.ts" },
      ]),
    ).toEqual([]);
  });

  it("fails closed when a configured overall metric is absent", () => {
    const report = parseLcov("SF:packages/core/src/covered.ts\nDA:1,1\nend_of_record\n");
    const metricPolicy = {
      ...policy,
      overall: { lines: 70, branches: 60 },
      paths: [],
    };

    expect(evaluateCoveragePolicy(report, metricPolicy)).toContainEqual(
      "overall branches coverage is missing from the coverage report",
    );
  });

  it("ignores changed tests and declarations", () => {
    const report = parseLcov("SF:packages/core/src/covered.ts\nDA:1,1\nend_of_record\n");
    const changedFilePolicy = { ...policy, paths: [] };

    expect(
      evaluateCoveragePolicy(report, changedFilePolicy, [
        "packages/core/src/covered.test.ts",
        "packages/core/src/types.d.ts",
      ]),
    ).toEqual([]);
  });
});
