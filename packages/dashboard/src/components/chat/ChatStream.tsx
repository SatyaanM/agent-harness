"use client";

import { createLogger, describeError } from "@agent-harness/core/contracts";
import { useEffect, useRef, useState } from "react";
import { type Message, useSessionStore } from "@/stores/session-store";
import { useTTSStore } from "@/stores/tts-store";
import { CouncilCard } from "./CouncilCard";
import { DelegationCard } from "./DelegationCard";
import { InboxLink } from "./InboxLink";
import { MarkdownRenderer } from "./MarkdownRenderer";

const logger = createLogger("dashboard.chat-stream");

const TAG_INDICATORS: Record<string, string> = {
  excitedly: "✨",
  excited: "✨",
  amazed: "😲",
  sighs: "😮‍💨",
  laughs: "😄",
  giggles: "😊",
  whispers: "🤫",
  serious: "⚠️",
  gasp: "😮",
  crying: "😢",
  curious: "🤔",
  panicked: "😰",
  sarcastic: "😏",
  shouting: "📢",
  tired: "😴",
  trembling: "🫨",
  mischievously: "😈",
};

const TAG_REGEX = /\[([^\]]+)\]/g;

function stripToolCalls(content: string): string {
  let cleaned = content;

  const toolCallStart = "<" + "tool_call>";
  const toolCallEnd = "<" + "/tool_call>";
  while (true) {
    const startIdx = cleaned.indexOf(toolCallStart);
    if (startIdx === -1) break;
    const endIdx = cleaned.indexOf(toolCallEnd, startIdx);
    if (endIdx === -1) break;
    cleaned = cleaned.slice(0, startIdx) + cleaned.slice(endIdx + toolCallEnd.length);
  }

  const toolResultStart = "<" + "tool_result>";
  const toolResultEnd = "<" + "/tool_result>";
  while (true) {
    const startIdx = cleaned.indexOf(toolResultStart);
    if (startIdx === -1) break;
    const endIdx = cleaned.indexOf(toolResultEnd, startIdx);
    if (endIdx === -1) break;
    cleaned = cleaned.slice(0, startIdx) + cleaned.slice(endIdx + toolResultEnd.length);
  }

  return cleaned.trim();
}

