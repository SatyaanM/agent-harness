import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { getConfig, resetConfig } from "./config.js";
import { BoundaryValidationError } from "./validation.js";

const ORIGINAL_ENV = { ...process.env };
const tempDirs: string[] = [];

function setEnv(key: string, value: string | undefined) {
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
}

afterEach(async () => {
  process.env = { ...ORIGINAL_ENV };
  resetConfig();
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("getConfig", () => {
  it("uses defaults for unset values", () => {
    setEnv("ROOT", undefined);

    const cfg = getConfig();

    expect(cfg.MAX_CONCURRENT_AGENTS).toBe(10);
    expect(cfg.DEFAULT_MODEL).toBe("opencode-go/qwen3.7-plus");
    expect(cfg.PROVIDER_ENDPOINT).toBe("https://opencode.ai/zen/go/v1");
    expect(cfg.API_KEY_ENV).toBe("OPENCODE_API_KEY");
    expect(cfg.INBOX_ROOT).toBeDefined();
    expect(cfg.SESSIONS_DIR).toBeDefined();
    expect(cfg.AGENTS_DIR).toBeDefined();
  });

  it("respects environment variables", () => {
    setEnv("ROOT", "C:\\tmp\\agent-harness");
    setEnv("INBOX_ROOT", "C:\\tmp\\agent-harness\\inbox");
    setEnv("MAX_CONCURRENT_AGENTS", "4");

    const cfg = getConfig();

    expect(cfg.ROOT).toBe("C:\\tmp\\agent-harness");
    expect(cfg.INBOX_ROOT).toBe("C:\\tmp\\agent-harness\\inbox");
    expect(cfg.MAX_CONCURRENT_AGENTS).toBe(4);
  });

  it("rejects invalid config", () => {
    setEnv("ROOT", "C:\\tmp\\agent-harness");
    setEnv("MAX_CONCURRENT_AGENTS", "0");

    expect(() => getConfig()).toThrow();
  });

  it("rejects malformed persisted settings instead of silently using defaults", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "agent-harness-config-"));
    tempDirs.push(root);
    await mkdir(path.join(root, ".harness"));
    await writeFile(path.join(root, ".harness", "settings.json"), "{broken-json}");
    setEnv("ROOT", root);

    expect(() => getConfig()).toThrow(BoundaryValidationError);
  });
});
