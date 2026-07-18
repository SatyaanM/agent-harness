import { Router } from "express";
import fs from "node:fs";
import path from "node:path";
import { getConfig, resetConfig } from "@agent-harness/core";
import type { Config } from "@agent-harness/core";

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
  const body = req.body as Partial<Config>;
  const config = getConfig();

  const updated: Record<string, unknown> = { ...config };
  for (const key of SETTING_KEYS) {
    if (body[key] !== undefined) {
      updated[key] = body[key];
    }
  }

  if (typeof updated["MAX_CONCURRENT_AGENTS"] === "string") {
    updated["MAX_CONCURRENT_AGENTS"] = Number(updated["MAX_CONCURRENT_AGENTS"]);
  }

  try {
    savePersistedSettings(updated as Config);
    resetConfig();
    res.json(updated);
  } catch (err) {
    res.status(500).json({ error: "Failed to save settings", details: String(err) });
  }
});

function loadPersistedSettings(): Partial<Config> {
  try {
    const file = getSettingsFile();
    if (fs.existsSync(file)) {
      const raw = fs.readFileSync(file, "utf-8");
      return JSON.parse(raw) as Partial<Config>;
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
