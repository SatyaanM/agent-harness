import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { MarkdownRenderer } from "./MarkdownRenderer";

vi.mock("@/stores/theme-store", () => ({
  useThemeStore: () => "dark",
}));
vi.mock("../header-actions", () => ({
  useInboxHeaderActions: () => vi.fn(),
}));

describe("MarkdownRenderer security", () => {
  it("does not load remote images implicitly", () => {
    render(<MarkdownRenderer content="![secret](https://attacker.example/pixel)" />);

    expect(screen.getByRole("img")).not.toHaveAttribute("src");
  });

  it("does not expose active link protocols", () => {
    render(<MarkdownRenderer content="[run](javascript:alert(1))" />);

    expect(screen.getByText("run").closest("a")).not.toHaveAttribute("href");
  });
});
