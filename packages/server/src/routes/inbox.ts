import type { Dirent } from "node:fs";
import path from "node:path";
import {
  assertCreatablePathWithinRoot,
  assertExistingPathWithinRoot,
  getConfig,
  InboxManager,
  isRecord,
  MAX_INBOX_FILE_BYTES,
} from "@agent-harness/core";
import { type Response, Router } from "express";
import fs from "fs-extra";
import { z } from "zod";
import {
  AuthorizedPathChangedError,
  openAuthorizedExistingFile,
  overwriteAuthorizedFile,
  readAuthorizedFileBounded,
} from "../filesystem/authorized-file.js";
import { asyncHandler } from "../http/async-handler.js";
import { createRouteLimiters, type RouteLimiters } from "../http/rate-limit.js";
import { IdentifierSchema, RelativePathSchema, validateRequest } from "../http/validation.js";

const NonEmptyRelativePathSchema = RelativePathSchema.refine(
  (value) => value.length > 0,
  "must not be empty",
);
const FileQuerySchema = z.object({ path: NonEmptyRelativePathSchema }).passthrough();
const MAX_INBOX_ENTRIES = 10_000;
const FileContentSchema = z
  .object({
    content: z
      .string()
      .max(MAX_INBOX_FILE_BYTES)
      .refine(
        (content) => Buffer.byteLength(content, "utf8") <= MAX_INBOX_FILE_BYTES,
        "encoded content exceeds 10 MB",
      ),
  })
  .strict();
const MoveSchema = z
  .object({ from: NonEmptyRelativePathSchema, to: RelativePathSchema.default("") })
  .strict();
const DirectorySchema = z.object({ path: NonEmptyRelativePathSchema }).strict();
const OpenSchema = z.object({ path: RelativePathSchema.optional() }).strict();
const ItemParamsSchema = z.object({ id: IdentifierSchema }).strict();
const TrackItemSchema = z
  .object({
    title: z.string().min(1).max(512),
    type: z.string().min(1).max(128),
    authorAgent: IdentifierSchema,
  })
  .strict();

function getInboxManager() {
  const config = getConfig();
  fs.ensureDirSync(config.INBOX_ROOT);
  return new InboxManager(config.INBOX_ROOT);
}

async function authorizeExisting(filePath: string, root: string, res: Response): Promise<boolean> {
  try {
    await assertExistingPathWithinRoot(filePath, root);
    return true;
  } catch {
    res.status(403).json({ error: "Invalid path" });
    return false;
  }
}

async function authorizeCreatable(filePath: string, root: string, res: Response): Promise<boolean> {
  try {
    await assertCreatablePathWithinRoot(filePath, root);
    return true;
  } catch {
    res.status(403).json({ error: "Invalid path" });
    return false;
  }
}

async function resolveMoveDestination(
  toDir: string,
  rootResolved: string,
  res: Response,
): Promise<string | undefined> {
  if (!toDir) return rootResolved;

  const toPath = path.resolve(rootResolved, toDir);
  if (toPath !== rootResolved && !toPath.startsWith(rootResolved + path.sep)) {
    res.status(403).json({ error: "Invalid destination path" });
    return undefined;
  }
  const toStat = await fs.stat(toPath).catch(() => null);
  if (!toStat?.isDirectory()) {
    res.status(400).json({ error: "Destination is not a directory" });
    return undefined;
  }
  if (!(await authorizeExisting(toPath, rootResolved, res))) return undefined;
  return toPath;
}

function rejectOversizedFile(size: number, res: Response): boolean {
  if (size <= MAX_INBOX_FILE_BYTES) return false;
  res.status(413).json({ error: "Inbox item exceeds maximum size (10 MB)" });
  return true;
}

async function openExistingRouteFile(
  filePath: string,
  root: string,
  flags: "r" | "r+",
  notFoundMessage: string,
  res: Response,
) {
  try {
    return await openAuthorizedExistingFile(filePath, root, flags);
  } catch (error) {
    if (isRecord(error) && error.code === "ENOENT") {
      res.status(404).json({ error: notFoundMessage });
      return undefined;
    }
    if (error instanceof AuthorizedPathChangedError) {
      res.status(403).json({ error: "Invalid path" });
      return undefined;
    }
    throw error;
  }
}

