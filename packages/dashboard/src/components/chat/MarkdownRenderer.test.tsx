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

  it("does not expose vbscript: URLs", () => {
    // Legacy IE/Edge vector — the regex anchor must catch non-js schemes too.
    render(<MarkdownRenderer content="[vb](vbscript:msgbox(1))" />);

    expect(screen.getByText("vb").closest("a")).toBeNull();
  });

  it("does not expose mixed-case javascript: variants", () => {
    // The safeHref scheme regex is case-insensitive for http/mailto, but the
    // any-other-scheme fallthrough must remain case-insensitive so attackers
    // can't smuggle 'JaVaScRiPt:' past the matcher.
    render(<MarkdownRenderer content="[x](JaVaScRiPt:alert(1))" />);

    expect(screen.getByText("x").closest("a")).toBeNull();
  });

  it("does not expose javascript: URLs with embedded whitespace", () => {
    // react-markdown's default URL transform strips leading whitespace, but a
    // defense-in-depth check inside safeHref ensures that even raw strings
    // with control characters never reach the dangerous scheme matcher.
    render(<MarkdownRenderer content="[w](java\tscript:alert(1))" />);
    render(<MarkdownRenderer content="[n](java\nscript:alert(1))" />);

    expect(screen.getByText("w").closest("a")).toBeNull();
    expect(screen.getByText("n").closest("a")).toBeNull();
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
