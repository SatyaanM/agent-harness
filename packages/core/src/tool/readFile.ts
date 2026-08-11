import path from "node:path";
import fs from "fs-extra";
import { z } from "zod";
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

export function createReadFileTool(root: string): Tool<typeof parameters> {
  return {
    name: "readFile",
    description: "Read the contents of a file at the given path, relative to the project root.",
    parameters,
    async execute({ path: filePath }) {
      const resolved = path.resolve(root, filePath);
      assertWithinRoot(resolved, root);

      if (!(await fs.pathExists(resolved))) {
        return `Error: File not found: ${filePath}`;
      }

      const stat = await fs.stat(resolved);
      if (stat.isDirectory()) {
        return `Error: Path is a directory, not a file: ${filePath}`;
      }

      const content = await fs.readFile(resolved, "utf-8");
      return content;
    },
  };
}
