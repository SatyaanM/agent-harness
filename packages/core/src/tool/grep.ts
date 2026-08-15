import fs from "node:fs/promises";
import path from "node:path";
import { Script } from "node:vm";
import { z } from "zod";
import { getConfig } from "../config.js";
import { readUtf8FileBounded } from "../filesystem/bounded-io.js";
import { isRecord, parseBoundary } from "../validation.js";
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
const MAX_REGEX_FILE_MS = 250;

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

const RegexMatchesSchema = z
  .array(
    z.object({
      line: z.number().int().positive(),
      text: z.string().max(MAX_RESULT_LINE_CHARS),
    }),
  )
  .max(MAX_GREP_RESULTS);

const regexSearchScript = new Script(`
  const regex = new RegExp(pattern, "i");
  const matches = [];
  for (let index = 0; index < lines.length && matches.length < matchLimit; index += 1) {
    if (regex.test(lines[index])) {
      matches.push({
        line: index + 1,
        text: lines[index].trimEnd().slice(0, maxLineChars),
      });
    }
  }
  matches;
`);

class GrepRegexResourceError extends Error {}

async function searchFile(
  filePath: string,
  pattern: string,
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

  const lines = content.split("\n");
  let rawMatches: unknown;
  try {
    rawMatches = regexSearchScript.runInNewContext(
      { pattern, lines, matchLimit, maxLineChars: MAX_RESULT_LINE_CHARS },
      { timeout: MAX_REGEX_FILE_MS },
    );
  } catch (error) {
    if (isRecord(error) && error.code === "ERR_SCRIPT_EXECUTION_TIMEOUT") {
      throw new GrepRegexResourceError();
    }
    throw error;
  }
  const rel = path.relative(root, filePath).replace(/\\/g, "/");
  const matches: Match[] = parseBoundary(
    RegexMatchesSchema,
    rawMatches,
    "grep regular expression result",
  ).map((match) => ({ ...match, file: rel }));
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

export function createGrepTool(options?: { maxFiles?: number }): Tool<typeof GrepParams> {
  const maxFiles = options?.maxFiles ?? MAX_TOOL_ENTRIES;
  return {
    name: "grep",
    description:
      "Search file contents using a regex pattern. Returns matching lines with file paths and line numbers.",
    parameters: GrepParams,

    async execute(args, context) {
      const root = getConfig().ROOT;
      const searchPath = args.path ? path.resolve(root, args.path) : root;
      assertWithinRoot(searchPath, root);

      const results: Match[] = [];
      let bytesRead = 0;
      let filesScanned = 0;
      let truncated = false;

      const stat = await fs.stat(searchPath).catch(() => null);
      if (!stat) {
        return `Path not found: ${args.path ?? root}`;
      }
      await assertExistingPathWithinRoot(searchPath, root);

      const files = stat.isDirectory() ? walkDir(searchPath) : singleFile(searchPath);
      for await (const file of files) {
        if (context?.signal.aborted) return "[error] Search cancelled.";
        if (filesScanned >= maxFiles || bytesRead >= MAX_GREP_TOTAL_BYTES) {
          truncated = true;
          break;
        }
        filesScanned += 1;
        if (args.include && !matchesInclude(file, args.include)) continue;
        let searched: Awaited<ReturnType<typeof searchFile>>;
        try {
          searched = await searchFile(
            file,
            args.pattern,
            root,
            MAX_GREP_RESULTS - results.length,
            MAX_GREP_TOTAL_BYTES - bytesRead,
          );
        } catch (error) {
          if (error instanceof GrepRegexResourceError) {
            return `[error] Grep regular expression resource limit exceeded (${MAX_REGEX_FILE_MS}ms per file).`;
          }
          throw error;
        }
        bytesRead += searched.bytesRead;
        results.push(...searched.matches);
        if (results.length >= MAX_GREP_RESULTS) {
          truncated = true;
          break;
        }
      }

      async function* singleFile(filePath: string): AsyncGenerator<string> {
        yield filePath;
      }

      if (results.length === 0) {
        return truncated
          ? "No matches found.\n[truncated: grep resource limit reached]"
          : "No matches found.";
      }

      const output = results.map((match) => `${match.file}:${match.line}: ${match.text}`);
      if (
        results.length >= MAX_GREP_RESULTS ||
        truncated ||
        filesScanned >= maxFiles ||
        bytesRead >= MAX_GREP_TOTAL_BYTES
      ) {
        output.push("[truncated: grep resource limit reached]");
      }
      return output.join("\n");
    },
  };
}

export const grepTool = createGrepTool();
