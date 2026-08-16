import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { MarkdownRenderer } from "./MarkdownRenderer";

describe("MarkdownRenderer (chat) link security", () => {
  it("does not expose active link protocols", () => {
    render(<MarkdownRenderer content="[run](javascript:alert(1))" />);

    expect(screen.getByText("run").closest("a")).toBeNull();
  });

  it("does not expose protocol-relative URLs", () => {
    render(<MarkdownRenderer content="[evil](//evil.example.com)" />);

    expect(screen.getByText("evil").closest("a")).toBeNull();
  });

  it("does not expose data URLs", () => {
    render(<MarkdownRenderer content="[data](data:text/html,hi)" />);

    expect(screen.getByText("data").closest("a")).toBeNull();
  });

  it("allows safe http, mailto, and root-relative links", () => {
    render(
      <MarkdownRenderer content="[a](https://ok.example) [b](mailto:x@y.example) [c](/docs)" />,
    );

    expect(screen.getByText("a").closest("a")).toHaveAttribute("href", "https://ok.example");
    expect(screen.getByText("b").closest("a")).toHaveAttribute("href", "mailto:x@y.example");
    expect(screen.getByText("c").closest("a")).toHaveAttribute("href", "/docs");
  });
});
