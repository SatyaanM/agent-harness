import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

function normalizePath(value) {
  return value.replaceAll("\\", "/").replace(/^\.\//, "");
}

export function parseLcov(source) {
  const files = new Map();
  let currentPath;
  let lines = new Map();
  const flush = () => {
    if (!currentPath) return;
    files.set(currentPath, {
      found: lines.size,
      covered: [...lines.values()].filter((hits) => hits > 0).length,
    });
    currentPath = undefined;
    lines = new Map();
  };

  for (const line of source.split(/\r?\n/u)) {
    if (line.startsWith("SF:")) {
      flush();
      currentPath = normalizePath(line.slice(3));
      continue;
    }
    if (line.startsWith("DA:") && currentPath) {
      const [lineNumber, hitCount] = line.slice(3).split(",", 2).map(Number);
      if (Number.isInteger(lineNumber) && Number.isFinite(hitCount)) {
        lines.set(lineNumber, Math.max(lines.get(lineNumber) ?? 0, hitCount));
      }
      continue;
    }
    if (line === "end_of_record") flush();
  }
  flush();
  return { files };
}

function percentage(covered, found) {
  return found === 0 ? 100 : (covered / found) * 100;
}

function aggregate(files, prefix) {
  let found = 0;
  let covered = 0;
  for (const [file, value] of files) {
    if (!prefix || file.startsWith(prefix)) {
      found += value.found;
      covered += value.covered;
    }
  }
  return { found, covered, percentage: percentage(covered, found) };
}

function isProductionSource(file) {
  return (
    /^packages\/[^/]+\/src\/.*\.(?:ts|tsx)$/u.test(file) &&
    !/\.(?:test|spec)\.(?:ts|tsx)$/u.test(file) &&
    !file.endsWith(".d.ts")
  );
}

export function evaluateCoveragePolicy(report, policy, changedFiles = [], overallMetrics = {}) {
  const overall = aggregate(report.files);
  const measuredOverall = { ...overallMetrics, lines: overall.percentage };
  return [
    ...evaluateOverallCoverage(measuredOverall, policy.overall),
    ...evaluatePathCoverage(report.files, policy.paths),
    ...evaluateNewFileCoverage(report.files, changedFiles, policy.changedFiles),
  ];
}

function evaluateOverallCoverage(measuredOverall, floors) {
  const failures = [];
  for (const [metric, minimum] of Object.entries(floors)) {
    const actual = measuredOverall[metric];
    const label = metric === "lines" ? "line" : metric;
    if (typeof actual !== "number") {
      failures.push(`overall ${label} coverage is missing from the coverage report`);
    } else if (actual + Number.EPSILON < minimum) {
      failures.push(`overall ${label} coverage ${actual.toFixed(2)}% is below ${minimum}%`);
    }
  }
  return failures;
}

function evaluatePathCoverage(files, floors) {
  const failures = [];
  for (const floor of floors) {
    const prefix = normalizePath(floor.path);
    const result = aggregate(files, prefix);
    if (result.found === 0) {
      failures.push(`coverage path ${prefix} has no measurable lines`);
    } else if (result.percentage + Number.EPSILON < floor.lines) {
      failures.push(
        `coverage path ${prefix} is ${result.percentage.toFixed(2)}%, below ${floor.lines}%`,
      );
    }
  }
  return failures;
}

function evaluateNewFileCoverage(files, changedFiles, policy) {
  const failures = [];
  for (const changedFile of changedFiles) {
    const rawFile = typeof changedFile === "string" ? changedFile : changedFile.file;
    const status = typeof changedFile === "string" ? "A" : changedFile.status;
    const file = normalizePath(rawFile);
    if (!isProductionSource(file)) continue;
    if (status !== "A") continue;
    const result = files.get(file);
    if (!result || result.found === 0) {
      failures.push(`changed file ${file} has no measurable lines in LCOV`);
      continue;
    }
    const actual = percentage(result.covered, result.found);
    if (actual + Number.EPSILON < policy.newFilesMinimumLines) {
      failures.push(
        `new file ${file} line coverage is ${actual.toFixed(2)}%, below ${policy.newFilesMinimumLines}%`,
      );
    }
  }
  return failures;
}

function readChangedFiles(baseSha) {
  if (!baseSha) return [];
  const result = spawnSync(
    "git",
    ["diff", "--name-status", "--diff-filter=AM", `${baseSha}...HEAD`],
    {
      cwd: process.cwd(),
      encoding: "utf8",
    },
  );
  if (result.error || result.status !== 0) {
    throw new Error(
      `Unable to determine changed files from ${baseSha}: ${result.stderr || result.error?.message}`,
    );
  }
  return result.stdout
    .split(/\r?\n/u)
    .filter(Boolean)
    .map((line) => {
      const [status, ...fileParts] = line.split("\t");
      return { status, file: fileParts.join("\t") };
    });
}

function main() {
  const policyPath = path.resolve("coverage-policy.json");
  const lcovPath = path.resolve("coverage/lcov.info");
  const policy = JSON.parse(readFileSync(policyPath, "utf8"));
  const report = parseLcov(readFileSync(lcovPath, "utf8"));
  const summary = JSON.parse(readFileSync(path.resolve("coverage/coverage-summary.json"), "utf8"));
  const overallMetrics = Object.fromEntries(
    ["statements", "branches", "functions", "lines"].map((metric) => [
      metric,
      summary.total?.[metric]?.pct,
    ]),
  );
  const changedFiles = readChangedFiles(process.env.COVERAGE_BASE_SHA);
  const failures = evaluateCoveragePolicy(report, policy, changedFiles, overallMetrics);
  if (failures.length > 0) {
    console.error("Coverage policy failed:");
    for (const failure of failures) console.error(`- ${failure}`);
    process.exitCode = 1;
    return;
  }
  console.log(
    `Coverage policy passed. New-file gate examined ${changedFiles.filter(({ status, file }) => status === "A" && isProductionSource(file)).length} production source file(s).`,
  );
  console.log(
    "Coverage approximation uses fixed package/path ratchets plus full-file coverage for newly added source files; it is not executable-line diff coverage.",
  );
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
