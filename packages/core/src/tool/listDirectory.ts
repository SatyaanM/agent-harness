import path from "node:path";
import fs from "fs-extra";
import { z } from "zod";
import type { Tool } from "./types.js";
import {
  assertExistingPathWithinRoot,
  assertWithinRoot,
  MAX_TOOL_ENTRIES,
  WorkspacePathSchema,
} from "./utils.js";

const parameters = z.object({ path: WorkspacePathSchema }).strict();

export function createListDirectoryTool(root: string): Tool<typeof parameters> {
  return {
    name: "listDirectory",
    description: "List files and subdirectories at the given path, relative to the project root.",
    parameters,
    async execute({ path: dirPath }) {
      const resolved = path.resolve(root, dirPath);
      assertWithinRoot(resolved, root);

      if (!(await fs.pathExists(resolved))) {
        return `Error: Directory not found: ${dirPath}`;
      }
      await assertExistingPathWithinRoot(resolved, root);

      const stat = await fs.stat(resolved);
      if (!stat.isDirectory()) {
        return `Error: Path is not a directory: ${dirPath}`;
      }

      const lines: string[] = [];
      const directory = await fs.opendir(resolved);
      for await (const entry of directory) {
        const type = entry.isDirectory() ? "dir" : "file";
        lines.push(`[${type}] ${entry.name}`);
        if (lines.length >= MAX_TOOL_ENTRIES) {
          lines.push(`[truncated: directory exceeds ${MAX_TOOL_ENTRIES} entries]`);
          break;
        }
      }

      if (lines.length === 0) {
        return `Directory is empty: ${dirPath}`;
      }

      return lines.join("\n");
    },
  };
}
