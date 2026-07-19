'use client';

import { useState, type FormEvent, type KeyboardEvent } from 'react';
import { useSessionStore } from '@/stores/session-store';
import { useTTSStore } from '@/stores/tts-store';
import { sendMessage } from '@/lib/api';
import { TTSButton } from './TTSButton';

export default function ChatInput() {
  const [input, setInput] = useState('');
  const activeSessionId = useSessionStore((s) => s.activeSessionId);
  const addMessage = useSessionStore((s) => s.addMessage);
  const updateMessage = useSessionStore((s) => s.updateMessage);
  const ttsEnabled = useTTSStore((s) => s.enabled);
  const playTTS = useTTSStore((s) => s.play);

  const handleSubmit = async () => {
    if (!input.trim() || !activeSessionId) return;

    const userMessageId = crypto.randomUUID();
    addMessage(activeSessionId, {
      id: userMessageId,
      role: 'user',
      content: input.trim(),
      createdAt: new Date().toISOString(),
    });

    const assistantMessageId = crypto.randomUUID();
    addMessage(activeSessionId, {
      id: assistantMessageId,
      role: 'assistant',
      content: '',
      createdAt: new Date().toISOString(),
    });

    const content = input.trim();
    setInput('');

    try {
      const stream = await sendMessage(activeSessionId, content);
      if (!stream) return;

      const reader = stream.getReader();
      const decoder = new TextDecoder();
      let accumulated = '';
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          const data = line.slice(6);
          if (data === '[DONE]') break;

          try {
            const parsed = JSON.parse(data);
            if (parsed.type === 'text-delta') {
              accumulated += parsed.text;
              updateMessage(activeSessionId, assistantMessageId, accumulated);
            } else if (parsed.type === 'done') {
              break;
            } else if (parsed.type === 'error') {
              updateMessage(activeSessionId, assistantMessageId, `Error: ${parsed.error}`);
              break;
            }
          } catch {
            // Skip malformed JSON
          }
        }
      }

      // Auto-play TTS if enabled
      if (ttsEnabled && accumulated.trim()) {
        playTTS(accumulated);
      }
    } catch {
      updateMessage(
        activeSessionId,
        assistantMessageId,
        'Error: Failed to get response'
      );
    }
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  return (
    <div className="border-t border-gray-200 bg-white p-3">
      <div className="flex items-end gap-2">
        <TTSButton />
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder={activeSessionId ? 'Type a message...' : 'Create a session first'}
          disabled={!activeSessionId}
          rows={1}
          className="flex-1 resize-none rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none disabled:bg-gray-100"
        />
        <button
          onClick={handleSubmit}
          disabled={!activeSessionId || !input.trim()}
          className="rounded-lg bg-blue-600 px-4 py-2 text-sm text-white transition-colors hover:bg-blue-700 disabled:bg-gray-300"
        >
          Send
        </button>
      </div>
    </div>
  );
}
