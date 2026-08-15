import path from "node:path";
import fg from "fast-glob";
import { z } from "zod";
import { getConfig } from "../config.js";
import type { Tool } from "./types.js";
import {
  assertExistingPathWithinRoot,
  assertWithinRoot,
  MAX_TOOL_ENTRIES,
  WorkspacePathSchema,
} from "./utils.js";

const GlobParams = z
  .object({
    pattern: z
      .string()
      .min(1)
      .max(2_048)
      .refine((value) => !value.includes("\0"), "must not contain a null byte")
      .refine(isContainedGlobPattern, "must be relative and must not traverse outside its root"),
    cwd: WorkspacePathSchema.optional(),
  })
  .strict();

export const globTool: Tool<typeof GlobParams> = {
  name: "glob",
  description:
    "Find files by glob pattern. Returns matching file paths relative to the project root.",
  parameters: GlobParams,

  async execute(args) {
    const root = getConfig().ROOT;
    const cwd = args.cwd ? path.resolve(root, args.cwd) : root;
    assertWithinRoot(cwd, root);
    await assertExistingPathWithinRoot(cwd, root);

    const matches = fg.stream(args.pattern, {
      cwd,
      dot: false,
      absolute: false,
      followSymbolicLinks: false,
    });
    const normalized: string[] = [];
    let truncated = false;
    for await (const match of matches) {
      if (typeof match !== "string") continue;
      await assertExistingPathWithinRoot(path.resolve(cwd, match), root);
      normalized.push(match.replace(/\\/g, "/"));
      if (normalized.length >= MAX_TOOL_ENTRIES) {
        truncated = true;
        break;
      }
    }

    if (normalized.length === 0) {
      return "No files matched the pattern.";
    }

    if (truncated) {
      normalized.push(`[truncated: glob exceeds ${MAX_TOOL_ENTRIES} entries]`);
    }
    return normalized.join("\n");
  },
};

function isContainedGlobPattern(value: string): boolean {
  const normalized = value.replaceAll("\\", "/");
  const hasAbsoluteBranch = /(?:^|[,{(|])(?:[A-Za-z]:\/|\/)/u.test(normalized);
  const hasParentBranch = /(?:^|[/{,(|])\.\.(?=$|[/},)|])/u.test(normalized);
  return !hasAbsoluteBranch && !hasParentBranch;
}
