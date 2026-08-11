import path from "node:path";
import { describe, expect, it } from "vitest";
import { parseServerConfig } from "./server-config.js";

describe("server network configuration", () => {
  it("binds to loopback and permits only local dashboards by default", () => {
    expect(parseServerConfig({})).toEqual({
      port: 3001,
      host: "127.0.0.1",
      allowedOrigins: ["http://localhost:3000", "http://127.0.0.1:3000"],
      enableRunCommand: false,
      enableWebFetch: false,
    });
  });

  it("validates explicit port and origin configuration", () => {
    expect(() => parseServerConfig({ PORT: "70000" })).toThrow();
    expect(() => parseServerConfig({ CORS_ORIGINS: "not-a-url" })).toThrow();
  });

  it("normalizes a comma-separated origin allowlist", () => {
    expect(
      parseServerConfig({
        HOST: "0.0.0.0",
        PORT: "4000",
        CORS_ORIGINS: "https://one.example, https://two.example",
        ENABLE_RUN_COMMAND: "true",
        ENABLE_WEB_FETCH: "true",
      }),
    ).toEqual({
      port: 4000,
      host: "0.0.0.0",
      allowedOrigins: ["https://one.example", "https://two.example"],
      enableRunCommand: true,
      enableWebFetch: true,
    });
  });

  it("rejects ambiguous privileged-tool flags", () => {
    expect(() => parseServerConfig({ ENABLE_RUN_COMMAND: "1" })).toThrow();
    expect(() => parseServerConfig({ ENABLE_WEB_FETCH: "yes" })).toThrow();
  });

  it("requires an absolute plugin directory when overridden", () => {
    expect(() => parseServerConfig({ PLUGINS_DIR: "relative/plugins" })).toThrow();
    expect(parseServerConfig({ PLUGINS_DIR: path.resolve("plugins") }).pluginsDir).toBe(
      path.resolve("plugins"),
    );
  });
});
