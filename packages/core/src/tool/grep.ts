import { z } from "zod";
import fs from "node:fs/promises";
import path from "node:path";
import { getConfig } from "../config.js";
import { assertWithinRoot } from "./utils.js";
import type { Tool } from "./types.js";

const GrepParams = z.object({
  pattern: z.string().min(1),
  path: z.string().optional(),
  include: z.array(z.string()).optional(),
});

interface Match {
  file: string;
  line: number;
  text: string;
}

async function searchFile(
  filePath: string,
  regex: RegExp,
  root: string,
): Promise<Match[]> {
  const content = await fs.readFile(filePath, "utf-8").catch(() => null);
  if (content === null) return [];

  const matches: Match[] = [];
  const lines = content.split("\n");
  for (let i = 0; i < lines.length; i++) {
    if (regex.test(lines[i])) {
      const rel = path.relative(root, filePath).replace(/\\/g, "/");
      matches.push({ file: rel, line: i + 1, text: lines[i].trimEnd() });
    }
  }
  return matches;
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
  description: "Search file contents using a regex pattern. Returns matching lines with file paths and line numbers.",
  parameters: GrepParams,

  async execute(args) {
    const root = getConfig().ROOT;
    const searchPath = args.path ? path.resolve(root, args.path) : root;
    assertWithinRoot(searchPath, root);

    const regex = new RegExp(args.pattern, "i");
    const results: Match[] = [];

    const stat = await fs.stat(searchPath).catch(() => null);
    if (!stat) {
      return `Path not found: ${args.path ?? root}`;
    }

    const files: string[] = [];
    if (stat.isDirectory()) {
      for await (const f of walkDir(searchPath)) {
        if (args.include && !matchesInclude(f, args.include)) continue;
        files.push(f);
      }
    } else {
      files.push(searchPath);
    }

    for (const f of files) {
      const m = await searchFile(f, regex, root);
      results.push(...m);
      if (results.length >= 500) break;
    }

    if (results.length === 0) {
      return "No matches found.";
    }

    return results
      .map((m) => `${m.file}:${m.line}: ${m.text}`)
      .join("\n");
  },
};
