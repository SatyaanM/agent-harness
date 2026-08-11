#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const NAME_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

function parseArgs(argv) {
  let root;
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === "--root") {
      root = argv[index + 1];
      if (!root) throw new Error("--root requires a directory");
      index += 1;
    } else {
      throw new Error(`Unknown argument: ${argv[index]}`);
    }
  }
  return { root };
}

function scalar(value, field, file) {
  const trimmed = value.trim();
  if (!trimmed) throw new Error(`${file}: ${field} must be a non-empty string`);
  if (/^[[\]{|}>*&!]/.test(trimmed) || /^(null|true|false|~)$/i.test(trimmed)) {
    throw new Error(`${file}: ${field} must be a string scalar`);
  }
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
  return trimmed;
}

function parseSkill(file, displayPath) {
  const content = fs.readFileSync(file, "utf8").replaceAll("\r\n", "\n");
  if (!content.startsWith("---\n")) throw new Error(`${displayPath}: missing YAML frontmatter`);
  const end = content.indexOf("\n---\n", 4);
  if (end === -1) throw new Error(`${displayPath}: unterminated YAML frontmatter`);

  const metadata = new Map();
  for (const line of content.slice(4, end).split("\n")) {
    if (!line.trim() || line.trimStart().startsWith("#")) continue;
    const match = /^([a-z_]+):\s*(.*)$/.exec(line);
    if (!match) throw new Error(`${displayPath}: malformed frontmatter line: ${line}`);
    const [, key, value] = match;
    if (key !== "name" && key !== "description") {
      throw new Error(`${displayPath}: unsupported frontmatter field: ${key}`);
    }
    if (metadata.has(key)) throw new Error(`${displayPath}: duplicate ${key}`);
    metadata.set(key, scalar(value, key, displayPath));
  }

  const name = metadata.get("name");
  const description = metadata.get("description");
  if (!name) throw new Error(`${displayPath}: missing name`);
  if (!description) throw new Error(`${displayPath}: missing description`);
  if (!NAME_PATTERN.test(name) || name.length > 63) {
    throw new Error(
      `${displayPath}: name must be at most 63 lowercase letters, digits, or hyphens`,
    );
  }
  if (!content.slice(end + 5).trim()) throw new Error(`${displayPath}: instructions body is empty`);
  return { name, description };
}

function parseQuotedYamlValue(value, field, displayPath) {
  const trimmed = value.trim();
  if (!trimmed.startsWith('"')) {
    throw new Error(`${displayPath}: ${field} must be a quoted string`);
  }
  return scalar(trimmed, field, displayPath);
}

function validateUiManifest(file, displayPath, skillName) {
  const lines = fs.readFileSync(file, "utf8").replaceAll("\r\n", "\n").split("\n");
  const interfaceIndex = lines.indexOf("interface:");
  if (interfaceIndex === -1) throw new Error(`${displayPath}: missing interface mapping`);

  const values = new Map();
  for (let index = interfaceIndex + 1; index < lines.length; index += 1) {
    const line = lines[index];
    if (!line.trim()) continue;
    if (!line.startsWith("  ")) break;
    const match = /^ {2}([a-z_]+):\s*(.*)$/.exec(line);
    if (!match) throw new Error(`${displayPath}: malformed interface line: ${line}`);
    const [, key, value] = match;
    if (values.has(key)) throw new Error(`${displayPath}: duplicate interface.${key}`);
    values.set(key, parseQuotedYamlValue(value, `interface.${key}`, displayPath));
  }

  for (const field of ["display_name", "short_description", "default_prompt"]) {
    if (!values.has(field)) throw new Error(`${displayPath}: missing interface.${field}`);
  }
  const shortDescription = values.get("short_description");
  if (shortDescription.length < 25 || shortDescription.length > 64) {
    throw new Error(`${displayPath}: interface.short_description must be 25-64 characters`);
  }
  if (!values.get("default_prompt").includes(`$${skillName}`)) {
    throw new Error(`${displayPath}: interface.default_prompt must mention $${skillName}`);
  }
}

function validate(root, repositoryRoot) {
  if (!fs.existsSync(root) || !fs.statSync(root).isDirectory()) {
    throw new Error(`Skills root is not a directory: ${root}`);
  }

  const directories = fs
    .readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith("."))
    .sort((left, right) => left.name.localeCompare(right.name));
  if (directories.length === 0) throw new Error(`No skill directories found under ${root}`);

  const names = new Map();
  const failures = [];
  for (const directory of directories) {
    const skillFile = path.join(root, directory.name, "SKILL.md");
    const displayPath = path.relative(repositoryRoot, skillFile).replaceAll(path.sep, "/");
    try {
      if (!fs.existsSync(skillFile)) throw new Error(`${displayPath}: missing SKILL.md`);
      const skill = parseSkill(skillFile, displayPath);
      if (names.has(skill.name)) {
        throw new Error(
          `${displayPath}: duplicate skill name ${skill.name}; first seen in ${names.get(skill.name)}`,
        );
      }
      names.set(skill.name, displayPath);
      if (skill.name !== directory.name) {
        throw new Error(
          `${displayPath}: name ${skill.name} does not match directory ${directory.name}`,
        );
      }

      const uiFile = path.join(root, directory.name, "agents", "openai.yaml");
      if (fs.existsSync(uiFile)) {
        validateUiManifest(
          uiFile,
          path.relative(repositoryRoot, uiFile).replaceAll(path.sep, "/"),
          skill.name,
        );
      }
    } catch (error) {
      failures.push(error instanceof Error ? error.message : String(error));
    }
  }

  if (failures.length > 0) throw new Error(failures.join("\n"));
  console.log(`Validated ${names.size} skill${names.size === 1 ? "" : "s"}.`);
}

try {
  const args = parseArgs(process.argv.slice(2));
  const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  validate(
    path.resolve(args.root ?? path.join(repositoryRoot, ".agents", "skills")),
    repositoryRoot,
  );
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
