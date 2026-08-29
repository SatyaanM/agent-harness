#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * @typedef {{
 *   name: string;
 *   pattern: RegExp;
 *   description: string;
 * }} SecretRule
 */

const SECRET_RULES = [
  {
    name: "anthropic-api-key",
    pattern: /\bsk-ant-[a-zA-Z0-9_-]{20,}\b/u,
    description: "Anthropic API Key",
  },
  {
    name: "openai-api-key",
    pattern: /\bsk-(?!ant-)(?:proj-|svcacct-)?[a-zA-Z0-9_-]{20,}\b/u,
    description: "OpenAI API Key",
  },
  {
    name: "google-api-key",
    pattern: /\bAIza[0-9A-Za-z-_]{35}\b/u,
    description: "Google / Gemini API Key",
  },
  {
    name: "github-token",
    pattern: /\b(?:ghp|gho|ghu|ghs|ghr)_[a-zA-Z0-9]{36}\b|\bgithub_pat_[a-zA-Z0-9_]{40,}\b/u,
    description: "GitHub Personal Access Token",
  },
  {
    name: "slack-token",
    pattern: /\bxox[baprs]-[0-9a-zA-Z-]{10,48}\b/u,
    description: "Slack API Token",
  },
  {
    name: "private-key",
    pattern: /-----BEGIN (?:[A-Z0-9_-]+\s+)*(?:PRIVATE\s+)?KEY-----/u,
    description: "Private Encryption Key",
  },
  {
    name: "generic-bearer-secret",
    pattern: /\bBearer\s+[a-zA-Z0-9_\-.]{32,}\b/u,
    description: "Bearer Authorization Token",
  },
];

const IGNORED_DIRECTORIES = new Set([
  ".git",
  ".next",
  ".turbo",
  "coverage",
  "dist",
  "node_modules",
]);

const IGNORED_FILES = new Set([
  ".env.example",
  "check-secrets.test.mts",
  "package-lock.json",
  "security-audit-exceptions.json",
]);

const SAFE_PATTERNS = [
  /your[-_]api[-_]key/i,
  /your[-_]openai[-_]key/i,
  /your[-_]anthropic[-_]key/i,
  /your[-_]gemini[-_]api[-_]key/i,
  /your[-_]opencode[-_]go[-_]key/i,
  /\bexample\b/i,
  /\bplaceholder\b/i,
  /\bdummy\b/i,
  /\bmock\b/i,
  /\bfake\b/i,
  /\btest-key\b/i,
  /\btest-token\b/i,
  /<your-/i,
  /0000000000000000000000000000000000000000/,
];

/**
 * @param {string} text
 * @returns {boolean}
 */
function isSafeMockOrPlaceholder(text) {
  return SAFE_PATTERNS.some((pattern) => pattern.test(text));
}

/**
 * @typedef {{
 *   file: string;
 *   line?: number;
 *   rule: string;
 *   description: string;
 *   snippet: string;
 * }} SecretFinding
 */

/**
 * @param {string} filePath
 * @param {string} content
 * @returns {SecretFinding[]}
 */
export function scanContent(filePath, content) {
  const findings = [];
  const lines = content.split("\n");

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? "";
    if (isSafeMockOrPlaceholder(line)) continue;

    for (const rule of SECRET_RULES) {
      if (rule.pattern.test(line)) {
        findings.push({
          file: filePath,
          line: index + 1,
          rule: rule.name,
          description: rule.description,
          snippet: line.trim().slice(0, 80),
        });
      }
    }
  }

  return findings;
}

/**
 * @param {string} rootDir
 * @param {boolean} stagedOnly
 * @returns {SecretFinding[]}
 */
export function checkSecrets(rootDir, stagedOnly = false) {
  const absoluteRoot = path.resolve(rootDir);

  if (stagedOnly) {
    const result = spawnSync(
      "git",
      ["diff", "--cached", "--name-only", "-z", "--diff-filter=ACMR"],
      {
        cwd: absoluteRoot,
        encoding: "utf8",
      },
    );
    if (result.error || result.status !== 0) {
      return scanDirectory(absoluteRoot);
    }
    const stagedFiles = result.stdout
      .split("\0")
      .filter((file) => file.length > 0 && !IGNORED_FILES.has(path.basename(file)));

    const findings = [];
    for (const relative of stagedFiles) {
      const blob = spawnSync("git", ["cat-file", "blob", `:${relative}`], {
        cwd: absoluteRoot,
        encoding: "utf8",
        maxBuffer: Number.MAX_SAFE_INTEGER,
      });
      if (blob.error || blob.status !== 0) continue;
      findings.push(...scanContent(relative, blob.stdout));
    }
    return findings;
  }

  return scanDirectory(absoluteRoot);
}

/**
 * @param {string} rootDir
 * @returns {SecretFinding[]}
 */
function scanDirectory(rootDir) {
  const findings = [];
  const pending = [rootDir];

  while (pending.length > 0) {
    const current = pending.pop();
    if (!current) continue;

    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        if (!IGNORED_DIRECTORIES.has(entry.name)) {
          pending.push(path.join(current, entry.name));
        }
        continue;
      }

      if (IGNORED_FILES.has(entry.name)) continue;

      const fullPath = path.join(current, entry.name);
      const relative = path.relative(rootDir, fullPath).replaceAll("\\", "/");
      try {
        const content = fs.readFileSync(fullPath, "utf8");
        findings.push(...scanContent(relative, content));
      } catch {
        // Skip unreadable / binary files
      }
    }
  }

  return findings;
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : "";
if (invokedPath === path.resolve(fileURLToPath(import.meta.url))) {
  const stagedOnly = process.argv.includes("--staged");
  const findings = checkSecrets(process.cwd(), stagedOnly);

  if (findings.length === 0) {
    console.log("Secret scan passed: No credentials detected.");
  } else {
    for (const finding of findings) {
      const loc = finding.line ? `${finding.file}:${finding.line}` : finding.file;
      console.error(`[SECRET BLOCKED] ${loc} (${finding.description}): ${finding.snippet}`);
    }
    console.error(
      `\nFound ${findings.length} potential secret(s). Please remove them before committing.`,
    );
    process.exitCode = 1;
  }
}
