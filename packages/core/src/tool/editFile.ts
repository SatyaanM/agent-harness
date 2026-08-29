import type { Stats } from "node:fs";
import type { FileHandle } from "node:fs/promises";
import path from "node:path";
import fs from "fs-extra";
import { z } from "zod";
import { readFileHandleBounded } from "../filesystem/bounded-io.js";
import { isRecord } from "../validation.js";
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

function isSameFile(opened: Stats, current: Stats): boolean {
  return opened.dev === current.dev && opened.ino === current.ino;
}

async function assertHandleMatchesAuthorizedPath(
  handle: FileHandle,
  resolved: string,
  root: string,
): Promise<Stats> {
  await assertExistingPathWithinRoot(resolved, root);
  const [opened, current] = await Promise.all([handle.stat(), fs.stat(resolved)]);
  if (!isSameFile(opened, current)) {
    throw new Error(`Path "${resolved}" changed while it was being edited`);
  }
  return opened;
}

async function overwriteHandle(handle: FileHandle, content: string): Promise<void> {
  const bytes = Buffer.from(content, "utf8");
  let offset = 0;
  while (offset < bytes.byteLength) {
    const { bytesWritten } = await handle.write(bytes, offset, bytes.byteLength - offset, offset);
    if (bytesWritten === 0) throw new Error("Unable to make progress while writing edited file");
    offset += bytesWritten;
  }
  await handle.truncate(bytes.byteLength);
  await handle.sync();
}

export function createEditFileTool(root: string): Tool<typeof parameters> {
  return {
    name: "editFile",
    description:
      "Perform a targeted text replacement in a file. Replaces the first occurrence of oldText with newText.",
    parameters,
    async execute({ path: filePath, oldText, newText }) {
      const resolved = path.resolve(root, filePath);
      assertWithinRoot(resolved, root);

      let handle: FileHandle;
      try {
        handle = await fs.promises.open(resolved, "r+");
      } catch (error) {
        if (isRecord(error) && error.code === "ENOENT") {
          return `Error: File not found: ${filePath}`;
        }
        if (isRecord(error) && (error.code === "EISDIR" || error.code === "EACCES")) {
          const stat = await fs.stat(resolved).catch(() => undefined);
          if (stat?.isDirectory()) return `Error: Path is not a file: ${filePath}`;
        }
        throw error;
      }
      try {
        const stat = await assertHandleMatchesAuthorizedPath(handle, resolved, root);
        if (!stat.isFile()) return `Error: Path is not a file: ${filePath}`;
        if (stat.size > MAX_WORKSPACE_FILE_BYTES) {
          return "Error: File exceeds maximum editable size (10 MB).";
        }

        const content = (
          await readFileHandleBounded(handle, MAX_WORKSPACE_FILE_BYTES, "editFile content")
        ).toString("utf8");
        const index = content.indexOf(oldText);

        if (index === -1) {
          return `Error: oldText not found in ${filePath}`;
        }

        const updated = content.slice(0, index) + newText + content.slice(index + oldText.length);
        if (Buffer.byteLength(updated, "utf8") > MAX_WORKSPACE_FILE_BYTES) {
          return "Error: Edited file would exceed maximum size (10 MB).";
        }
        await assertHandleMatchesAuthorizedPath(handle, resolved, root);
        await overwriteHandle(handle, updated);
        await assertHandleMatchesAuthorizedPath(handle, resolved, root);

        const diff = buildDiff(filePath, oldText, newText);
        return `Successfully edited ${filePath}\n${diff}`;
      } finally {
        await handle.close();
      }
    },
  };
}
