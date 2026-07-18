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

router.get("/:id", async (req, res) => {
  const config = getConfig();
  const inboxManager = getInboxManager();
  const filePath = path.join(config.INBOX_ROOT, req.params["id"]!);
  if (!(await fs.pathExists(filePath))) {
    res.status(404).json({ error: "Inbox item not found" });
    return;
  }
  const stat = await fs.stat(filePath);
  const content = await fs.readFile(filePath, "utf-8");
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
