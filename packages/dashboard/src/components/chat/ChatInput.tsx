"use client";

import { type KeyboardEvent, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { parseChatStreamEvent, sendMessage } from "@/lib/api";
import { useChatInputStore } from "@/stores/chat-input-store";
import { useSessionStore } from "@/stores/session-store";
import { useTTSStore } from "@/stores/tts-store";
import { TTSButton } from "./TTSButton";

export default function ChatInput() {
  const [input, setInput] = useState("");
  const activeSessionId = useSessionStore((s) => s.activeSessionId);
  const sessions = useSessionStore((s) => s.sessions);
  const addMessage = useSessionStore((s) => s.addMessage);
  const updateMessage = useSessionStore((s) => s.updateMessage);
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

  const handleSubmit = async () => {
    if (!input.trim() || !activeSessionId) return;

    const userMessageId = crypto.randomUUID();
    addMessage(activeSessionId, {
      id: userMessageId,
      role: "user",
      content: input.trim(),
      createdAt: new Date().toISOString(),
    });

    const assistantMessageId = crypto.randomUUID();
    addMessage(activeSessionId, {
      id: assistantMessageId,
      role: "assistant",
      content: "",
      createdAt: new Date().toISOString(),
    });

    const content = input.trim();
    setInput("");

    const activeSession = sessions.find((s) => s.sessionId === activeSessionId);

    try {
      const stream = await sendMessage(activeSessionId, content, activeSession?.agentName);
      if (!stream) return;

      const reader = stream.getReader();
      const decoder = new TextDecoder();
      let accumulated = "";
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          const data = line.slice(6);
          if (data === "[DONE]") break;

          const parsed = parseChatStreamEvent(data);
          if (parsed.type === "text-delta") {
            accumulated += parsed.text;
            updateMessage(activeSessionId, assistantMessageId, accumulated);
          } else if (parsed.type === "done") {
            break;
          } else if (parsed.type === "error") {
            updateMessage(activeSessionId, assistantMessageId, `Error: ${parsed.error}`);
            break;
          }
        }
      }

      // Auto-play TTS if enabled
      if (ttsEnabled && accumulated.trim()) {
        playTTS(accumulated);
      }
    } catch {
      updateMessage(activeSessionId, assistantMessageId, "Error: Failed to get response");
    }
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  return (
    <div className="border-t bg-background p-3">
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
        <Button onClick={handleSubmit} disabled={!activeSessionId || !input.trim()}>
          Send
        </Button>
      </div>
    </div>
  );
}
