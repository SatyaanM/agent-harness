'use client';

import { useEffect, useRef, useState } from 'react';
import { useSessionStore, type Message } from '@/stores/session-store';
import { DelegationCard } from './DelegationCard';
import { CouncilCard } from './CouncilCard';
import { InboxLink } from './InboxLink';
import { MarkdownRenderer } from './MarkdownRenderer';

function stripToolCalls(content: string): string {
  let cleaned = content;
  
  const toolCallStart = '<' + 'tool_call>';
  const toolCallEnd = '<' + '/tool_call>';
  while (true) {
    const startIdx = cleaned.indexOf(toolCallStart);
    if (startIdx === -1) break;
    const endIdx = cleaned.indexOf(toolCallEnd, startIdx);
    if (endIdx === -1) break;
    cleaned = cleaned.slice(0, startIdx) + cleaned.slice(endIdx + toolCallEnd.length);
  }
  
  const toolResultStart = '<' + 'tool_result>';
  const toolResultEnd = '<' + '/tool_result>';
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
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function UserMessage({ message }: { message: Message }) {
  return (
    <div className="flex justify-end">
      <div className="max-w-[80%]">
        <div className="rounded-lg bg-blue-600 px-4 py-2 text-sm text-white">
          <MarkdownRenderer content={message.content} className="prose-invert" />
        </div>
        <div className="mt-1 text-right text-[10px] text-gray-400">
          {formatTime(message.createdAt)}
        </div>
      </div>
    </div>
  );
}

function AssistantMessage({ message }: { message: Message }) {
  const cleanedContent = stripToolCalls(message.content);
  return (
    <div className="flex justify-start">
      <div className="max-w-[80%]">
        <div className="rounded-lg bg-gray-200 px-4 py-2 text-sm text-gray-900">
          <MarkdownRenderer content={cleanedContent} />
        </div>
        <div className="mt-1 text-[10px] text-gray-400">
          {formatTime(message.createdAt)}
        </div>
      </div>
    </div>
  );
}

function SystemCard({ message }: { message: Message }) {
  if (message.event) {
    const eventType = message.event.type;
    if (eventType === 'delegation' || eventType === 'delegation_complete') {
      return <DelegationCard event={message.event} />;
    }
    if (eventType === 'council_created' || eventType === 'council_message' || eventType === 'council_dissolved') {
      return <CouncilCard event={message.event} />;
    }
    if (eventType === 'inbox_link') {
      return <InboxLink event={message.event} />;
    }
  }
  
  return (
    <div className="flex justify-center">
      <div className="rounded border border-gray-300 bg-gray-100 px-4 py-2 text-xs text-gray-500">
        {message.content}
        {message.createdAt && (
          <span className="ml-2 text-[10px] text-gray-400">
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
  const [error, setError] = useState<string | null>(null);

  const activeSession = sessions.find((s) => s.sessionId === activeSessionId);
  const messages = activeSession?.messages ?? [];

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages.length]);

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-3 p-4">
        <div className="text-red-400 text-sm">{error}</div>
        <button
          onClick={() => setError(null)}
          className="px-3 py-1.5 bg-blue-600 text-white text-xs rounded hover:bg-blue-700 transition-colors"
        >
          Retry
        </button>
      </div>
    );
  }

  if (!activeSessionId) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-gray-400">
        Loading messages...
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto p-4">
      <div className="flex flex-col gap-3">
        {messages.map((message) => {
          if (message.role === 'user') return <UserMessage key={message.id} message={message} />;
          if (message.role === 'system') return <SystemCard key={message.id} message={message} />;
          return <AssistantMessage key={message.id} message={message} />;
        })}
        <div ref={bottomRef} />
      </div>
    </div>
  );
}
