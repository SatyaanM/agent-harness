import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { MarkdownRenderer, safeHref } from "./MarkdownRenderer";

afterEach(() => {
  cleanup();
});

describe("safeHref", () => {
  it("allows standard http and https URLs", () => {
    expect(safeHref("https://example.com")).toBe("https://example.com");
    expect(safeHref("http://example.com/path?query=1")).toBe("http://example.com/path?query=1");
  });

  it("allows mailto URLs", () => {
    expect(safeHref("mailto:user@example.com")).toBe("mailto:user@example.com");
  });

  it("allows relative anchor and path links", () => {
    expect(safeHref("#section-1")).toBe("#section-1");
    expect(safeHref("/docs/api")).toBe("/docs/api");
  });

  it("rejects javascript and vbscript schemes", () => {
    expect(safeHref("javascript:alert(1)")).toBeUndefined();
    expect(safeHref("JAVASCRIPT:alert(1)")).toBeUndefined();
    expect(safeHref("  javascript:alert(1)  ")).toBeUndefined();
    expect(safeHref("vbscript:msgbox(1)")).toBeUndefined();
    expect(safeHref("data:text/html,<script>alert(1)</script>")).toBeUndefined();
  });

  it("rejects protocol-relative URLs", () => {
    expect(safeHref("//attacker.com/malicious")).toBeUndefined();
  });

  it("handles undefined or empty strings", () => {
    expect(safeHref(undefined)).toBeUndefined();
    expect(safeHref("")).toBeUndefined();
  });
});

describe("MarkdownRenderer component", () => {
  it("renders safe links as clickable anchor tags", () => {
    render(<MarkdownRenderer content="Check [this link](https://example.com)" />);
    const link = screen.getByRole("link", { name: "this link" });
    expect(link).toBeInTheDocument();
    expect(link).toHaveAttribute("href", "https://example.com");
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noopener noreferrer");
  });

  it("renders dangerous links as plain text rather than anchor tags", () => {
    render(<MarkdownRenderer content="Click [here](javascript:alert(1))" />);
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
    expect(screen.getByText("here")).toBeInTheDocument();
  });
});
