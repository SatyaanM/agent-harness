import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { ImageRenderer } from "./ImageRenderer";

describe("ImageRenderer lightbox", () => {
  it("provides a named close button and closes on Escape", async () => {
    const user = userEvent.setup();
    render(
      <ImageRenderer
        content="data:image/svg+xml,%3Csvg/%3E"
        item={{ name: "sample.svg", type: "svg" }}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Open sample.svg in lightbox" }));

    expect(screen.getByRole("dialog", { name: "Image lightbox" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Close image lightbox" })).toHaveFocus();

    await user.tab();
    expect(screen.getByRole("button", { name: "Close image lightbox" })).toHaveFocus();

    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog", { name: "Image lightbox" })).not.toBeInTheDocument();
  });
});
