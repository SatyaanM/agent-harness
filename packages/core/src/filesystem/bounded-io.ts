import type { FileHandle } from "node:fs/promises";
import fs from "fs-extra";
import { BoundaryValidationError } from "../validation.js";

const READ_CHUNK_BYTES = 64 * 1_024;

function validateByteLimit(maxBytes: number): void {
  if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0) {
    throw new RangeError("File byte limit must be a positive safe integer");
  }
}

export async function readUtf8FileBounded(
  filePath: string,
  maxBytes: number,
  boundary: string,
): Promise<string> {
  return (await readFileBounded(filePath, maxBytes, boundary)).toString("utf8");
}

export async function readFileBounded(
  filePath: string,
  maxBytes: number,
  boundary: string,
): Promise<Buffer> {
  validateByteLimit(maxBytes);
  const handle = await fs.promises.open(filePath, "r");
  try {
    return await readFileHandleBounded(handle, maxBytes, boundary);
  } finally {
    await handle.close();
  }
}

export async function readFileHandleBounded(
  handle: FileHandle,
  maxBytes: number,
  boundary: string,
): Promise<Buffer> {
  validateByteLimit(maxBytes);
  const initialStat = await handle.stat();
  if (initialStat.size > maxBytes) {
    throw new BoundaryValidationError(boundary, `file exceeds ${maxBytes} bytes`);
  }

  const chunks: Buffer[] = [];
  let totalBytes = 0;
  let position = 0;
  const readBuffer = Buffer.allocUnsafe(Math.min(READ_CHUNK_BYTES, maxBytes + 1));
  while (true) {
    const { bytesRead } = await handle.read(readBuffer, 0, readBuffer.byteLength, position);
    if (bytesRead === 0) break;
    totalBytes += bytesRead;
    if (totalBytes > maxBytes) {
      throw new BoundaryValidationError(boundary, `file exceeds ${maxBytes} bytes`);
    }
    chunks.push(Buffer.from(readBuffer.subarray(0, bytesRead)));
    position += bytesRead;
  }
  return Buffer.concat(chunks, totalBytes);
}

export function readUtf8FileBoundedSync(
  filePath: string,
  maxBytes: number,
  boundary: string,
): string {
  validateByteLimit(maxBytes);
  const descriptor = fs.openSync(filePath, "r");
  try {
    const stat = fs.fstatSync(descriptor);
    if (stat.size > maxBytes) {
      throw new BoundaryValidationError(boundary, `file exceeds ${maxBytes} bytes`);
    }
    const text = fs.readFileSync(descriptor, "utf8");
    if (Buffer.byteLength(text, "utf8") > maxBytes) {
      throw new BoundaryValidationError(boundary, `file exceeds ${maxBytes} bytes`);
    }
    return text;
  } finally {
    fs.closeSync(descriptor);
  }
}

export function stringifyJsonBounded(value: unknown, maxBytes: number, boundary: string): string {
  validateByteLimit(maxBytes);
  let text: string | undefined;
  try {
    text = JSON.stringify(value, null, 2);
  } catch (error) {
    throw new BoundaryValidationError(boundary, "value is not JSON serializable", { cause: error });
  }
  if (text === undefined) {
    throw new BoundaryValidationError(boundary, "value is not JSON serializable");
  }
  if (Buffer.byteLength(text, "utf8") > maxBytes) {
    throw new BoundaryValidationError(boundary, `serialized data exceeds ${maxBytes} bytes`);
  }
  return text;
}