function formatTime(isoString: string): string {
  const date = new Date(isoString);
  return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max)}…`;
}

function extractTagIndicators(content: string): string[] {
  const indicators: string[] = [];
  let match = TAG_REGEX.exec(content);
  while (match !== null) {
    const tag = match[1].toLowerCase().split(",")[0].trim();
    const indicator = TAG_INDICATORS[tag];
    if (indicator && !indicators.includes(indicator)) {
      indicators.push(indicator);
    }
    match = TAG_REGEX.exec(content);
  }
  return indicators;
}

function stripEmotiveTags(content: string): string {
  return content.replace(TAG_REGEX, "").replace(/\s+/g, " ").trim();
}

function UserMessage({ message }: { message: Message }) {
  return (
    <div className="flex min-w-0 justify-end">
      <div className="max-w-[80%] min-w-0 break-words">
        <div className="rounded-lg bg-blue-600 px-4 py-2 text-sm text-white">
          <MarkdownRenderer content={message.content} className="prose-invert" />
        </div>
        <div className="mt-1 text-right text-[10px] text-zinc-400 dark:text-zinc-500">
          {formatTime(message.createdAt)}
        </div>
      </div>
    </div>
  );
}

function ToolCallBlock({
  toolName,
  args,
  result,
}: {
  toolName: string;
  args?: Record<string, unknown>;
  result?: string;
}) {
  const [expanded, setExpanded] = useState(false);

  const argHint = args
    ? Object.entries(args)
        .map(([key, value]) => `${key}=${String(value)}`)
        .join(" ")
    : "";
  const hint = argHint.length > 0 ? ` → ${truncate(argHint, 80)}` : "";

  return (
    <div className="my-1.5 overflow-hidden rounded-md border border-zinc-300 bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-900">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="flex w-full min-w-0 items-center gap-2 px-3 py-1.5 text-left font-mono text-xs text-zinc-700 transition-colors hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800"
      >
        <span className={expanded ? "text-zinc-500" : "text-blue-600 dark:text-blue-400"}>
          {expanded ? "▾" : "▸"}
        </span>
        <span className="shrink-0 font-medium">⚙ {toolName}</span>
        <span className="min-w-0 flex-1 break-words text-zinc-500 dark:text-zinc-400">{hint}</span>
        <span className="ml-auto shrink-0 text-[10px] uppercase tracking-wide text-zinc-400">
          {expanded ? "hide" : "details"}
        </span>
      </button>
      {expanded && (
        <div className="space-y-2 border-t border-zinc-200 px-3 py-2 dark:border-zinc-700">
          {args && (
            <div>
              <div className="mb-0.5 text-[10px] font-medium uppercase tracking-wide text-zinc-400">
                Arguments
              </div>
              <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-all rounded bg-zinc-100 p-2 font-mono text-[11px] text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300">
                {JSON.stringify(args, null, 2)}
              </pre>
            </div>
          )}
          {result !== undefined && (
            <div>
              <div className="mb-0.5 text-[10px] font-medium uppercase tracking-wide text-zinc-400">
                Result
              </div>
              <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-all rounded bg-zinc-100 p-2 font-mono text-[11px] text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300">
                {result}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function ReasoningBlock({ reasoning }: { reasoning: string }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="my-1.5 overflow-hidden rounded-md border border-dashed border-zinc-300 bg-zinc-50/60 dark:border-zinc-700 dark:bg-zinc-900/60">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs text-zinc-600 transition-colors hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-800"
      >
        <span>{expanded ? "▾" : "▸"}</span>
        <span className="italic">Reasoning</span>
        <span className="ml-auto shrink-0 text-[10px] uppercase tracking-wide text-zinc-400">
          {expanded ? "hide" : "show"}
        </span>
      </button>
      {expanded && (
        <div className="border-t border-zinc-200 px-3 py-2 dark:border-zinc-700">
          <p className="whitespace-pre-wrap break-words font-mono text-[11px] leading-relaxed text-zinc-600 dark:text-zinc-400">
            {reasoning}
          </p>
        </div>
      )}
    </div>
  );
}

function ToolResultBlock({ message }: { message: Message }) {
  const [expanded, setExpanded] = useState(false);
  const preview = truncate(message.content, 120);

  return (
    <div className="my-1.5 overflow-hidden rounded-md border border-zinc-300 bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-900">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="flex w-full min-w-0 items-center gap-2 px-3 py-1.5 text-left font-mono text-xs text-zinc-700 transition-colors hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800"
      >
        <span className={expanded ? "text-zinc-500" : "text-emerald-600 dark:text-emerald-400"}>
          {expanded ? "▾" : "▸"}
        </span>
        <span className="shrink-0 text-emerald-600 dark:text-emerald-400">✓</span>
        <span className="min-w-0 flex-1 break-words text-zinc-500 dark:text-zinc-400">
          {preview}
        </span>
        <span className="ml-auto shrink-0 text-[10px] uppercase tracking-wide text-zinc-400">
          {expanded ? "hide" : "result"}
        </span>
      </button>
      {expanded && (
        <div className="border-t border-zinc-200 px-3 py-2 dark:border-zinc-700">
          <pre className="max-h-80 overflow-auto whitespace-pre-wrap break-all rounded bg-zinc-100 p-2 font-mono text-[11px] text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300">
            {message.content}
          </pre>
        </div>
      )}
    </div>
  );
}

function AssistantMessage({ message }: { message: Message }) {
  const cleanedContent = stripToolCalls(message.content);
  const displayContent = stripEmotiveTags(cleanedContent);
  const { enabled, play } = useTTSStore();
  const indicators = extractTagIndicators(cleanedContent);
  const [isPlaying, setIsPlaying] = useState(false);

  const handlePlay = async () => {
    setIsPlaying(true);
    try {
      await play(displayContent);
    } catch (error) {
      logger.error("TTS error", { ...describeError(error) });
    } finally {
      setIsPlaying(false);
    }
  };

  return (
    <div className="flex min-w-0 justify-start">
      <div className="max-w-[80%] min-w-0 break-words">
        {message.reasoning && <ReasoningBlock reasoning={message.reasoning} />}
        {message.toolCalls?.map((tc, i) => (
          <ToolCallBlock key={tc.toolCallId ?? i} toolName={tc.toolName} args={tc.args} />
        ))}
        {displayContent && (
          <div className="rounded-lg bg-zinc-200 px-4 py-2 text-sm text-zinc-900 dark:bg-zinc-800 dark:text-zinc-100">
            <MarkdownRenderer content={displayContent} />
          </div>
        )}
        <div className="mt-1 flex items-center gap-2 text-[10px] text-zinc-400 dark:text-zinc-500">
          <span>{formatTime(message.createdAt)}</span>
          {indicators.length > 0 && (
            <span className="text-xs" title="Emotive tags in speech">
              {indicators.join(" ")}
            </span>
          )}
          {enabled && (
            <button
              type="button"
              onClick={handlePlay}
              disabled={isPlaying}
              className="text-blue-600 hover:text-blue-800 disabled:text-zinc-400 dark:text-blue-400 dark:hover:text-blue-300 dark:disabled:text-zinc-600"
              title="Listen to this message"
            >
              {isPlaying ? (
                <span className="animate-pulse">Playing...</span>
              ) : (
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  className="h-3 w-3 inline"
                  viewBox="0 0 24 24"
                  fill="currentColor"
                >
                  <title>Play message</title>
                  <polygon points="5 3 19 12 5 21 5 3" />
                </svg>
              )}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function SystemCard({ message }: { message: Message }) {
  if (message.event) {
    const eventType = message.event.type;
    if (eventType === "delegation" || eventType === "delegation_complete") {
      return <DelegationCard event={message.event} />;
    }
    if (
      eventType === "council_created" ||
      eventType === "council_message" ||
      eventType === "council_dissolved"
    ) {
      return <CouncilCard event={message.event} />;
    }
    if (eventType === "inbox_link") {
      return <InboxLink event={message.event} />;
    }
  }

  return (
    <div className="flex min-w-0 justify-center">
      <div className="min-w-0 max-w-[85%] break-words rounded border border-zinc-300 bg-zinc-100 px-4 py-2 text-xs text-zinc-500 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-400">
        {message.content}
        {message.createdAt && (
          <span className="ml-2 text-[10px] text-zinc-400 dark:text-zinc-500">
            {formatTime(message.createdAt)}
          </span>
        )}
      </div>
    </div>
  );
}

export default function ChatStream() {
  const sessions = useSessionStore((s) => s.sessions);
  const activeSessionId = useSessionStore((s) => s.activeSessionId);
  const bottomRef = useRef<HTMLDivElement>(null);

  const activeSession = sessions.find((s) => s.sessionId === activeSessionId);
  const messages = activeSession?.messages ?? [];

  // biome-ignore lint/correctness/useExhaustiveDependencies: The message count is an intentional trigger for scrolling to the newest entry.
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length]);

  if (!activeSessionId) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-zinc-400 dark:text-zinc-500">
        Create or reopen a session to start chatting.
      </div>
    );
  }

  return (
    <div className="h-full overflow-x-hidden overflow-y-auto p-4">
      <div className="flex min-w-0 flex-col gap-3">
        {messages.map((message) => {
          if (message.role === "user") return <UserMessage key={message.id} message={message} />;
          if (message.role === "system") return <SystemCard key={message.id} message={message} />;
          if (message.role === "tool") {
            return (
              <div className="flex min-w-0 justify-start">
                <div className="max-w-[80%] min-w-0 break-words">
                  <ToolResultBlock message={message} />
                </div>
              </div>
            );
          }
          return <AssistantMessage key={message.id} message={message} />;
        })}
        <div ref={bottomRef} />
      </div>
    </div>
  );
}
