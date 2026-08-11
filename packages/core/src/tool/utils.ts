import path from "node:path";

export function assertWithinRoot(resolved: string, root: string): void {
  const normalizedRoot = path.resolve(root);
  const normalizedPath = path.resolve(resolved);
  const relative = path.relative(normalizedRoot, normalizedPath);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`Path "${resolved}" is outside the allowed root "${normalizedRoot}"`);
  }
}
