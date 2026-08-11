import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import { readUtf8FileBoundedSync } from "./filesystem/bounded-io.js";
import { parseJsonBoundary } from "./validation.js";

const MAX_CONFIG_FILE_BYTES = 2_000_000;

const AbsolutePathSchema = z
  .string()
  .min(1)
  .max(32_767)
  .refine((value) => path.isAbsolute(value), "must be an absolute path");
const ProviderEndpointSchema = z
  .string()
  .url()
  .max(2_048)
  .refine((value) => {
    const url = new URL(value);
    return (
      (url.protocol === "http:" || url.protocol === "https:") &&
      !url.username &&
      !url.password &&
      !url.search &&
      !url.hash
    );
  }, "must be an HTTP(S) URL without credentials, query, or fragment");

export const ConfigSchema = z
  .object({
    ROOT: AbsolutePathSchema.default(process.cwd()),
    INBOX_ROOT: AbsolutePathSchema,
    SESSIONS_DIR: AbsolutePathSchema,
    AGENTS_DIR: AbsolutePathSchema,
    PROVIDER_ENDPOINT: ProviderEndpointSchema.default("https://opencode.ai/zen/go/v1"),
    API_KEY_ENV: z
      .string()
      .min(1)
      .max(128)
      .regex(/^[A-Z_][A-Z0-9_]*$/u, "must be an uppercase environment variable name")
      .default("OPENCODE_API_KEY"),
    DEFAULT_MODEL: z
      .string()
      .min(1)
      .max(512)
      .regex(/^[A-Za-z0-9][A-Za-z0-9._:/-]*$/u, "contains unsupported characters")
      .default("opencode-go/qwen3.7-plus"),
    MAX_CONCURRENT_AGENTS: z.coerce.number().int().min(1).max(1_000).default(10),
  })
  .strict();
const PersistedConfigSchema = ConfigSchema.partial().strict();
const PackageWorkspaceSchema = z.object({ workspaces: z.unknown().optional() }).passthrough();

export type Config = z.infer<typeof ConfigSchema>;

function findProjectRoot(): string {
  let dir = process.cwd();
  while (dir !== path.dirname(dir)) {
    const pkgPath = path.join(dir, "package.json");
    if (fs.existsSync(pkgPath)) {
      try {
        const pkg = parseJsonBoundary(
          PackageWorkspaceSchema,
          readUtf8FileBoundedSync(pkgPath, MAX_CONFIG_FILE_BYTES, `package metadata ${pkgPath}`),
          `package metadata ${pkgPath}`,
        );
        if (pkg.workspaces) return dir;
      } catch {}
    }
    dir = path.dirname(dir);
  }
  return process.cwd();
}

function loadPersistedSettings(root: string): Record<string, unknown> {
  const file = path.join(root, ".harness", "settings.json");
  if (fs.existsSync(file)) {
    return parseJsonBoundary(
      PersistedConfigSchema,
      readUtf8FileBoundedSync(file, MAX_CONFIG_FILE_BYTES, "persisted settings"),
      "persisted settings",
    );
  }
  return {};
}

let cachedConfig: Config | null = null;

export function getConfig(): Config {
  if (cachedConfig) return cachedConfig;

  const root = process.env.ROOT ?? findProjectRoot();
  const persisted = loadPersistedSettings(root);

  cachedConfig = ConfigSchema.parse({
    ROOT: root,
    INBOX_ROOT: process.env.INBOX_ROOT ?? persisted.INBOX_ROOT ?? path.join(root, "inbox"),
    SESSIONS_DIR: process.env.SESSIONS_DIR ?? persisted.SESSIONS_DIR ?? path.join(root, "sessions"),
    AGENTS_DIR: process.env.AGENTS_DIR ?? persisted.AGENTS_DIR ?? path.join(root, "agents"),
    PROVIDER_ENDPOINT: process.env.PROVIDER_ENDPOINT ?? persisted.PROVIDER_ENDPOINT,
    API_KEY_ENV: process.env.API_KEY_ENV ?? persisted.API_KEY_ENV,
    DEFAULT_MODEL: process.env.DEFAULT_MODEL ?? persisted.DEFAULT_MODEL,
    MAX_CONCURRENT_AGENTS: process.env.MAX_CONCURRENT_AGENTS ?? persisted.MAX_CONCURRENT_AGENTS,
  });

  return cachedConfig;
}

export function resetConfig(): void {
  cachedConfig = null;
}
