import path from "node:path";
import { fileURLToPath } from "node:url";
import { getConfig } from "@agent-harness/core";
import { Router } from "express";
import { z } from "zod";
import { IdentifierSchema, validateRequest } from "../http/validation.js";
import { PluginRegistry } from "../plugin/registry.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, "../../../..");

const pluginsDir =
  process.env.PLUGINS_DIR ?? path.join(rootDir, "packages", "dashboard", "src", "plugins");

const registry = new PluginRegistry(pluginsDir, getConfig().ROOT);

export const pluginsRouter = Router();

const PluginUpdateSchema = z
  .object({
    params: z.object({ name: IdentifierSchema }).strict(),
    body: z.object({ enabled: z.boolean() }).strict(),
  })
  .strict();

pluginsRouter.get("/", (_req, res) => {
  res.json(registry.list());
});

pluginsRouter.put("/:name", (req, res) => {
  const request = validateRequest(PluginUpdateSchema, { params: req.params, body: req.body }, res);
  if (!request) return;
  const { name } = request.params;
  const { enabled } = request.body;

  const plugin = registry.setEnabled(name, enabled);
  if (!plugin) {
    res.status(404).json({ error: `Plugin "${name}" not found` });
    return;
  }

  res.json(plugin);
});
