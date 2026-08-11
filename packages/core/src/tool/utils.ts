import path from "node:path";
import fs from "fs-extra";
import { z } from "zod";
import { isRecord } from "../validation.js";

export const MAX_WORKSPACE_FILE_BYTES = 10_000_000;
export const MAX_TOOL_ENTRIES = 10_000;
export const WorkspacePathSchema = z
  .string()
  .min(1)
  .max(2_048)
  .refine((value) => !value.includes("\0"), "must not contain a null byte");
export const WorkspaceContentSchema = z
  .string()
  .max(MAX_WORKSPACE_FILE_BYTES)
  .refine(
    (value) => Buffer.byteLength(value, "utf8") <= MAX_WORKSPACE_FILE_BYTES,
    "encoded content exceeds 10 MB",
  );

export function assertWithinRoot(resolved: string, root: string): void {
  const normalizedRoot = path.resolve(root);
  const normalizedPath = path.resolve(resolved);
  const relative = path.relative(normalizedRoot, normalizedPath);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`Path "${resolved}" is outside the allowed root "${normalizedRoot}"`);
  }
}

/** Authorize an existing path after resolving every symlink in the path. */
export async function assertExistingPathWithinRoot(resolved: string, root: string): Promise<void> {
  assertWithinRoot(resolved, root);
  const [realRoot, realPath] = await Promise.all([fs.realpath(root), fs.realpath(resolved)]);
  assertWithinRoot(realPath, realRoot);
}

/** Authorize a write destination by checking its nearest existing ancestor. */
export async function assertCreatablePathWithinRoot(resolved: string, root: string): Promise<void> {
  assertWithinRoot(resolved, root);
  let existing = path.resolve(resolved);
  while (!(await pathEntryExists(existing))) {
    const parent = path.dirname(existing);
    if (parent === existing) break;
    existing = parent;
  }
  await assertExistingPathWithinRoot(existing, root);
}

async function pathEntryExists(candidate: string): Promise<boolean> {
  try {
    await fs.lstat(candidate);
    return true;
  } catch (error) {
    if (isRecord(error) && error.code === "ENOENT") return false;
    throw error;
  }
}
