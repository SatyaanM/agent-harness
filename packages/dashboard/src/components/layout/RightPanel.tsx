'use client';

import SessionTabs from '@/components/chat/SessionTabs';
import ChatStream from '@/components/chat/ChatStream';
import ChatInput from '@/components/chat/ChatInput';
import { usePanelStore } from '@/stores/panel-store';

export default function RightPanel() {
  const collapsed = usePanelStore((s) => s.collapsed);

  if (collapsed) return null;

  return (
    <div className="flex h-full flex-col bg-zinc-50 dark:bg-zinc-950">
      <SessionTabs />
      <div className="flex-1 overflow-hidden">
        <ChatStream />
      </div>
      <ChatInput />
    </div>
  );
}
