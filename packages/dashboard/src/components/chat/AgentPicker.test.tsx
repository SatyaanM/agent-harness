import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useAgentsStore } from "@/stores/agents-store";
import { useRuntimeStore } from "@/stores/runtime-store";
import { useSessionStore } from "@/stores/session-store";
import { createTestSession } from "@/test-helpers/session-fixtures";
import AgentPicker from "./AgentPicker";

vi.mock("@/lib/api", () => ({ fetchAgents: vi.fn() }));

describe("AgentPicker", () => {
  afterEach(cleanup);

  beforeEach(() => {
    useAgentsStore.setState({
      agents: [
        {
          name: "orchestrator",
          model: "smoke",
          tools: ["delegate"],
          maxSteps: 4,
          instructions: "Coordinate work",
        },
        {
          name: "worker",
          model: "smoke",
          tools: [],
          maxSteps: 4,
          instructions: "Do work",
        },
      ],
      loading: false,
      error: null,
    });
    useSessionStore.setState({
      activeSessionId: "session-a",
      sessions: [createTestSession({ sessionId: "session-a" })],
    });
    useRuntimeStore.setState({ activity: {}, running: {} });
  });

  it("disables agent switching while the active session is running", () => {
    useRuntimeStore.setState({ running: { "session-a": true } });

    render(<AgentPicker />);

    expect(screen.getByRole("combobox", { name: "Select agent" })).toBeDisabled();
  });

  it("preserves agent switching while the active session is idle", () => {
    render(<AgentPicker />);

    const picker = screen.getByRole("combobox", { name: "Select agent" });
    expect(picker).toBeEnabled();
    expect(picker).toHaveTextContent("orchestrator");
    expect(picker).not.toHaveTextContent("Coordinate work");
  });
});
