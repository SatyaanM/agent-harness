import { z } from "zod";
import path from "node:path";
import fs from "fs-extra";
import type { Tool } from "./types.js";

function assertWithinRoot(resolvedPath: string, root: string): void {
  const normalized = path.resolve(resolvedPath);
  const normalizedRoot = path.resolve(root);
  if (!normalized.startsWith(normalizedRoot + path.sep) && normalized !== normalizedRoot) {
    throw new Error(`Path "${resolvedPath}" is outside the allowed root directory`);
  }
}

const parameters = z.object({
  path: z.string(),
});

export function createListDirectoryTool(root: string): Tool<typeof parameters> {
  return {
    name: "listDirectory",
    description: "List files and subdirectories at the given path, relative to the project root.",
    parameters,
    async execute({ path: dirPath }) {
      const resolved = path.resolve(root, dirPath);
      assertWithinRoot(resolved, root);

      if (!await fs.pathExists(resolved)) {
        return `Error: Directory not found: ${dirPath}`;
      }

      const stat = await fs.stat(resolved);
      if (!stat.isDirectory()) {
        return `Error: Path is not a directory: ${dirPath}`;
      }

      const entries = await fs.readdir(resolved, { withFileTypes: true });
      const lines: string[] = [];

      for (const entry of entries) {
        const type = entry.isDirectory() ? "dir" : "file";
        lines.push(`[${type}] ${entry.name}`);
      }

      if (lines.length === 0) {
        return `Directory is empty: ${dirPath}`;
      }

      return lines.join("\n");
    },
  };
}
