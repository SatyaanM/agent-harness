import fs from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { getConfig } from "../config.js";
import { readUtf8FileBounded } from "../filesystem/bounded-io.js";
import type { Tool } from "./types.js";
import {
  assertExistingPathWithinRoot,
  assertWithinRoot,
  MAX_TOOL_ENTRIES,
  MAX_WORKSPACE_FILE_BYTES,
  WorkspacePathSchema,
} from "./utils.js";

const MAX_GREP_PATTERN_CHARS = 1_000;
const MAX_GREP_RESULTS = 500;
const MAX_GREP_TOTAL_BYTES = 50_000_000;
const MAX_RESULT_LINE_CHARS = 10_000;

const GrepParams = z
  .object({
    pattern: z.string().min(1).max(MAX_GREP_PATTERN_CHARS),
    path: WorkspacePathSchema.optional(),
    include: z.array(z.string().min(1).max(128)).max(128).optional(),
  })
  .strict();

interface Match {
  file: string;
  line: number;
  text: string;
}

async function searchFile(
  filePath: string,
  regex: RegExp,
  root: string,
  matchLimit: number,
  byteBudget: number,
): Promise<{ bytesRead: number; matches: Match[] }> {
  const stat = await fs.stat(filePath).catch(() => null);
  if (!stat?.isFile() || stat.size > MAX_WORKSPACE_FILE_BYTES || stat.size > byteBudget) {
    return { bytesRead: 0, matches: [] };
  }
  const content = await readUtf8FileBounded(
    filePath,
    Math.min(MAX_WORKSPACE_FILE_BYTES, byteBudget),
    "grep input file",
  ).catch(() => null);
  if (content === null) return { bytesRead: 0, matches: [] };

  const matches: Match[] = [];
  const lines = content.split("\n");
  for (let i = 0; i < lines.length; i++) {
    if (regex.test(lines[i])) {
      const rel = path.relative(root, filePath).replace(/\\/g, "/");
      matches.push({
        file: rel,
        line: i + 1,
        text: lines[i].trimEnd().slice(0, MAX_RESULT_LINE_CHARS),
      });
      if (matches.length >= matchLimit) break;
    }
  }
  return { bytesRead: stat.size, matches };
}

async function* walkDir(dir: string): AsyncGenerator<string> {
  let entries: import("node:fs").Dirent[];
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isSymbolicLink()) continue;
    if (entry.isDirectory()) {
      if (entry.name === "node_modules" || entry.name === ".git") continue;
      yield* walkDir(full);
    } else {
      yield full;
    }
  }
}

function matchesInclude(filename: string, include: string[]): boolean {
  return include.some((ext) => {
    const pattern = ext.startsWith(".") ? ext : `.${ext}`;
    return filename.endsWith(pattern);
  });
}

export const grepTool: Tool<typeof GrepParams> = {
  name: "grep",
  description:
    "Search file contents using a regex pattern. Returns matching lines with file paths and line numbers.",
  parameters: GrepParams,

  async execute(args) {
    const root = getConfig().ROOT;
    const searchPath = args.path ? path.resolve(root, args.path) : root;
    assertWithinRoot(searchPath, root);

    const regex = new RegExp(args.pattern, "i");
    const results: Match[] = [];
    let bytesRead = 0;
    let filesScanned = 0;

    const stat = await fs.stat(searchPath).catch(() => null);
    if (!stat) {
      return `Path not found: ${args.path ?? root}`;
    }
    await assertExistingPathWithinRoot(searchPath, root);

    const files = stat.isDirectory() ? walkDir(searchPath) : singleFile(searchPath);
    for await (const file of files) {
      if (args.include && !matchesInclude(file, args.include)) continue;
      if (filesScanned >= MAX_TOOL_ENTRIES || bytesRead >= MAX_GREP_TOTAL_BYTES) break;
      filesScanned += 1;
      const searched = await searchFile(
        file,
        regex,
        root,
        MAX_GREP_RESULTS - results.length,
        MAX_GREP_TOTAL_BYTES - bytesRead,
      );
      bytesRead += searched.bytesRead;
      results.push(...searched.matches);
      if (results.length >= MAX_GREP_RESULTS) break;
    }

    async function* singleFile(filePath: string): AsyncGenerator<string> {
      yield filePath;
    }

    if (results.length === 0) {
      return "No matches found.";
    }

    const output = results.map((match) => `${match.file}:${match.line}: ${match.text}`);
    if (
      results.length >= MAX_GREP_RESULTS ||
      filesScanned >= MAX_TOOL_ENTRIES ||
      bytesRead >= MAX_GREP_TOTAL_BYTES
    ) {
      output.push("[truncated: grep resource limit reached]");
    }
    return output.join("\n");
  },
};
