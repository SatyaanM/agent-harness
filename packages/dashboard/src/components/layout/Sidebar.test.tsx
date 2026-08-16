import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useSidebarStore } from "@/stores/sidebar-store";
import { Sidebar } from "./Sidebar";

vi.mock("next/navigation", () => ({ usePathname: () => "/agents" }));

beforeEach(() => {
  localStorage.clear();
  useSidebarStore.setState({ collapsed: false });
});

describe("Sidebar", () => {
  it("marks the active destination and collapses visually at narrow breakpoints", () => {
    render(<Sidebar />);

    expect(screen.getByRole("link", { name: "Agents" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("link", { name: "Inbox" })).not.toHaveAttribute("aria-current");
    expect(screen.getByRole("complementary")).toHaveClass("w-14", "md:w-44");
    expect(screen.getByText("Agent Harness")).toHaveClass("hidden", "md:block");
    expect(screen.getByText("Agents")).toHaveClass("hidden", "md:inline");
  });
});
