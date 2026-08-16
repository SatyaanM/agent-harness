import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { TextRenderer } from "./TextRenderer";

describe("TextRenderer empty state", () => {
  it("shows a clear state for an empty file", () => {
    render(<TextRenderer content="" item={{ name: "empty.txt" }} />);

    expect(screen.getByText("This file is empty")).toBeInTheDocument();
  });
});