export function createInboxRouter(limiters: RouteLimiters = createRouteLimiters()): Router {
  const router = Router();

  interface TreeEntry {
    name: string;
    path: string;
    absPath: string;
    type: "file" | "dir";
    size?: number;
    lastModified?: string;
    metadata?: unknown;
    children?: TreeEntry[];
  }

  interface TraversalBudget {
    exceeded: boolean;
    remaining: number;
  }

  router.get(
    "/",
    limiters.filesystemRead,
    asyncHandler(async (_req, res) => {
      const config = getConfig();
      const inboxManager = getInboxManager();
      const items = await inboxManager.listItems();
      const files: Dirent[] = [];
      const directory = await fs.opendir(config.INBOX_ROOT);
      for await (const entry of directory) {
        if (entry.name.startsWith(".") || entry.isSymbolicLink()) continue;
        files.push(entry);
        if (files.length > MAX_INBOX_ENTRIES) {
          res.status(413).json({ error: "Inbox exceeds maximum entry count" });
          return;
        }
      }
      const enriched = await Promise.all(
        files.map(async (entry) => {
          const stat = await fs.stat(path.join(config.INBOX_ROOT, entry.name));
          const meta = items.find((metadata) => metadata.id === entry.name);
          return {
            id: entry.name,
            name: entry.name,
            type: path.extname(entry.name).slice(1) || "text",
            size: stat.size,
            lastModified: stat.mtime.toISOString(),
            metadata: meta ?? null,
          };
        }),
      );
      res.json(enriched);
    }),
  );

  router.get(
    "/tree",
    limiters.filesystemRead,
    asyncHandler(async (_req, res) => {
      const config = getConfig();
      const inboxManager = getInboxManager();
      const items = await inboxManager.listItems();
      const budget: TraversalBudget = { exceeded: false, remaining: MAX_INBOX_ENTRIES };
      const tree = await walkTree(config.INBOX_ROOT, "", items, budget);
      if (budget.exceeded) {
        res.status(413).json({ error: "Inbox tree exceeds maximum entry count" });
        return;
      }
      res.json(tree);
    }),
  );

  router.get(
    "/file",
    limiters.filesystemRead,
    asyncHandler(async (req, res) => {
      const query = validateRequest(FileQuerySchema, req.query, res);
      if (!query) return;
      const config = getConfig();
      const inboxManager = getInboxManager();
      const rel = query.path;

      const rootResolved = path.resolve(config.INBOX_ROOT);
      const filePath = path.resolve(rootResolved, rel);
      if (filePath !== rootResolved && !filePath.startsWith(rootResolved + path.sep)) {
        res.status(403).json({ error: "Invalid path" });
        return;
      }
      const opened = await openExistingRouteFile(
        filePath,
        rootResolved,
        "r",
        "Inbox item not found",
        res,
      );
      if (!opened) return;
      try {
        if (!opened.stat.isFile()) {
          res.status(404).json({ error: "Inbox item not found" });
          return;
        }
        if (rejectOversizedFile(opened.stat.size, res)) return;
        const content = await readItemContent(opened.handle, filePath);
        const metadata = await inboxManager.getItemMetadata(rel);
        res.json({
          id: rel,
          name: path.basename(rel),
          type: path.extname(rel).slice(1) || "text",
          size: opened.stat.size,
          lastModified: opened.stat.mtime.toISOString(),
          content,
          metadata,
        });
      } finally {
        await opened.handle.close();
      }
    }),
  );

  router.put(
    "/file",
    limiters.filesystemWrite,
    asyncHandler(async (req, res) => {
      const query = validateRequest(FileQuerySchema, req.query, res);
      if (!query) return;
      const body = validateRequest(FileContentSchema, req.body, res);
      if (!body) return;
      const config = getConfig();
      const inboxManager = getInboxManager();
      const rel = query.path;
      const { content } = body;

      const rootResolved = path.resolve(config.INBOX_ROOT);
      const filePath = path.resolve(rootResolved, rel);
      if (filePath !== rootResolved && !filePath.startsWith(rootResolved + path.sep)) {
        res.status(403).json({ error: "Invalid path" });
        return;
      }
      const opened = await openExistingRouteFile(
        filePath,
        rootResolved,
        "r+",
        "Inbox item not found",
        res,
      );
      if (!opened) return;
      try {
        if (!opened.stat.isFile()) {
          res.status(404).json({ error: "Inbox item not found" });
          return;
        }
        await overwriteAuthorizedFile(opened.handle, filePath, rootResolved, content);
      } finally {
        await opened.handle.close();
      }
      const updated = await inboxManager.bumpVersion(rel);
      res.json({ success: true, metadata: updated });
    }),
  );

  router.post(
    "/move",
    limiters.filesystemWrite,
    asyncHandler(async (req, res) => {
      const body = validateRequest(MoveSchema, req.body, res);
      if (!body) return;
      const config = getConfig();
      const inboxManager = getInboxManager();
      const { from, to: toDir } = body;

      const rootResolved = path.resolve(config.INBOX_ROOT);
      const fromPath = path.resolve(rootResolved, from);
      if (fromPath !== rootResolved && !fromPath.startsWith(rootResolved + path.sep)) {
        res.status(403).json({ error: "Invalid source path" });
        return;
      }
      if (!(await fs.pathExists(fromPath))) {
        res.status(404).json({ error: "Source not found" });
        return;
      }
      if (!(await authorizeExisting(fromPath, rootResolved, res))) return;

      const toPath = await resolveMoveDestination(toDir, rootResolved, res);
      if (!toPath) return;

      const base = path.basename(fromPath);
      const destPath = path.join(toPath, base);
      if (!(await authorizeCreatable(destPath, rootResolved, res))) return;
      if (path.resolve(destPath) === path.resolve(fromPath)) {
        res.status(400).json({ error: "Cannot move an item into itself" });
        return;
      }
      if (path.resolve(destPath).startsWith(path.resolve(fromPath) + path.sep)) {
        res.status(400).json({ error: "Cannot move a folder into itself" });
        return;
      }
      if (await fs.pathExists(destPath)) {
        res.status(409).json({ error: "An item with that name already exists at the destination" });
        return;
      }

      await fs.move(fromPath, destPath);

      const newId = toDir ? `${toDir.replace(/\\/g, "/")}/${base}` : base;
      await inboxManager.renameKey(from, newId);

      res.json({ success: true, from, to: newId });
    }),
  );

  router.post(
    "/dir",
    limiters.filesystemWrite,
    asyncHandler(async (req, res) => {
      const body = validateRequest(DirectorySchema, req.body, res);
      if (!body) return;
      const config = getConfig();
      const { path: rel } = body;
      const rootResolved = path.resolve(config.INBOX_ROOT);
      const dirPath = path.resolve(rootResolved, rel);
      if (dirPath !== rootResolved && !dirPath.startsWith(rootResolved + path.sep)) {
        res.status(403).json({ error: "Invalid path" });
        return;
      }
      if (!(await authorizeCreatable(dirPath, rootResolved, res))) return;
      await fs.ensureDir(dirPath);
      res.json({ success: true, path: rel });
    }),
  );

  router.delete(
    "/file",
    limiters.filesystemWrite,
    asyncHandler(async (req, res) => {
      const query = validateRequest(FileQuerySchema, req.query, res);
      if (!query) return;
      const config = getConfig();
      const inboxManager = getInboxManager();
      const rel = query.path;
      const rootResolved = path.resolve(config.INBOX_ROOT);
      const filePath = path.resolve(rootResolved, rel);
      if (filePath !== rootResolved && !filePath.startsWith(rootResolved + path.sep)) {
        res.status(403).json({ error: "Invalid path" });
        return;
      }
      if (!(await fs.pathExists(filePath))) {
        res.status(404).json({ error: "Item not found" });
        return;
      }
      if (!(await authorizeExisting(filePath, rootResolved, res))) return;
      await fs.remove(filePath);
      await inboxManager.untrackRecursive(rel);
      res.json({ success: true });
    }),
  );

  router.post(
    "/open",
    limiters.processLaunch,
    asyncHandler(async (req, res) => {
      const body = validateRequest(OpenSchema, req.body, res);
      if (!body) return;
      const config = getConfig();
      const { path: rel } = body;
      const rootResolved = path.resolve(config.INBOX_ROOT);
      const target = rel ? path.resolve(rootResolved, rel) : rootResolved;
      if (target !== rootResolved && !target.startsWith(rootResolved + path.sep)) {
        res.status(403).json({ error: "Invalid path" });
        return;
      }
      if (!(await fs.pathExists(target))) {
        res.status(404).json({ error: "Item not found" });
        return;
      }
      if (!(await authorizeExisting(target, rootResolved, res))) return;
      const stat = await fs.stat(target);
      if (process.platform === "win32") {
        const args = stat.isDirectory() ? [target] : [`/select,${target}`];
        const { spawn } = await import("node:child_process");
        const child = spawn("explorer.exe", args, { detached: true });
        child.unref();
      } else {
        res.status(501).json({ error: "Open in explorer is only supported on Windows" });
        return;
      }
      res.json({ success: true });
    }),
  );

  async function walkTree(
    dir: string,
    relDir: string,
    items: Array<{ id: string }>,
    budget: TraversalBudget,
  ): Promise<TreeEntry[]> {
    const result: TreeEntry[] = [];
    const directory = await fs.opendir(dir);

    for await (const entry of directory) {
      if (entry.name.startsWith(".") || entry.isSymbolicLink()) continue;
      if (budget.remaining === 0) {
        budget.exceeded = true;
        break;
      }
      budget.remaining -= 1;
      const rel = relDir ? `${relDir}/${entry.name}` : entry.name;
      const full = path.join(dir, entry.name);

      if (entry.isDirectory()) {
        result.push({
          name: entry.name,
          path: rel,
          absPath: full,
          type: "dir",
          children: await walkTree(full, rel, items, budget),
        });
      } else if (entry.isFile()) {
        const stat = await fs.stat(full);
        result.push({
          name: entry.name,
          path: rel,
          absPath: full,
          type: "file",
          size: stat.size,
          lastModified: stat.mtime.toISOString(),
          metadata: items.find((m) => m.id === rel) ?? null,
        });
      }
      if (budget.exceeded) break;
    }

    result.sort((a, b) => {
      if (a.type !== b.type) return a.type === "dir" ? -1 : 1;
      return a.name.localeCompare(b.name);
    });

    return result;
  }

  router.get(
    "/:id",
    limiters.filesystemRead,
    asyncHandler(async (req, res) => {
      const params = validateRequest(ItemParamsSchema, req.params, res);
      if (!params) return;
      const config = getConfig();
      const inboxManager = getInboxManager();
      const itemId = params.id;
      const filePath = path.join(config.INBOX_ROOT, itemId);
      const opened = await openExistingRouteFile(
        filePath,
        config.INBOX_ROOT,
        "r",
        "Inbox item not found",
        res,
      );
      if (!opened) return;
      try {
        if (!opened.stat.isFile()) {
          res.status(404).json({ error: "Inbox item not found" });
          return;
        }
        if (rejectOversizedFile(opened.stat.size, res)) return;
        const content = await readItemContent(opened.handle, filePath);
        const metadata = await inboxManager.getItemMetadata(itemId);
        res.json({
          id: itemId,
          name: itemId,
          type: path.extname(itemId).slice(1) || "text",
          size: opened.stat.size,
          lastModified: opened.stat.mtime.toISOString(),
          content,
          metadata,
        });
      } finally {
        await opened.handle.close();
      }
    }),
  );

  router.put(
    "/:id",
    limiters.filesystemWrite,
    asyncHandler(async (req, res) => {
      const params = validateRequest(ItemParamsSchema, req.params, res);
      if (!params) return;
      const body = validateRequest(FileContentSchema, req.body, res);
      if (!body) return;
      const config = getConfig();
      const inboxManager = getInboxManager();
      const itemId = params.id;
      const filePath = path.join(config.INBOX_ROOT, itemId);
      const { content } = body;
      if (!(await authorizeCreatable(filePath, config.INBOX_ROOT, res))) return;
      await fs.writeFile(filePath, content, "utf-8");
      const updated = await inboxManager.bumpVersion(itemId);
      res.json({ success: true, metadata: updated });
    }),
  );

  router.delete(
    "/:id",
    limiters.filesystemWrite,
    asyncHandler(async (req, res) => {
      const params = validateRequest(ItemParamsSchema, req.params, res);
      if (!params) return;
      const inboxManager = getInboxManager();
      const itemId = params.id;
      const config = getConfig();
      const filePath = path.join(config.INBOX_ROOT, itemId);
      if (
        (await fs.pathExists(filePath)) &&
        !(await authorizeExisting(filePath, config.INBOX_ROOT, res))
      ) {
        return;
      }
      await inboxManager.deleteItem(itemId);
      res.json({ success: true });
    }),
  );

  router.post(
    "/:id/track",
    limiters.filesystemWrite,
    asyncHandler(async (req, res) => {
      const params = validateRequest(ItemParamsSchema, req.params, res);
      if (!params) return;
      const body = validateRequest(TrackItemSchema, req.body, res);
      if (!body) return;
      const inboxManager = getInboxManager();
      const itemId = params.id;
      const { title, type, authorAgent } = body;
      const metadata = await inboxManager.trackItem(itemId, { title, type, authorAgent });
      res.json(metadata);
    }),
  );

  const BINARY_MIME: Record<string, string> = {
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".gif": "image/gif",
    ".webp": "image/webp",
    ".svg": "image/svg+xml",
    ".pdf": "application/pdf",
  };

  async function readItemContent(
    handle: import("node:fs/promises").FileHandle,
    filePath: string,
  ): Promise<string> {
    const mime = BINARY_MIME[path.extname(filePath).toLowerCase()];
    if (!mime) {
      return (
        await readAuthorizedFileBounded(handle, MAX_INBOX_FILE_BYTES, "inbox text file")
      ).toString("utf8");
    }
    const buffer = await readAuthorizedFileBounded(
      handle,
      MAX_INBOX_FILE_BYTES,
      "inbox binary file",
    );
    return `data:${mime};base64,${buffer.toString("base64")}`;
  }

  return router;
}
