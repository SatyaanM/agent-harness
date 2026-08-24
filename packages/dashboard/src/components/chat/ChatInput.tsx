"use client";

import { createLogger, describeError } from "@agent-harness/core/contracts";
import { type KeyboardEvent, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { fetchSession, parseChatStreamEvent, sendMessage } from "@/lib/api";
import { useChatInputStore } from "@/stores/chat-input-store";
import { useSessionStore } from "@/stores/session-store";
import { useTTSStore } from "@/stores/tts-store";
import { TTSButton } from "./TTSButton";

const logger = createLogger("dashboard.chat-input");

interface PendingRequest {
  sessionId: string;
  content: string;
  userMessageId: string;
  assistantMessageId: string;
  agentName?: string;
  error: string;
}

export default function ChatInput() {
  const [input, setInput] = useState("");
  const [pendingRequest, setPendingRequest] = useState<PendingRequest | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const activeSessionId = useSessionStore((s) => s.activeSessionId);
  const sessions = useSessionStore((s) => s.sessions);
  const addMessage = useSessionStore((s) => s.addMessage);
  const updateMessage = useSessionStore((s) => s.updateMessage);
  const beginMessageStream = useSessionStore((s) => s.beginMessageStream);
  const finishMessageStream = useSessionStore((s) => s.finishMessageStream);
  const failMessageStream = useSessionStore((s) => s.failMessageStream);
  const ttsEnabled = useTTSStore((s) => s.enabled);
  const playTTS = useTTSStore((s) => s.play);
  const pendingPrefill = useChatInputStore((s) => s.pendingPrefill);
  const consumePrefill = useChatInputStore((s) => s.consumePrefill);

  useEffect(() => {
    if (pendingPrefill) {
      setInput((prev) => (prev ? `${prev} ${pendingPrefill}` : pendingPrefill));
      consumePrefill();
    }
  }, [pendingPrefill, consumePrefill]);

  const performRequest = async (request: Omit<PendingRequest, "error">, retryExisting = false) => {
    setSubmitting(true);
    const existingMessages =
      useSessionStore.getState().sessions.find((session) => session.sessionId === request.sessionId)
        ?.messages ?? [];
    if (!existingMessages.some((message) => message.id === request.userMessageId)) {
      addMessage(request.sessionId, {
        id: request.userMessageId,
        role: "user",
        content: request.content,
        createdAt: new Date().toISOString(),
      });
    }
    if (!existingMessages.some((message) => message.id === request.assistantMessageId)) {
      addMessage(request.sessionId, {
        id: request.assistantMessageId,
        role: "assistant",
        content: "",
        createdAt: new Date().toISOString(),
      });
    }
    beginMessageStream(request.sessionId, request.assistantMessageId);
    updateMessage(request.sessionId, request.assistantMessageId, "");
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
    try {
      const stream = await sendMessage(request.sessionId, request.content, request.agentName, {
        deliveryId: request.userMessageId,
        ...(retryExisting ? { retry: true } : {}),
      });
      if (!stream) throw new Error("The server returned no response stream.");

      reader = stream.getReader();
      const decoder = new TextDecoder();
      let accumulated = "";
      let buffer = "";
      let completed = false;

      while (!completed) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          const data = line.slice(6);
          if (data === "[DONE]") {
            completed = true;
            break;
          }

          const parsed = parseChatStreamEvent(data);
          if (parsed.type === "text-delta") {
            accumulated += parsed.text;
            updateMessage(request.sessionId, request.assistantMessageId, accumulated);
          } else if (parsed.type === "done") {
            completed = true;
            break;
          } else if (parsed.type === "error") {
            throw new Error(parsed.error);
          }
        }
      }

      if (!completed) throw new Error("The response stream ended before completion.");
      reader.releaseLock();
      reader = undefined;
      finishMessageStream(request.sessionId, request.assistantMessageId);
      void fetchSession(request.sessionId)
        .then((latest) =>
          useSessionStore.getState().confirmFromServer(latest, request.assistantMessageId),
        )
        .catch((error: unknown) => {
          logger.error("Authoritative stream confirmation failed", {
            sessionId: request.sessionId,
            ...describeError(error),
          });
        });
      setPendingRequest(null);

      // Auto-play TTS if enabled
      if (ttsEnabled && accumulated.trim()) {
        void playTTS(accumulated).catch((error) => {
          logger.error("Automatic voice playback failed", { ...describeError(error) });
        });
      }
    } catch (error) {
      await reader?.cancel().catch(() => undefined);
      reader = undefined;
      const detail = error instanceof Error ? error.message : "Unknown network error";
      failMessageStream(request.sessionId, request.assistantMessageId);
      setPendingRequest({ ...request, error: detail });
    } finally {
      setSubmitting(false);
    }
  };

  const handleSubmit = async () => {
    if (!input.trim() || !activeSessionId || submitting) return;

    const content = input.trim();
    const assistantMessageId = crypto.randomUUID();
    const userMessageId = crypto.randomUUID();
    const activeSession = sessions.find((s) => s.sessionId === activeSessionId);
    addMessage(activeSessionId, {
      id: userMessageId,
      role: "user",
      content,
      createdAt: new Date().toISOString(),
    });
    addMessage(activeSessionId, {
      id: assistantMessageId,
      role: "assistant",
      content: "",
      createdAt: new Date().toISOString(),
    });
    setInput("");
    await performRequest({
      sessionId: activeSessionId,
      content,
      userMessageId,
      assistantMessageId,
      agentName: activeSession?.agentName,
    });
  };

  const visibleFailure = pendingRequest?.sessionId === activeSessionId ? pendingRequest : null;

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  return (
    <div className="border-t bg-background p-3">
      {visibleFailure && (
        <div
          role="alert"
          className="mb-2 flex items-center justify-between gap-3 rounded-md border border-red-300 bg-red-50 px-3 py-2 text-xs text-red-700 dark:border-red-900 dark:bg-red-950/50 dark:text-red-300"
        >
          <span>Message failed to send: {visibleFailure.error}</span>
          <Button
            type="button"
            variant="outline"
            size="sm"
            aria-label="Retry message"
            disabled={submitting}
            onClick={() => performRequest(visibleFailure, true)}
          >
            {submitting ? "Retrying..." : "Retry"}
          </Button>
        </div>
      )}
      <div className="flex items-end gap-2">
        <TTSButton />
        <Textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder={activeSessionId ? "Type a message..." : "Create a session first"}
          disabled={!activeSessionId}
          rows={1}
          className="flex-1 min-h-9 max-h-40 resize-none"
        />
        <Button onClick={handleSubmit} disabled={!activeSessionId || !input.trim() || submitting}>
          {submitting ? "Sending..." : "Send"}
        </Button>
      </div>
    </div>
  );
}
