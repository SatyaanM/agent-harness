import { describe, expect, it } from "vitest";
import { useCommandPaletteStore } from "./command-palette-store";

describe("commandPaletteStore", () => {
  it("starts closed", () => {
    expect(useCommandPaletteStore.getState().open).toBe(false);
  });

  it("opens when setOpen(true) is called", () => {
    useCommandPaletteStore.getState().setOpen(true);

    expect(useCommandPaletteStore.getState().open).toBe(true);
  });
});
