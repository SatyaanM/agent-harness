import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useSessionStore } from "@/stores/session-store";
import SessionTabs from "./SessionTabs";

vi.mock("@/lib/api", () => ({
  createSession: vi.fn(),
  openSession: vi.fn(),
  renameSession: vi.fn(),
}));

vi.mock("./AgentPicker", () => ({ default: () => <div>Agent picker</div> }));

describe("SessionTabs", () => {
  beforeEach(() => {
    useSessionStore.setState({
      activeSessionId: "session-a",
      sessions: [
        {
          sessionId: "session-a",
          messages: [],
          status: "active",
          agentName: "orchestrator",
          title: "First session",
          createdAt: "2026-08-15T00:00:00.000Z",
        },
        {
          sessionId: "session-b",
          messages: [],
          status: "active",
          agentName: "worker",
          title: "Second session",
          createdAt: "2026-08-15T00:00:00.000Z",
        },
      ],
    });
  });

  it("renders an accessible, horizontally scrollable session tab strip", () => {
    render(<SessionTabs />);

    const tablist = screen.getByRole("tablist", { name: "Open sessions" });
    expect(tablist).toHaveClass("overflow-x-auto", "whitespace-nowrap");
    expect(screen.getByRole("tab", { name: "First session" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(screen.getByRole("tab", { name: "Second session" })).toHaveAttribute(
      "aria-selected",
      "false",
    );
    expect(screen.getByRole("button", { name: "Close First session" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Create new session" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Reopen closed session" })).toBeInTheDocument();
  });
});
