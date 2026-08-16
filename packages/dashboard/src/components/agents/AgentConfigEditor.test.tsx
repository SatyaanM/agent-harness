import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AgentConfigEditor } from "./AgentConfigEditor";

vi.mock("next/dynamic", () => ({
  default: () =>
    function Editor({ value, onChange }: { value: string; onChange: (value: string) => void }) {
      return (
        <textarea
          aria-label="Agent source"
          value={value}
          onChange={(event) => onChange(event.target.value)}
        />
      );
    },
}));

vi.mock("@/lib/api", () => ({
  fetchAgentSource: vi.fn(async () => "original"),
  updateAgentSource: vi.fn(),
  deleteAgent: vi.fn(),
}));

describe("AgentConfigEditor unsaved-change guard", () => {
  afterEach(cleanup);

  beforeEach(() => {
    vi.restoreAllMocks();
    sessionStorage.clear();
  });

  it("blocks internal navigation when the user rejects discarding dirty source", async () => {
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(false);
    render(
      <>
        <a href="/plugins">Plugins</a>
        <AgentConfigEditor agentName="orchestrator" />
      </>,
    );

    const editor = await screen.findByRole("textbox", { name: "Agent source" });
    fireEvent.change(editor, { target: { value: "changed" } });
    await waitFor(() => expect(screen.getByText("Unsaved changes")).toBeInTheDocument());

    const allowed = fireEvent.click(screen.getByRole("link", { name: "Plugins" }));

    expect(allowed).toBe(false);
    expect(confirmSpy).toHaveBeenCalledWith("Discard unsaved agent changes?");
  });

  it("restores a dirty draft after navigation unmounts the editor", async () => {
    const first = render(<AgentConfigEditor agentName="orchestrator" />);
    const editor = await screen.findByRole("textbox", { name: "Agent source" });
    fireEvent.change(editor, { target: { value: "unsaved draft" } });
    first.unmount();

    render(<AgentConfigEditor agentName="orchestrator" />);

    expect(await screen.findByRole("textbox", { name: "Agent source" })).toHaveValue(
      "unsaved draft",
    );
    expect(screen.getByText("Unsaved changes")).toBeInTheDocument();
  });
});
