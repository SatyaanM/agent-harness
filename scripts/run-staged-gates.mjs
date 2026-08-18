#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import process from "node:process";
import { checkQualityPolicy } from "./check-quality-policy.mjs";
import { checkSecrets } from "./check-secrets.mjs";
import { checkDocs } from "./docs-list.mjs";
import { validateSkills } from "./validate-skills.mjs";

const startTime = performance.now();
const rootDir = process.cwd();
let hasErrors = false;

// 1. Check cached whitespace diffs
const whitespaceResult = spawnSync("git", ["diff", "--cached", "--check"], {
  cwd: rootDir,
  stdio: "inherit",
});
if (whitespaceResult.status !== 0) {
  hasErrors = true;
}

// 2. AST Quality Policy
try {
  const policyDiagnostics = checkQualityPolicy(rootDir);
  if (policyDiagnostics.length > 0) {
    hasErrors = true;
    for (const d of policyDiagnostics) {
      const loc = d.line ? `${d.file}:${d.line}` : d.file;
      console.error(`[POLICY] ${loc} [${d.rule}]: ${d.message}`);
    }
  }
} catch (error) {
  hasErrors = true;
  console.error(`[POLICY ERROR] ${error instanceof Error ? error.message : String(error)}`);
}

// 3. Documentation Metadata
try {
  const docFailures = checkDocs(rootDir);
  if (docFailures.length > 0) {
    hasErrors = true;
    for (const f of docFailures) {
      console.error(`[DOCS] ${f}`);
    }
  }
} catch (error) {
  hasErrors = true;
  console.error(`[DOCS ERROR] ${error instanceof Error ? error.message : String(error)}`);
}

// 4. Staged Secrets Scan
try {
  const secretFindings = checkSecrets(rootDir, true);
  if (secretFindings.length > 0) {
    hasErrors = true;
    for (const s of secretFindings) {
      const loc = s.line ? `${s.file}:${s.line}` : s.file;
      console.error(`[SECRET] ${loc} (${s.description}): ${s.snippet}`);
    }
  }
} catch (error) {
  hasErrors = true;
  console.error(`[SECRETS ERROR] ${error instanceof Error ? error.message : String(error)}`);
}

// 5. Agent Skills Validation
try {
  const { failures } = validateSkills(undefined, rootDir);
  if (failures.length > 0) {
    hasErrors = true;
    for (const f of failures) {
      console.error(`[SKILLS] ${f}`);
    }
  }
} catch (error) {
  hasErrors = true;
  console.error(`[SKILLS ERROR] ${error instanceof Error ? error.message : String(error)}`);
}

const elapsedMs = Math.round(performance.now() - startTime);

if (hasErrors) {
  console.error(`\x1b[31mStaged gates failed in ${elapsedMs}ms.\x1b[0m`);
  process.exitCode = 1;
} else {
  console.log(`\x1b[32mStaged gates passed in ${elapsedMs}ms.\x1b[0m`);
}
