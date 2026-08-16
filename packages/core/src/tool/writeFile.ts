import path from "node:path";
import fs from "fs-extra";
import { z } from "zod";
import type { Tool } from "./types.js";
import {
  assertCreatablePathWithinRoot,
  WorkspaceContentSchema,
  WorkspacePathSchema,
} from "./utils.js";

const parameters = z
  .object({
    path: WorkspacePathSchema,
    content: WorkspaceContentSchema,
  })
  .strict();

export function createWriteFileTool(root: string): Tool<typeof parameters> {
  return {
    name: "writeFile",
    description:
      "Write content to a file at the given path, relative to the project root. Creates parent directories if needed.",
    parameters,
    async execute({ path: filePath, content }) {
      const resolved = path.resolve(root, filePath);
      await assertCreatablePathWithinRoot(resolved, root);

      await fs.ensureDir(path.dirname(resolved));
      await fs.writeFile(resolved, content, "utf-8");

      return `Successfully wrote ${content.length} characters to ${filePath}`;
    },
  };
}
