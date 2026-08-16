import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { Config } from "@agent-harness/core";
import {
  BoundaryValidationError,
  ConfigSchema,
  getConfig,
  getConfigRoot,
  parseBoundary,
  parseJsonResponseBoundary,
  resetConfig,
  stringifyJsonBounded,
} from "@agent-harness/core";
import { Router } from "express";
import { z } from "zod";
import { asyncHandler } from "../http/async-handler.js";
import { validateRequest } from "../http/validation.js";

type PersistedSettingKey = Exclude<keyof Config, "ROOT">;

const SETTING_KEYS: PersistedSettingKey[] = [
  "INBOX_ROOT",
  "SESSIONS_DIR",
  "AGENTS_DIR",
  "PROVIDER_ENDPOINT",
  "API_KEY_ENV",
  "DEFAULT_MODEL",
  "MAX_CONCURRENT_AGENTS",
];
const PersistedSettingsSchema = ConfigSchema.pick({
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
const MAX_SETTINGS_BYTES = 2_000_000;
const ModelsResponseSchema = z.object({
  object: z.string().max(128),
  data: z
    .array(
      z.object({
        id: z.string().min(1).max(512),
        object: z.string().max(128),
        created: z.number().finite(),
        owned_by: z.string().max(512),
      }),
    )
    .max(10_000),
});

function getSettingsFile(): string {
  return path.join(getConfigRoot(), ".harness", "settings.json");
}

export const settingsRouter = Router();

settingsRouter.get("/", (_req, res) => {
  res.json(getConfig());
});

settingsRouter.get(
  "/models",
  asyncHandler(async (_req, res) => {
    try {
      const config = getConfig();
      const apiKey = process.env[config.API_KEY_ENV];
      const response = await fetch(`${config.PROVIDER_ENDPOINT.replace(/\/$/u, "")}/models`, {
        headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : undefined,
        signal: AbortSignal.timeout(15_000),
      });
      if (!response.ok) {
        throw new Error(`Failed to fetch models: ${response.status}`);
      }
      const data = await parseJsonResponseBoundary(
        response,
        ModelsResponseSchema,
        "models response",
        2_000_000,
      );
      res.json(data);
    } catch {
      console.error("[settings] Failed to fetch models");
      res.status(502).json({ error: "Failed to fetch models" });
    }
  }),
);

settingsRouter.put("/", (req, res) => {
  const body = validateRequest(SettingsUpdateSchema, req.body, res);
  if (!body) return;
  let config: Config;
  try {
    config = getConfig();
  } catch (error) {
    if (!(error instanceof BoundaryValidationError) || !fs.existsSync(getSettingsFile())) {
      throw error;
    }
    quarantineInvalidSettings();
    resetConfig();
    config = getConfig();
  }

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
  } catch {
    console.error("[settings] Failed to save settings");
    res.status(500).json({ error: "Failed to save settings" });
  }
});

function savePersistedSettings(settings: Config): void {
  const file = getSettingsFile();
  const dir = path.dirname(file);
  fs.mkdirSync(dir, { recursive: true });
  const temporaryFile = `${file}.tmp`;
  try {
    fs.writeFileSync(
      temporaryFile,
      stringifyJsonBounded(
        parseBoundary(
          PersistedSettingsSchema,
          Object.fromEntries(SETTING_KEYS.map((key) => [key, settings[key]])),
          "persisted settings save",
        ),
        MAX_SETTINGS_BYTES,
        "persisted settings",
      ),
      "utf-8",
    );
    fs.renameSync(temporaryFile, file);
  } catch (error) {
    try {
      fs.rmSync(temporaryFile, { force: true });
    } catch {}
    throw error;
  }
}

function quarantineInvalidSettings(): void {
  const file = getSettingsFile();
  fs.renameSync(file, `${file}.invalid-${Date.now()}-${randomUUID()}`);
}
