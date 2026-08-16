import { describe, expect, it } from "vitest";
import { parseExcalidrawContent } from "./excalidraw";

describe("parseExcalidrawContent", () => {
  it("accepts an empty Excalidraw document", () => {
    expect(parseExcalidrawContent('{"type":"excalidraw","elements":[]}')).toEqual({
      type: "excalidraw",
      elements: [],
    });
  });

  it("rejects malformed JSON and structurally invalid elements", () => {
    expect(() => parseExcalidrawContent("{broken")).toThrow();
    expect(() => parseExcalidrawContent('{"elements":["not-an-element"]}')).toThrow();
  });
});
