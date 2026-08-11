import path from "node:path";
import fs from "fs-extra";
import { z } from "zod";
import { readUtf8FileBounded } from "../filesystem/bounded-io.js";
import type { Tool } from "./types.js";
import {
  assertExistingPathWithinRoot,
  assertWithinRoot,
  MAX_WORKSPACE_FILE_BYTES,
  WorkspacePathSchema,
} from "./utils.js";

const parameters = z.object({ path: WorkspacePathSchema }).strict();

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
      await assertExistingPathWithinRoot(resolved, root);

      const stat = await fs.stat(resolved);
      if (stat.isDirectory()) {
        return `Error: Path is a directory, not a file: ${filePath}`;
      }
      if (stat.size > MAX_WORKSPACE_FILE_BYTES) {
        return "Error: File exceeds maximum readable size (10 MB).";
      }

      const content = await readUtf8FileBounded(
        resolved,
        MAX_WORKSPACE_FILE_BYTES,
        "readFile content",
      );
      return content;
    },
  };
}
