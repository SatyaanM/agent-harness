'use client';

import { useEffect, useRef, useState } from 'react';
import { useSessionStore, type Message } from '@/stores/session-store';
import { useTTSStore } from '@/stores/tts-store';
import { DelegationCard } from './DelegationCard';
import { CouncilCard } from './CouncilCard';
import { InboxLink } from './InboxLink';
import { MarkdownRenderer } from './MarkdownRenderer';

const TAG_INDICATORS: Record<string, string> = {
  excitedly: '✨',
  excited: '✨',
  amazed: '😲',
  sighs: '😮‍💨',
  laughs: '😄',
  giggles: '😊',
  whispers: '🤫',
  serious: '⚠️',
  gasp: '😮',
  crying: '😢',
  curious: '🤔',
  panicked: '😰',
  sarcastic: '😏',
  shouting: '📢',
  tired: '😴',
  trembling: '🫨',
  mischievously: '😈',
};

const TAG_REGEX = /\[([^\]]+)\]/g;

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

function extractTagIndicators(content: string): string[] {
  const indicators: string[] = [];
  let match;
  while ((match = TAG_REGEX.exec(content)) !== null) {
    const tag = match[1].toLowerCase().split(',')[0].trim();
    const indicator = TAG_INDICATORS[tag];
    if (indicator && !indicators.includes(indicator)) {
      indicators.push(indicator);
    }
  }
  return indicators;
}

function stripEmotiveTags(content: string): string {
  return content.replace(TAG_REGEX, '').replace(/\s+/g, ' ').trim();
}

function UserMessage({ message }: { message: Message }) {
  return (
    <div className="flex justify-end">
      <div className="max-w-[80%]">
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
      console.error('TTS error:', error);
    } finally {
      setIsPlaying(false);
    }
  };

  return (
    <div className="flex justify-start">
      <div className="max-w-[80%]">
        <div className="rounded-lg bg-zinc-200 px-4 py-2 text-sm text-zinc-900 dark:bg-zinc-800 dark:text-zinc-100">
          <MarkdownRenderer content={displayContent} />
        </div>
        <div className="mt-1 flex items-center gap-2 text-[10px] text-zinc-400 dark:text-zinc-500">
          <span>{formatTime(message.createdAt)}</span>
          {indicators.length > 0 && (
            <span className="text-xs" title="Emotive tags in speech">
              {indicators.join(' ')}
            </span>
          )}
          {enabled && (
            <button
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
      <div className="rounded border border-zinc-300 bg-zinc-100 px-4 py-2 text-xs text-zinc-500 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-400">
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
      <div className="flex h-full items-center justify-center text-sm text-zinc-400 dark:text-zinc-500">
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
