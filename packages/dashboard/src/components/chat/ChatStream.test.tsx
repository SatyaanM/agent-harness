import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { useSessionStore } from "@/stores/session-store";
import ChatStream from "./ChatStream";

describe("ChatStream", () => {
  beforeEach(() => {
    useSessionStore.setState({ sessions: [], activeSessionId: null });
  });

  it("explains how to start when no session is open", () => {
    render(<ChatStream />);

    expect(screen.getByText("Create or reopen a session to start chatting.")).toBeInTheDocument();
    expect(screen.queryByText("Loading messages...")).not.toBeInTheDocument();
  });
});
