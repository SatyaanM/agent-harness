import path from "node:path";
import fs from "fs-extra";
import { z } from "zod";
import { readUtf8FileBounded } from "../filesystem/bounded-io.js";
import type { Tool } from "./types.js";
import {
  assertExistingPathWithinRoot,
  assertWithinRoot,
  MAX_WORKSPACE_FILE_BYTES,
  WorkspaceContentSchema,
  WorkspacePathSchema,
} from "./utils.js";

function buildDiff(filePath: string, oldText: string, newText: string): string {
  const oldLines = oldText.split("\n");
  const newLines = newText.split("\n");
  const lines: string[] = [`--- ${filePath}`, `+++ ${filePath}`];

  for (let i = 0; i < Math.max(oldLines.length, newLines.length); i++) {
    const oldLine = oldLines[i];
    const newLine = newLines[i];
    if (oldLine !== newLine) {
      if (oldLine !== undefined) lines.push(`- ${oldLine}`);
      if (newLine !== undefined) lines.push(`+ ${newLine}`);
    }
  }

  return lines.join("\n");
}

const parameters = z
  .object({
    path: WorkspacePathSchema,
    oldText: WorkspaceContentSchema,
    newText: WorkspaceContentSchema,
  })
  .strict();

export function createEditFileTool(root: string): Tool<typeof parameters> {
  return {
    name: "editFile",
    description:
      "Perform a targeted text replacement in a file. Replaces the first occurrence of oldText with newText.",
    parameters,
    async execute({ path: filePath, oldText, newText }) {
      const resolved = path.resolve(root, filePath);
      assertWithinRoot(resolved, root);

      if (!(await fs.pathExists(resolved))) {
        return `Error: File not found: ${filePath}`;
      }
      await assertExistingPathWithinRoot(resolved, root);

      const stat = await fs.stat(resolved);
      if (!stat.isFile()) return `Error: Path is not a file: ${filePath}`;
      if (stat.size > MAX_WORKSPACE_FILE_BYTES) {
        return "Error: File exceeds maximum editable size (10 MB).";
      }

      const content = await readUtf8FileBounded(
        resolved,
        MAX_WORKSPACE_FILE_BYTES,
        "editFile content",
      );
      const index = content.indexOf(oldText);

      if (index === -1) {
        return `Error: oldText not found in ${filePath}`;
      }

      const updated = content.replace(oldText, newText);
      if (Buffer.byteLength(updated, "utf8") > MAX_WORKSPACE_FILE_BYTES) {
        return "Error: Edited file would exceed maximum size (10 MB).";
      }
      await fs.writeFile(resolved, updated, "utf-8");

      const diff = buildDiff(filePath, oldText, newText);
      return `Successfully edited ${filePath}\n${diff}`;
    },
  };
}
