import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { Config } from "@agent-harness/core";
import {
  BoundaryValidationError,
  ConfigSchema,
  createLogger,
  describeError,
  getConfig,
  getConfigRoot,
  ProviderRegistry,
  parseBoundary,
  parseJsonResponseBoundary,
  resetConfig,
  stringifyJsonBounded,
} from "@agent-harness/core";
import { Router } from "express";
import { z } from "zod";
import { asyncHandler } from "../http/async-handler.js";
import { validateRequest } from "../http/validation.js";
import { sessionManager } from "../session-manager.js";

const logger = createLogger("server.settings");

type PersistedSettingKey = Exclude<keyof Config, "ROOT">;

const SETTING_KEYS: PersistedSettingKey[] = [
  "INBOX_ROOT",
  "SESSIONS_DIR",
  "AGENTS_DIR",
  "PROVIDER_ENDPOINT",
  "API_KEY_ENV",
  "DEFAULT_MODEL",
  "MAX_CONCURRENT_AGENTS",
  "PROVIDERS",
];
const PersistedSettingsSchema = ConfigSchema.pick({
  INBOX_ROOT: true,
  SESSIONS_DIR: true,
  AGENTS_DIR: true,
  PROVIDER_ENDPOINT: true,
  API_KEY_ENV: true,
  DEFAULT_MODEL: true,
  MAX_CONCURRENT_AGENTS: true,
  PROVIDERS: true,
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

export const settingsRouter: Router = Router();

settingsRouter.get("/", (_req, res) => {
  res.json(getConfig());
});

settingsRouter.get(
  "/models",
  asyncHandler(async (_req, res) => {
    try {
      const config = getConfig();
      const registry = new ProviderRegistry(config);
      const providers = registry.getProviders();

      const fetchPromises = providers.map(async (provider) => {
        const apiKey = process.env[provider.apiKeyEnv];
        const response = await fetch(`${provider.baseUrl.replace(/\/$/u, "")}/models`, {
          headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : undefined,
          signal: AbortSignal.timeout(10_000),
        });
        if (!response.ok) {
          throw new Error(
            `Failed to fetch models from provider ${provider.id}: ${response.status}`,
          );
        }
        const data = await parseJsonResponseBoundary(
          response,
          ModelsResponseSchema,
          `models response ${provider.id}`,
          2_000_000,
        );
        return data.data;
      });

      const results = await Promise.allSettled(fetchPromises);

      const successful = results
        .filter((r) => r.status === "fulfilled")
        .map((r) => ("value" in r ? r.value : []));

      const failed = results.filter((r) => r.status === "rejected");

      if (successful.length === 0 && providers.length > 0) {
        // Log the first failure reason for debugging
        if (failed.length > 0) {
          const firstFailure = failed[0];
          if (firstFailure && "reason" in firstFailure) {
            logger.warn("All providers failed to fetch models", {
              ...describeError(firstFailure.reason),
            });
          }
        }
        throw new Error("All providers failed to fetch models");
      }

      const allModels = successful.flat();

      // Deduplicate by model ID
      const seen = new Set<string>();
      const deduplicated = allModels.filter((m) => {
        if (!m || typeof m.id !== "string") return false;
        if (seen.has(m.id)) return false;
        seen.add(m.id);
        return true;
      });

      res.json({
        object: "list",
        data: deduplicated,
      });
    } catch (error) {
      logger.error("Failed to aggregate models", { ...describeError(error) });
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
    sessionManager.audit({
      actorType: "user",
      actorId: "user",
      action: "settings.update",
      resourceType: "system",
      resourceId: "settings",
      payload: body,
    });
    res.json(parsed);
  } catch (error) {
    logger.error("Failed to save settings", { ...describeError(error) });
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
