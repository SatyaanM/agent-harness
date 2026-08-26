import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useRosterStore } from "@/stores/agent-roster-store";
import { useRuntimeStore } from "@/stores/runtime-store";
import { useSessionStore } from "@/stores/session-store";
import { createTestSession } from "@/test-helpers/session-fixtures";
import AgentColumn from "./AgentColumn";

vi.mock("./AgentDrawer", () => ({ default: () => null }));

class ResizeObserverMock {
  observe() {}
  disconnect() {}
}

beforeEach(() => {
  vi.stubGlobal("ResizeObserver", ResizeObserverMock);
  useSessionStore.setState({
    activeSessionId: "session-1",
    sessions: [createTestSession({ sessionId: "session-1" })],
  });
  useRosterStore.setState({
    bySession: {
      "session-1": [
        {
          id: "worker-123456",
          name: "worker-123456",
          taskId: "task-1",
          task: "Check the interface",
          status: "completed",
        },
      ],
    },
  });
  useRuntimeStore.setState({ activity: {}, running: {} });
});

describe("AgentColumn", () => {
  it("keeps roster controls full-size and gives them meaningful names", () => {
    render(<AgentColumn />);

    const primary = screen.getByRole("button", {
      name: "Primary agent orchestrator, status idle",
    });
    const worker = screen.getByRole("button", {
      name: "Worker agent worker-123456, status completed",
    });

    expect(primary).toHaveClass("shrink-0", "focus-visible:ring-2");
    expect(worker).toHaveAttribute("title", "worker-123456 (completed)");
    expect(worker).toHaveClass("shrink-0", "focus-visible:ring-2");
    expect(worker.querySelector("span")).toHaveAttribute("aria-hidden", "true");
  });
});
