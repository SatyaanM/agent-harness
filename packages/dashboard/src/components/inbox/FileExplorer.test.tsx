import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { FileExplorer } from "./FileExplorer";

const api = vi.hoisted(() => ({
  createInboxDir: vi.fn(),
  deleteInboxItem: vi.fn(),
  fetchInboxTree: vi.fn(),
  moveInboxItem: vi.fn(),
  openInboxItem: vi.fn(),
}));

vi.mock("@/lib/api", () => api);

describe("FileExplorer folder creation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    api.fetchInboxTree.mockResolvedValue([]);
    api.createInboxDir.mockResolvedValue(undefined);
  });

  it("lets an empty inbox create its first folder through an accessible dialog", async () => {
    const user = userEvent.setup();
    const prompt = vi.spyOn(window, "prompt");

    render(<FileExplorer collapsed={false} onToggleCollapse={vi.fn()} />);

    expect(await screen.findByText("Inbox is empty")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Create folder" }));

    expect(screen.getByRole("dialog", { name: "Create folder" })).toBeInTheDocument();
    await user.type(screen.getByRole("textbox", { name: "Folder name" }), "first-folder");
    await user.click(screen.getByRole("button", { name: "Create" }));

    await waitFor(() => expect(api.createInboxDir).toHaveBeenCalledWith("first-folder"));
    expect(prompt).not.toHaveBeenCalled();
  });

  it("keeps the dialog open and reports an API failure", async () => {
    const user = userEvent.setup();
    api.createInboxDir.mockRejectedValueOnce(new Error("Folder already exists"));

    render(<FileExplorer collapsed={false} onToggleCollapse={vi.fn()} />);

    await user.click(await screen.findByRole("button", { name: "Create folder" }));
    await user.type(screen.getByRole("textbox", { name: "Folder name" }), "duplicate");
    await user.click(screen.getByRole("button", { name: "Create" }));

    const dialog = screen.getByRole("dialog", { name: "Create folder" });
    expect(await within(dialog).findByRole("alert")).toHaveTextContent("Folder already exists");
  });
});
