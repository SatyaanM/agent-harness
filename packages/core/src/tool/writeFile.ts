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
  content: z.string(),
});

export function createWriteFileTool(root: string): Tool<typeof parameters> {
  return {
    name: "writeFile",
    description:
      "Write content to a file at the given path, relative to the project root. Creates parent directories if needed.",
    parameters,
    async execute({ path: filePath, content }) {
      const resolved = path.resolve(root, filePath);
      assertWithinRoot(resolved, root);

      await fs.ensureDir(path.dirname(resolved));
      await fs.writeFile(resolved, content, "utf-8");

      return `Successfully wrote ${content.length} characters to ${filePath}`;
    },
  };
}
