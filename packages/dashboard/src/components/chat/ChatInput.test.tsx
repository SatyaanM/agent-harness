import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { sendMessage } from "@/lib/api";
import { useSessionStore } from "@/stores/session-store";
import ChatInput from "./ChatInput";

vi.mock("@/lib/api", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/api")>();
  return { ...original, sendMessage: vi.fn() };
});

vi.mock("./TTSButton", () => ({ TTSButton: () => <button type="button">Voice</button> }));

const mockedSendMessage = vi.mocked(sendMessage);

function successfulStream(text: string): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      controller.enqueue(
        new TextEncoder().encode(
          `data: ${JSON.stringify({ type: "text-delta", text })}\n\ndata: ${JSON.stringify({ type: "done" })}\n\n`,
        ),
      );
      controller.close();
    },
  });
}

describe("ChatInput", () => {
  afterEach(cleanup);

  beforeEach(() => {
    mockedSendMessage.mockReset();
    useSessionStore.setState({
      activeSessionId: "session-a",
      sessions: [
        {
          sessionId: "session-a",
          messages: [],
          status: "active",
          agentName: "orchestrator",
          createdAt: "2026-08-15T00:00:00.000Z",
        },
      ],
    });
  });

  it("keeps a visible retry action after a network failure and retries the same message", async () => {
    mockedSendMessage.mockRejectedValueOnce(new Error("offline"));
    mockedSendMessage.mockResolvedValueOnce(successfulStream("Recovered"));
    render(<ChatInput />);

    fireEvent.change(screen.getByPlaceholderText("Type a message..."), {
      target: { value: "Hello" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Message failed to send");
    fireEvent.click(screen.getByRole("button", { name: "Retry message" }));

    await waitFor(() => expect(mockedSendMessage).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.queryByRole("alert")).not.toBeInTheDocument());
    expect(mockedSendMessage).toHaveBeenLastCalledWith("session-a", "Hello", "orchestrator", {
      retry: true,
    });
    expect(useSessionStore.getState().sessions[0].messages).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ role: "assistant", content: "Recovered" }),
      ]),
    );
  });

  it("offers retry when the SSE stream reports an error", async () => {
    mockedSendMessage.mockResolvedValueOnce(
      new ReadableStream({
        start(controller) {
          controller.enqueue(
            new TextEncoder().encode(
              `data: ${JSON.stringify({ type: "error", error: "provider unavailable" })}\n\n`,
            ),
          );
          controller.close();
        },
      }),
    );
    render(<ChatInput />);

    fireEvent.change(screen.getByPlaceholderText("Type a message..."), {
      target: { value: "Hello" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("provider unavailable");
    expect(screen.getByRole("button", { name: "Retry message" })).toBeInTheDocument();
  });
});
