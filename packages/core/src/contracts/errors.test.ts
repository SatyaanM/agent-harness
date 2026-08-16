import { describe, expect, it } from "vitest";
import { describeError } from "./errors.js";

describe("describeError", () => {
  it("uses the error name as the code for plain errors", () => {
    expect(describeError(new Error("boom"))).toEqual({
      name: "Error",
      code: "Error",
      message: "boom",
    });
  });

  it("preserves a custom error class name", () => {
    class AgentCancelledError extends Error {
      constructor() {
        super("cancelled");
        this.name = "AgentCancelledError";
      }
    }
    expect(describeError(new AgentCancelledError())).toEqual({
      name: "AgentCancelledError",
      code: "AgentCancelledError",
      message: "cancelled",
    });
  });

  it("prefers a node-style code when present", () => {
    const error = new Error("not found");
    Object.assign(error, { code: "ENOENT" });
    expect(describeError(error)).toEqual({
      name: "Error",
      code: "ENOENT",
      message: "not found",
    });
  });

  it("normalizes string throw values", () => {
    expect(describeError("oops")).toEqual({
      name: "UnknownError",
      code: "unknown_error",
      message: "oops",
    });
  });

  it("normalizes non-Error, non-string throw values without throwing", () => {
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    const described = describeError(circular);
    expect(described.name).toBe("UnknownError");
    expect(described.code).toBe("unknown_error");
    expect(typeof described.message).toBe("string");
  });
});
