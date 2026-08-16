import { describe, expect, it } from "vitest";
import { resolveLanguage } from "./TextRenderer";

describe("TextRenderer language selection", () => {
  it("uses the item extension when the fallback renderer has no explicit language", () => {
    expect(resolveLanguage(undefined, "worker.ts")).toBe("typescript");
    expect(resolveLanguage("text", "config.yaml")).toBe("yaml");
  });

  it("keeps an explicit renderer language", () => {
    expect(resolveLanguage("python", "worker.ts")).toBe("python");
  });
});
