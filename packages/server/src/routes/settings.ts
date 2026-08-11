import fs from "node:fs";
import path from "node:path";
import type { Config } from "@agent-harness/core";
import {
  ConfigSchema,
  getConfig,
  parseBoundary,
  parseJsonBoundary,
  resetConfig,
} from "@agent-harness/core";
import { Router } from "express";
import { validateRequest } from "../http/validation.js";

const SETTING_KEYS: (keyof Config)[] = [
  "ROOT",
  "INBOX_ROOT",
  "SESSIONS_DIR",
  "AGENTS_DIR",
  "PROVIDER_ENDPOINT",
  "API_KEY_ENV",
  "DEFAULT_MODEL",
  "MAX_CONCURRENT_AGENTS",
];
const PersistedSettingsSchema = ConfigSchema.pick({
  ROOT: true,
  INBOX_ROOT: true,
  SESSIONS_DIR: true,
  AGENTS_DIR: true,
  PROVIDER_ENDPOINT: true,
  API_KEY_ENV: true,
  DEFAULT_MODEL: true,
  MAX_CONCURRENT_AGENTS: true,
})
  .partial()
  .strict();
const SettingsUpdateSchema = PersistedSettingsSchema;

function getSettingsFile(): string {
  const config = getConfig();
  return path.join(config.ROOT, ".harness", "settings.json");
}

export const settingsRouter = Router();

settingsRouter.get("/", (_req, res) => {
  const config = getConfig();
  const persisted = loadPersistedSettings();
  res.json({ ...config, ...persisted });
});

settingsRouter.get("/models", async (_req, res) => {
  try {
    const config = getConfig();
    const response = await fetch(`${config.PROVIDER_ENDPOINT}/models`);
    if (!response.ok) {
      throw new Error(`Failed to fetch models: ${response.status}`);
    }
    const data = await response.json();
    res.json(data);
  } catch (err) {
    console.error("[settings] Failed to fetch models:", err);
    res.status(500).json({ error: "Failed to fetch models", details: String(err) });
  }
});

settingsRouter.put("/", (req, res) => {
  const body = validateRequest(SettingsUpdateSchema, req.body, res);
  if (!body) return;
  const config = getConfig();

  const updated: Record<string, unknown> = { ...config };
  for (const key of SETTING_KEYS) {
    if (body[key] !== undefined) {
      updated[key] = body[key];
    }
  }

  try {
    const parsed = parseBoundary(ConfigSchema, updated, "settings update");
    savePersistedSettings(parsed);
    resetConfig();
    res.json(parsed);
  } catch (err) {
    res.status(500).json({ error: "Failed to save settings", details: String(err) });
  }
});

function loadPersistedSettings(): Partial<Config> {
  try {
    const file = getSettingsFile();
    if (fs.existsSync(file)) {
      const raw = fs.readFileSync(file, "utf-8");
      return parseJsonBoundary(PersistedSettingsSchema, raw, "persisted settings");
    }
  } catch {}
  return {};
}

function savePersistedSettings(settings: Config): void {
  const file = getSettingsFile();
  const dir = path.dirname(file);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(file, JSON.stringify(settings, null, 2), "utf-8");
}
