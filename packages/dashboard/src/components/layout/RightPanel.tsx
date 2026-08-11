"use client";

import AgentColumn from "@/components/chat/AgentColumn";
import ChatInput from "@/components/chat/ChatInput";
import ChatStream from "@/components/chat/ChatStream";
import SessionTabs from "@/components/chat/SessionTabs";
import { usePanelStore } from "@/stores/panel-store";

export default function RightPanel() {
  const collapsed = usePanelStore((s) => s.collapsed);

  if (collapsed) return null;

  return (
    <div className="flex h-full flex-col bg-zinc-50 dark:bg-zinc-950">
      <SessionTabs />
      <div className="flex min-h-0 flex-1">
        <AgentColumn />
        <div className="flex min-h-0 flex-1 flex-col">
          <div className="flex-1 overflow-hidden">
            <ChatStream />
          </div>
          <ChatInput />
        </div>
      </div>
    </div>
  );
}
