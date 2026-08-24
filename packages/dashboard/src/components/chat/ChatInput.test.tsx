import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fetchSession, sendMessage } from "@/lib/api";
import { useSessionStore } from "@/stores/session-store";
import { createTestServerSession, createTestSession } from "@/test-helpers/session-fixtures";
import ChatInput from "./ChatInput";

vi.mock("@/lib/api", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/api")>();
  return { ...original, fetchSession: vi.fn(), sendMessage: vi.fn() };
});

vi.mock("./TTSButton", () => ({ TTSButton: () => <button type="button">Voice</button> }));

const mockedSendMessage = vi.mocked(sendMessage);
const mockedFetchSession = vi.mocked(fetchSession);

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
    mockedFetchSession.mockReset();
    mockedFetchSession.mockResolvedValue(createTestServerSession({ sessionId: "session-a" }));
    useSessionStore.setState({
      activeSessionId: "session-a",
      sessions: [createTestSession({ sessionId: "session-a" })],
      streamingMessageIds: {},
      awaitingAuthoritativeMessageIds: {},
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
    let finishCancellation: (() => void) | undefined;
    const cancel = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finishCancellation = resolve;
        }),
    );
    mockedSendMessage.mockResolvedValueOnce(
      new ReadableStream({
        start(controller) {
          controller.enqueue(
            new TextEncoder().encode(
              `data: ${JSON.stringify({ type: "error", error: "provider unavailable" })}\n\n`,
            ),
          );
        },
        cancel,
      }),
    );
    render(<ChatInput />);

    fireEvent.change(screen.getByPlaceholderText("Type a message..."), {
      target: { value: "Hello" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));

    await waitFor(() => expect(cancel).toHaveBeenCalledOnce());
    expect(screen.queryByRole("button", { name: "Retry message" })).not.toBeInTheDocument();
    finishCancellation?.();
    expect(await screen.findByRole("alert")).toHaveTextContent("provider unavailable");
    expect(screen.getByRole("button", { name: "Retry message" })).toBeInTheDocument();
  });

  it("validates and safely ignores tool-call deltas", async () => {
    mockedSendMessage.mockResolvedValueOnce(
      new ReadableStream({
        start(controller) {
          controller.enqueue(
            new TextEncoder().encode(
              `data: ${JSON.stringify({ type: "tool-call-delta", toolCall: { id: "call-1", name: "read", argumentsDelta: "{}" } })}\n\ndata: ${JSON.stringify({ type: "text-delta", text: "Done" })}\n\ndata: ${JSON.stringify({ type: "done" })}\n\n`,
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

    await waitFor(() =>
      expect(useSessionStore.getState().sessions[0].messages).toEqual(
        expect.arrayContaining([expect.objectContaining({ role: "assistant", content: "Done" })]),
      ),
    );
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("keeps the streamed answer when authoritative confirmation fails", async () => {
    mockedSendMessage.mockResolvedValueOnce(successfulStream("Visible answer"));
    mockedFetchSession.mockRejectedValueOnce(new Error("confirmation unavailable"));
    render(<ChatInput />);
    fireEvent.change(screen.getByPlaceholderText("Type a message..."), {
      target: { value: "Hello" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));

    await waitFor(() => expect(mockedFetchSession).toHaveBeenCalledWith("session-a"));
    expect(useSessionStore.getState().sessions[0]?.messages).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ role: "assistant", content: "Visible answer" }),
      ]),
    );
    expect(useSessionStore.getState().awaitingAuthoritativeMessageIds["session-a"]).toHaveLength(1);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("replaces the placeholder after a successful authoritative confirmation", async () => {
    mockedSendMessage.mockResolvedValueOnce(successfulStream("Durable answer"));
    mockedFetchSession.mockResolvedValueOnce(
      createTestServerSession({
        sessionId: "session-a",
        messages: [
          { role: "user", content: "Hello" },
          { role: "assistant", content: "Durable answer" },
        ],
      }),
    );
    render(<ChatInput />);
    fireEvent.change(screen.getByPlaceholderText("Type a message..."), {
      target: { value: "Hello" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));

    await waitFor(() =>
      expect(useSessionStore.getState().sessions[0]?.messages).toEqual([
        expect.objectContaining({ id: "srv-0", role: "user", content: "Hello" }),
        expect.objectContaining({ id: "srv-1", role: "assistant", content: "Durable answer" }),
      ]),
    );
    expect(useSessionStore.getState().awaitingAuthoritativeMessageIds["session-a"]).toBeUndefined();
  });
});
