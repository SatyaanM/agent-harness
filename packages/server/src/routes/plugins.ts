import path from "node:path";
import { fileURLToPath } from "node:url";
import { Router } from "express";
import { getConfig } from "@agent-harness/core";
import { PluginRegistry } from "../plugin/registry.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, "../../../..");

const pluginsDir =
  process.env["PLUGINS_DIR"] ??
  path.join(rootDir, "packages", "dashboard", "src", "plugins");

const registry = new PluginRegistry(pluginsDir, getConfig().ROOT);

export const pluginsRouter = Router();

pluginsRouter.get("/", (_req, res) => {
  res.json(registry.list());
});

pluginsRouter.put("/:name", (req, res) => {
  const { enabled } = req.body as { enabled?: boolean };
  if (typeof enabled !== "boolean") {
    res.status(400).json({ error: "enabled must be a boolean" });
    return;
  }

  const plugin = registry.setEnabled(req.params.name, enabled);
  if (!plugin) {
    res.status(404).json({ error: `Plugin "${req.params.name}" not found` });
    return;
  }

  res.json(plugin);
});
