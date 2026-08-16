import fs from "fs-extra";
import { BoundaryValidationError } from "../validation.js";

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
  const stream = fs.createReadStream(filePath);
  const chunks: Buffer[] = [];
  let totalBytes = 0;
  try {
    for await (const chunk of stream) {
      if (!(chunk instanceof Uint8Array)) {
        throw new BoundaryValidationError(boundary, "file stream returned invalid data");
      }
      totalBytes += chunk.byteLength;
      if (totalBytes > maxBytes) {
        stream.destroy();
        throw new BoundaryValidationError(boundary, `file exceeds ${maxBytes} bytes`);
      }
      chunks.push(Buffer.from(chunk));
    }
    return Buffer.concat(chunks, totalBytes);
  } catch (error) {
    stream.destroy();
    throw error;
  }
}

export function readUtf8FileBoundedSync(
  filePath: string,
  maxBytes: number,
  boundary: string,
): string {
  validateByteLimit(maxBytes);
  const stat = fs.statSync(filePath);
  if (stat.size > maxBytes) {
    throw new BoundaryValidationError(boundary, `file exceeds ${maxBytes} bytes`);
  }
  const text = fs.readFileSync(filePath, "utf8");
  if (Buffer.byteLength(text, "utf8") > maxBytes) {
    throw new BoundaryValidationError(boundary, `file exceeds ${maxBytes} bytes`);
  }
  return text;
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
