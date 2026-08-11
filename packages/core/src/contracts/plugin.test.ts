import { describe, expect, it } from "vitest";
import { PluginManifestSchema } from "./plugin.js";

describe("PluginManifestSchema", () => {
  it("accepts bounded local command manifests", () => {
    expect(
      PluginManifestSchema.safeParse({
        name: "example-plugin",
        version: "1.0.0",
        provides: {
          commands: [
            {
              id: "example.command",
              label: "Example",
              action: { type: "navigate", href: "/settings" },
            },
          ],
        },
      }).success,
    ).toBe(true);
  });

  it("rejects external navigation and unknown manifest fields", () => {
    expect(
      PluginManifestSchema.safeParse({
        name: "example-plugin",
        version: "1.0.0",
        unexpected: true,
        provides: {
          commands: [
            {
              id: "example.command",
              label: "Example",
              action: { type: "navigate", href: "https://attacker.example" },
            },
          ],
        },
      }).success,
    ).toBe(false);
  });
});
