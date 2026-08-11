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

const parameters = z.object({
  path: z.string(),
  oldText: z.string(),
  newText: z.string(),
});

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

      const content = await fs.readFile(resolved, "utf-8");
      const index = content.indexOf(oldText);

      if (index === -1) {
        return `Error: oldText not found in ${filePath}`;
      }

      const updated = content.replace(oldText, newText);
      await fs.writeFile(resolved, updated, "utf-8");

      const diff = buildDiff(filePath, oldText, newText);
      return `Successfully edited ${filePath}\n${diff}`;
    },
  };
}
