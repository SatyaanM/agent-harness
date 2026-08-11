import fs from "node:fs";
import path from "node:path";
import { z } from "zod";

function findProjectRoot(): string {
  let dir = process.cwd();
  while (dir !== path.dirname(dir)) {
    const pkgPath = path.join(dir, "package.json");
    if (fs.existsSync(pkgPath)) {
      try {
        const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf-8"));
        if (pkg.workspaces) return dir;
      } catch {}
    }
    dir = path.dirname(dir);
  }
  return process.cwd();
}

function loadPersistedSettings(root: string): Record<string, unknown> {
  try {
    const file = path.join(root, ".harness", "settings.json");
    if (fs.existsSync(file)) {
      return JSON.parse(fs.readFileSync(file, "utf-8"));
    }
  } catch {}
  return {};
}

const ConfigSchema = z.object({
  ROOT: z.string().default(process.cwd()),
  INBOX_ROOT: z.string(),
  SESSIONS_DIR: z.string(),
  AGENTS_DIR: z.string(),
  PROVIDER_ENDPOINT: z.string().url().default("https://opencode.ai/zen/go/v1"),
  API_KEY_ENV: z.string().default("OPENCODE_API_KEY"),
  DEFAULT_MODEL: z.string().default("opencode-go/qwen3.7-plus"),
  MAX_CONCURRENT_AGENTS: z.coerce.number().int().positive().default(10),
});

export type Config = z.infer<typeof ConfigSchema>;

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
