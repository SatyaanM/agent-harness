import path from "node:path";
import fg from "fast-glob";
import { z } from "zod";
import { getConfig } from "../config.js";
import type { Tool } from "./types.js";
import { assertWithinRoot } from "./utils.js";

const GlobParams = z.object({
  pattern: z.string().min(1),
  cwd: z.string().optional(),
});

export const globTool: Tool<typeof GlobParams> = {
  name: "glob",
  description:
    "Find files by glob pattern. Returns matching file paths relative to the project root.",
  parameters: GlobParams,

  async execute(args) {
    const root = getConfig().ROOT;
    const cwd = args.cwd ? path.resolve(root, args.cwd) : root;
    assertWithinRoot(cwd, root);

    const matches = await fg(args.pattern, { cwd, dot: false, absolute: false });
    const normalized = matches.map((m) => m.replace(/\\/g, "/"));

    if (normalized.length === 0) {
      return "No files matched the pattern.";
    }

    return normalized.join("\n");
  },
};
