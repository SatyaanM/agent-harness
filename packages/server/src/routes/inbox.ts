import { Router } from "express";
import fs from "fs-extra";
import path from "path";
import { getConfig, InboxManager } from "@agent-harness/core";

const router = Router();

function getInboxManager() {
  const config = getConfig();
  fs.ensureDirSync(config.INBOX_ROOT);
  return new InboxManager(config.INBOX_ROOT);
}

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

router.get("/", async (_req, res) => {
  const config = getConfig();
  const inboxManager = getInboxManager();
  const items = await inboxManager.listItems();
  const files = await fs.readdir(config.INBOX_ROOT);
  const enriched = await Promise.all(
    files
      .filter((f) => !f.startsWith("."))
      .map(async (f) => {
        const stat = await fs.stat(path.join(config.INBOX_ROOT, f));
        const meta = items.find((m) => m.id === f);
        return {
          id: f,
          name: f,
          type: path.extname(f).slice(1) || "text",
          size: stat.size,
          lastModified: stat.mtime.toISOString(),
          metadata: meta ?? null,
        };
      })
  );
  res.json(enriched);
});

router.get("/tree", async (_req, res) => {
  const config = getConfig();
  const inboxManager = getInboxManager();
  const items = await inboxManager.listItems();
  const tree = await walkTree(config.INBOX_ROOT, "", items);
  res.json(tree);
});

router.get("/file", async (req, res) => {
  const config = getConfig();
  const inboxManager = getInboxManager();
  const rel = String(req.query["path"] ?? "");

  const rootResolved = path.resolve(config.INBOX_ROOT);
  const filePath = path.resolve(rootResolved, rel);
  if (filePath !== rootResolved && !filePath.startsWith(rootResolved + path.sep)) {
    res.status(403).json({ error: "Invalid path" });
    return;
  }
  if (!(await fs.pathExists(filePath))) {
    res.status(404).json({ error: "Inbox item not found" });
    return;
  }

  const stat = await fs.stat(filePath);
  const content = await readItemContent(filePath);
  const metadata = await inboxManager.getItemMetadata(rel);
  res.json({
    id: rel,
    name: path.basename(rel),
    type: path.extname(rel).slice(1) || "text",
    size: stat.size,
    lastModified: stat.mtime.toISOString(),
    content,
    metadata,
  });
});

router.put("/file", async (req, res) => {
  const config = getConfig();
  const inboxManager = getInboxManager();
  const rel = String(req.query["path"] ?? "");
  const { content } = req.body as { content?: string };

  if (typeof content !== "string") {
    res.status(400).json({ error: "content is required" });
    return;
  }

  const rootResolved = path.resolve(config.INBOX_ROOT);
  const filePath = path.resolve(rootResolved, rel);
  if (filePath !== rootResolved && !filePath.startsWith(rootResolved + path.sep)) {
    res.status(403).json({ error: "Invalid path" });
    return;
  }
  if (!(await fs.pathExists(filePath))) {
    res.status(404).json({ error: "Inbox item not found" });
    return;
  }

  await fs.writeFile(filePath, content, "utf-8");
  const updated = await inboxManager.bumpVersion(rel);
  res.json({ success: true, metadata: updated });
});

router.post("/move", async (req, res) => {
  const config = getConfig();
  const inboxManager = getInboxManager();
  const { from, to } = req.body as { from?: string; to?: string };

  if (typeof from !== "string" || !from) {
    res.status(400).json({ error: "from is required" });
    return;
  }
  const toDir = typeof to === "string" ? to : "";

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

  let toPath: string;
  if (toDir) {
    toPath = path.resolve(rootResolved, toDir);
    if (toPath !== rootResolved && !toPath.startsWith(rootResolved + path.sep)) {
      res.status(403).json({ error: "Invalid destination path" });
      return;
    }
    const toStat = await fs.stat(toPath).catch(() => null);
    if (!toStat || !toStat.isDirectory()) {
      res.status(400).json({ error: "Destination is not a directory" });
      return;
    }
  } else {
    toPath = rootResolved;
  }

  const base = path.basename(fromPath);
  const destPath = path.join(toPath, base);
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
});

