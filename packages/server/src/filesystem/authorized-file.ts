import type { Stats } from "node:fs";
import type { FileHandle } from "node:fs/promises";
import { assertExistingPathWithinRoot, readFileHandleBounded } from "@agent-harness/core";
import fs from "fs-extra";

export class AuthorizedPathChangedError extends Error {
  constructor(filePath: string, options?: ErrorOptions) {
    super(`Path "${filePath}" is not a stable authorized file`, options);
    this.name = "AuthorizedPathChangedError";
  }
}

function isSameFile(opened: Stats, current: Stats): boolean {
  return opened.dev === current.dev && opened.ino === current.ino;
}

export async function validateAuthorizedFileHandle(
  handle: FileHandle,
  filePath: string,
  root: string,
): Promise<Stats> {
  try {
    await assertExistingPathWithinRoot(filePath, root);
    const [opened, current] = await Promise.all([handle.stat(), fs.stat(filePath)]);
    if (!isSameFile(opened, current)) throw new AuthorizedPathChangedError(filePath);
    return opened;
  } catch (error) {
    if (error instanceof AuthorizedPathChangedError) throw error;
    throw new AuthorizedPathChangedError(filePath, { cause: error });
  }
}

export async function openAuthorizedExistingFile(
  filePath: string,
  root: string,
  flags: "r" | "r+",
): Promise<{ handle: FileHandle; stat: Stats }> {
  const handle = await fs.promises.open(filePath, flags);
  try {
    const stat = await validateAuthorizedFileHandle(handle, filePath, root);
    return { handle, stat };
  } catch (error) {
    await handle.close();
    throw error;
  }
}

export async function readAuthorizedFileBounded(
  handle: FileHandle,
  maxBytes: number,
  boundary: string,
): Promise<Buffer> {
  return readFileHandleBounded(handle, maxBytes, boundary);
}

export async function overwriteAuthorizedFile(
  handle: FileHandle,
  filePath: string,
  root: string,
  content: string,
): Promise<void> {
  await validateAuthorizedFileHandle(handle, filePath, root);
  const bytes = Buffer.from(content, "utf8");
  let offset = 0;
  while (offset < bytes.byteLength) {
    const { bytesWritten } = await handle.write(bytes, offset, bytes.byteLength - offset, offset);
    if (bytesWritten === 0) throw new Error("Unable to make progress while writing file");
    offset += bytesWritten;
  }
  await handle.truncate(bytes.byteLength);
  await handle.sync();
  await validateAuthorizedFileHandle(handle, filePath, root);
}
