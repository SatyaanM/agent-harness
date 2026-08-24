import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ConfigSchema, getConfig, resetConfig } from "./config.js";
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
  it("rejects duplicate provider identifiers", () => {
    expect(() =>
      ConfigSchema.parse({
        ROOT: process.cwd(),
        INBOX_ROOT: process.cwd(),
        SESSIONS_DIR: process.cwd(),
        AGENTS_DIR: process.cwd(),
        PROVIDERS: [
          {
            id: "duplicate",
            displayName: "First",
            protocol: "openai",
            baseUrl: "https://first.example/v1",
            apiKeyEnv: "FIRST_API_KEY",
          },
          {
            id: "duplicate",
            displayName: "Second",
            protocol: "anthropic",
            baseUrl: "https://second.example/v1",
            apiKeyEnv: "SECOND_API_KEY",
          },
        ],
      }),
    ).toThrow("provider IDs must be unique");
  });

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
    const root = path.resolve("tmp", "agent-harness");
    const inbox = path.join(root, "inbox");
    setEnv("ROOT", root);
    setEnv("INBOX_ROOT", inbox);
    setEnv("MAX_CONCURRENT_AGENTS", "4");

    const cfg = getConfig();

    expect(cfg.ROOT).toBe(root);
    expect(cfg.INBOX_ROOT).toBe(inbox);
    expect(cfg.MAX_CONCURRENT_AGENTS).toBe(4);
  });

  it("rejects invalid config", () => {
    setEnv("ROOT", "C:\\tmp\\agent-harness");
    setEnv("MAX_CONCURRENT_AGENTS", "0");

    expect(() => getConfig()).toThrow();
  });

  it.each([
    ["ROOT", "relative/path"],
    ["PROVIDER_ENDPOINT", "file:///tmp/provider"],
    ["PROVIDER_ENDPOINT", "https://user:secret@example.com/v1"],
    ["API_KEY_ENV", "INVALID-NAME"],
    ["MAX_CONCURRENT_AGENTS", "1001"],
  ])("rejects unsafe %s values", (key, value) => {
    setEnv("ROOT", path.resolve("tmp", "agent-harness"));
    setEnv(key, value);

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