router.post("/dir", async (req, res) => {
  const config = getConfig();
  const { path: rel } = req.body as { path?: string };
  if (typeof rel !== "string" || !rel) {
    res.status(400).json({ error: "path is required" });
    return;
  }
  const rootResolved = path.resolve(config.INBOX_ROOT);
  const dirPath = path.resolve(rootResolved, rel);
  if (dirPath !== rootResolved && !dirPath.startsWith(rootResolved + path.sep)) {
    res.status(403).json({ error: "Invalid path" });
    return;
  }
  await fs.ensureDir(dirPath);
  res.json({ success: true, path: rel });
});

router.delete("/file", async (req, res) => {
  const config = getConfig();
  const inboxManager = getInboxManager();
  const rel = String(req.query["path"] ?? "");
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
  await fs.remove(filePath);
  await inboxManager.untrackRecursive(rel);
  res.json({ success: true });
});

router.post("/open", async (req, res) => {
  const config = getConfig();
  const { path: rel } = req.body as { path?: string };
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
  const stat = await fs.stat(target);
  if (process.platform === "win32") {
    const args = stat.isDirectory()
      ? [target]
      : ["/select,", target];
    const { spawn } = await import("node:child_process");
    const child = spawn("explorer.exe", args, { detached: true });
    child.unref();
  } else {
    res.status(501).json({ error: "Open in explorer is only supported on Windows" });
    return;
  }
  res.json({ success: true });
});

async function walkTree(
  dir: string,
  relDir: string,
  items: Array<{ id: string }>
): Promise<TreeEntry[]> {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const result: TreeEntry[] = [];

  for (const entry of entries) {
    if (entry.name.startsWith(".")) continue;
    const rel = relDir ? `${relDir}/${entry.name}` : entry.name;
    const full = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      result.push({
        name: entry.name,
        path: rel,
        absPath: full,
        type: "dir",
        children: await walkTree(full, rel, items),
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
  }

  result.sort((a, b) => {
    if (a.type !== b.type) return a.type === "dir" ? -1 : 1;
    return a.name.localeCompare(b.name);
  });

  return result;
}

router.get("/:id", async (req, res) => {
  const config = getConfig();
  const inboxManager = getInboxManager();
  const filePath = path.join(config.INBOX_ROOT, req.params["id"]!);
  if (!(await fs.pathExists(filePath))) {
    res.status(404).json({ error: "Inbox item not found" });
    return;
  }
  const stat = await fs.stat(filePath);
  const content = await readItemContent(filePath);
  const metadata = await inboxManager.getItemMetadata(req.params["id"]!);
  res.json({
    id: req.params["id"],
    name: req.params["id"],
    type: path.extname(req.params["id"]!).slice(1) || "text",
    size: stat.size,
    lastModified: stat.mtime.toISOString(),
    content,
    metadata,
  });
});

router.put("/:id", async (req, res) => {
  const config = getConfig();
  const inboxManager = getInboxManager();
  const filePath = path.join(config.INBOX_ROOT, req.params["id"]!);
  const { content } = req.body;
  await fs.writeFile(filePath, content, "utf-8");
  const updated = await inboxManager.bumpVersion(req.params["id"]!);
  res.json({ success: true, metadata: updated });
});

router.delete("/:id", async (req, res) => {
  const inboxManager = getInboxManager();
  await inboxManager.deleteItem(req.params["id"]!);
  res.json({ success: true });
});

router.post("/:id/track", async (req, res) => {
  const inboxManager = getInboxManager();
  const { title, type, authorAgent } = req.body;
  if (!title || !type || !authorAgent) {
    res.status(400).json({ error: "Missing required fields: title, type, authorAgent" });
    return;
  }
  const metadata = await inboxManager.trackItem(req.params["id"]!, { title, type, authorAgent });
  res.json(metadata);
});

export default router;

const BINARY_MIME: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
  ".pdf": "application/pdf",
};

async function readItemContent(filePath: string): Promise<string> {
  const mime = BINARY_MIME[path.extname(filePath).toLowerCase()];
  if (!mime) {
    return fs.readFile(filePath, "utf-8");
  }
  const buffer = await fs.readFile(filePath);
  return `data:${mime};base64,${buffer.toString("base64")}`;
}
