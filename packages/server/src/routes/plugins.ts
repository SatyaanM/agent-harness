import path from "node:path";
import { getConfig } from "@agent-harness/core";
import { Router } from "express";
import { z } from "zod";
import { IdentifierSchema, validateRequest } from "../http/validation.js";
import { PluginRegistry } from "../plugin/registry.js";
import { parseServerConfig } from "../server-config.js";

let cachedRegistry: PluginRegistry | undefined;
let cachedRegistryKey: string | undefined;

function getRegistry(): PluginRegistry {
  const config = getConfig();
  const pluginsDir =
    parseServerConfig().pluginsDir ??
    path.join(config.ROOT, "packages", "dashboard", "src", "plugins");
  const key = `${config.ROOT}\0${pluginsDir}`;
  if (!cachedRegistry || cachedRegistryKey !== key) {
    cachedRegistry = new PluginRegistry(pluginsDir, config.ROOT);
    cachedRegistryKey = key;
  }
  return cachedRegistry;
}

export const pluginsRouter = Router();

const PluginUpdateSchema = z
  .object({
    params: z.object({ name: IdentifierSchema }).strict(),
    body: z.object({ enabled: z.boolean() }).strict(),
  })
  .strict();

pluginsRouter.get("/", (_req, res) => {
  res.json(getRegistry().list());
});

pluginsRouter.put("/:name", (req, res) => {
  const request = validateRequest(PluginUpdateSchema, { params: req.params, body: req.body }, res);
  if (!request) return;
  const { name } = request.params;
  const { enabled } = request.body;

  const plugin = getRegistry().setEnabled(name, enabled);
  if (!plugin) {
    res.status(404).json({ error: `Plugin "${name}" not found` });
    return;
  }

  res.json(plugin);
});
