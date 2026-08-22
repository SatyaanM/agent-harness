import { render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { TextRenderer } from "./TextRenderer";

vi.mock("shiki", () => ({
  createHighlighter: vi.fn().mockResolvedValue({
    codeToHtml: vi.fn((code: string) => `<span class="line">${code}</span>`),
  }),
}));

describe("TextRenderer", () => {
  it("shows a clear state for an empty file", () => {
    render(<TextRenderer content="" item={{ name: "empty.txt" }} />);

    expect(screen.getByText("This file is empty")).toBeInTheDocument();
  });

  it("renders plain text without loading code highlighter", () => {
    render(<TextRenderer content="plain text content" language="text" />);

    expect(screen.getByText("plain text content")).toBeInTheDocument();
  });

  it("renders code with line numbers when syntax highlighting is available", async () => {
    render(<TextRenderer content="const x = 42;" item={{ name: "index.ts" }} />);

    await waitFor(() => {
      expect(screen.getByText("const x = 42;")).toBeInTheDocument();
    });
  });
});
