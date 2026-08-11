#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const SKIPPED_SEGMENTS = new Set([
  "node_modules",
  "vendor",
  "generated",
  "dist",
  "build",
]);

function parseArgs(argv) {
  let check = false;
  let root;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--check") {
      check = true;
    } else if (arg === "--root") {
      root = argv[index + 1];
      if (!root) throw new Error("--root requires a directory");
      index += 1;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return { check, root };
}

function shouldSkip(name) {
  return name.startsWith(".") || SKIPPED_SEGMENTS.has(name.toLowerCase());
}

function findMarkdownFiles(root) {
  const files = [];

  function visit(directory) {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      if (shouldSkip(entry.name)) continue;
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) visit(absolute);
      else if (entry.isFile() && entry.name.toLowerCase().endsWith(".md")) files.push(absolute);
    }
  }

  visit(root);
  return files.sort((left, right) => left.localeCompare(right));
}

function collectDefaultMarkdownFiles(repositoryRoot) {
  const files = [
    ...findMarkdownFiles(path.join(repositoryRoot, "docs")),
    ...findMarkdownFiles(path.join(repositoryRoot, "specs")),
    path.join(repositoryRoot, "PLANS.md"),
    path.join(repositoryRoot, "THIRD_PARTY_NOTICES.md"),
  ];

  return files.sort((left, right) => left.localeCompare(right));
}

function parseStringScalar(value, field, file) {
  const trimmed = value.trim();
  if (!trimmed) throw new Error(`${file}: ${field} must be a non-empty string`);

  if (trimmed.startsWith('"')) {
    try {
      const parsed = JSON.parse(trimmed);
      if (typeof parsed !== "string" || !parsed.trim()) throw new Error();
      return parsed;
    } catch {
      throw new Error(`${file}: ${field} has an invalid quoted string`);
    }
  }

  if (trimmed.startsWith("'")) {
    if (!trimmed.endsWith("'") || trimmed.length < 3) {
      throw new Error(`${file}: ${field} has an invalid quoted string`);
    }
    return trimmed.slice(1, -1).replaceAll("''", "'");
  }

  if (/^[\[\]{|}>*&!]/.test(trimmed) || /^(null|true|false|~)$/i.test(trimmed)) {
    throw new Error(`${file}: ${field} must be a string scalar`);
  }
  return trimmed;
}

function parseMetadata(content, file) {
  const normalized = content.replaceAll("\r\n", "\n");
  if (!normalized.startsWith("---\n")) throw new Error(`${file}: missing YAML frontmatter`);

  const end = normalized.indexOf("\n---\n", 4);
  if (end === -1) throw new Error(`${file}: unterminated YAML frontmatter`);

  const lines = normalized.slice(4, end).split("\n");
  let summary;
  let readWhen;

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (!line.trim() || line.trimStart().startsWith("#")) continue;

    if (line.startsWith("summary:")) {
      if (summary !== undefined) throw new Error(`${file}: duplicate summary`);
      summary = parseStringScalar(line.slice("summary:".length), "summary", file);
      continue;
    }

    if (line === "read_when:") {
      if (readWhen !== undefined) throw new Error(`${file}: duplicate read_when`);
      readWhen = [];
      while (index + 1 < lines.length && /^\s+-\s+/.test(lines[index + 1])) {
        index += 1;
        const item = lines[index].replace(/^\s+-\s+/, "");
        readWhen.push(parseStringScalar(item, "read_when item", file));
      }
      continue;
    }

    throw new Error(`${file}: unsupported or malformed frontmatter line: ${line}`);
  }

  if (!summary) throw new Error(`${file}: missing summary`);
  if (!readWhen || readWhen.length === 0) {
    throw new Error(`${file}: read_when must be a non-empty string array`);
  }
  return { summary, readWhen };
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
  const repositoryRoot = path.resolve(scriptDirectory, "..");
  const docsRoot = args.root ? path.resolve(args.root) : undefined;

  if (docsRoot && (!fs.existsSync(docsRoot) || !fs.statSync(docsRoot).isDirectory())) {
    throw new Error(`Documentation root is not a directory: ${docsRoot}`);
  }

  const markdownFiles = docsRoot
    ? findMarkdownFiles(docsRoot)
    : collectDefaultMarkdownFiles(repositoryRoot);

  const failures = [];
  const entries = [];
  for (const file of markdownFiles) {
    const displayPath = path.relative(repositoryRoot, file).replaceAll(path.sep, "/");
    try {
      entries.push({ displayPath, ...parseMetadata(fs.readFileSync(file, "utf8"), displayPath) });
    } catch (error) {
      failures.push(error instanceof Error ? error.message : String(error));
    }
  }

  if (failures.length > 0) {
    for (const failure of failures) console.error(failure);
    process.exitCode = 1;
    return;
  }

  if (!args.check) {
    for (const entry of entries) {
      console.log(`${entry.displayPath}\n  ${entry.summary}`);
      for (const trigger of entry.readWhen) console.log(`  - ${trigger}`);
    }
  }
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
