import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HIGH_SECURITY_SEVERITY = 7;

function asObject(value, label) {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`Invalid CodeQL SARIF: ${label} must be an object`);
  }
  return value;
}

function hasReviewedSuppression(result) {
  if (!Array.isArray(result.suppressions) || result.suppressions.length === 0) return false;
  return result.suppressions.every(
    (suppression) =>
      typeof suppression === "object" &&
      suppression !== null &&
      suppression.kind === "inSource" &&
      typeof suppression.justification === "string" &&
      suppression.justification.trim().length > 0,
  );
}

function findRule(result, components) {
  const ruleId = typeof result.ruleId === "string" ? result.ruleId : undefined;
  if (ruleId) {
    const matchingRule = components
      .flatMap(({ rules }) => rules)
      .find(
        (candidate) =>
          typeof candidate === "object" && candidate !== null && candidate.id === ruleId,
      );
    if (matchingRule) return asObject(matchingRule, `rule ${ruleId}`);
  }

  const ruleReference =
    typeof result.rule === "object" && result.rule !== null && !Array.isArray(result.rule)
      ? result.rule
      : undefined;
  const ruleIndex = Number.isInteger(result.ruleIndex) ? result.ruleIndex : ruleReference?.index;
  const referencedComponent = components.find(({ component }) => {
    const reference = ruleReference?.toolComponent;
    if (typeof reference !== "object" || reference === null || Array.isArray(reference)) {
      return false;
    }
    return (
      (typeof reference.name === "string" && component.name === reference.name) ||
      (typeof reference.guid === "string" && component.guid === reference.guid)
    );
  });
  const indexedRules = referencedComponent?.rules ?? components[0]?.rules ?? [];
  if (Number.isInteger(ruleIndex) && ruleIndex >= 0 && ruleIndex < indexedRules.length) {
    const indexedRule = asObject(indexedRules[ruleIndex], `rule ${ruleIndex}`);
    if (!ruleId || indexedRule.id === ruleId) return indexedRule;
  }

  throw new Error(
    `Invalid CodeQL SARIF: cannot resolve rule ${ruleId ?? String(ruleIndex ?? "unknown")}`,
  );
}

function securitySeverityOf(result, rule) {
  const ruleProperties = asObject(rule.properties ?? {}, "rule properties");
  const resultProperties = asObject(result.properties ?? {}, "result properties");
  const rawSeverity = resultProperties["security-severity"] ?? ruleProperties["security-severity"];
  if (rawSeverity === undefined) return undefined;
  if (
    (typeof rawSeverity !== "string" && typeof rawSeverity !== "number") ||
    (typeof rawSeverity === "string" && rawSeverity.trim().length === 0)
  ) {
    throw new Error("Invalid CodeQL SARIF: security-severity must be a number from 0 to 10");
  }
  const severity = Number(rawSeverity);
  if (!Number.isFinite(severity) || severity < 0 || severity > 10) {
    throw new Error("Invalid CodeQL SARIF: security-severity must be a number from 0 to 10");
  }
  return severity;
}

function locationOf(result) {
  const location = Array.isArray(result.locations) ? result.locations[0] : undefined;
  if (typeof location !== "object" || location === null) return "unknown";
  const physicalLocation = location.physicalLocation;
  if (typeof physicalLocation !== "object" || physicalLocation === null) return "unknown";
  const artifactLocation = physicalLocation.artifactLocation;
  return typeof artifactLocation === "object" &&
    artifactLocation !== null &&
    typeof artifactLocation.uri === "string"
    ? artifactLocation.uri
    : "unknown";
}

function evaluateResult(rawResult, resultIndex, runIndex, rules) {
  const result = asObject(rawResult, `runs[${runIndex}].results[${resultIndex}]`);
  const rule = findRule(result, rules);
  const securitySeverity = securitySeverityOf(result, rule);
  if (hasReviewedSuppression(result)) return undefined;
  if (securitySeverity === undefined || securitySeverity < HIGH_SECURITY_SEVERITY) {
    return undefined;
  }
  return {
    ruleId: typeof result.ruleId === "string" ? result.ruleId : String(rule.id ?? "unknown"),
    securitySeverity,
    path: locationOf(result),
  };
}

function evaluateRun(rawRun, runIndex) {
  const run = asObject(rawRun, `runs[${runIndex}]`);
  const tool = asObject(run.tool, `runs[${runIndex}].tool`);
  const driver = asObject(tool.driver, `runs[${runIndex}].tool.driver`);
  const components = [
    {
      component: driver,
      rules: Array.isArray(driver.rules) ? driver.rules : [],
    },
  ];
  if (tool.extensions !== undefined) {
    if (!Array.isArray(tool.extensions)) {
      throw new Error(`Invalid CodeQL SARIF: runs[${runIndex}].tool.extensions must be an array`);
    }
    for (const [extensionIndex, rawExtension] of tool.extensions.entries()) {
      const extension = asObject(
        rawExtension,
        `runs[${runIndex}].tool.extensions[${extensionIndex}]`,
      );
      components.push({
        component: extension,
        rules: Array.isArray(extension.rules) ? extension.rules : [],
      });
    }
  }
  if (!Array.isArray(run.results)) return [];
  return run.results
    .map((result, resultIndex) => evaluateResult(result, resultIndex, runIndex, components))
    .filter(Boolean);
}

export function evaluateCodeqlSarif(input) {
  const sarif = asObject(input, "document");
  if (!Array.isArray(sarif.runs)) {
    throw new Error("Invalid CodeQL SARIF: runs must be an array");
  }

  return sarif.runs.flatMap((run, runIndex) => evaluateRun(run, runIndex));
}

function findSarifFiles(target) {
  const absolute = path.resolve(target);
  if (statSync(absolute).isFile()) return [absolute];
  return readdirSync(absolute, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".sarif"))
    .map((entry) => path.join(entry.parentPath, entry.name));
}

function main() {
  const target = process.argv[2];
  if (!target)
    throw new Error("Usage: node scripts/check-codeql-results.mjs <SARIF file or directory>");
  const files = findSarifFiles(target);
  if (files.length === 0) throw new Error(`No SARIF files found under ${target}`);
  const findings = files.flatMap((file) =>
    evaluateCodeqlSarif(JSON.parse(readFileSync(file, "utf8"))),
  );
  if (findings.length > 0) {
    for (const finding of findings) {
      console.error(
        `CodeQL ${finding.securitySeverity >= 9 ? "Critical" : "High"}: ${finding.ruleId} at ${finding.path}`,
      );
    }
    process.exitCode = 1;
    return;
  }
  console.log(
    `CodeQL severity gate passed (${files.length} SARIF file(s), no High/Critical results).`,
  );
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
