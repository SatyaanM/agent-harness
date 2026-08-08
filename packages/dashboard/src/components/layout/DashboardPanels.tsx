'use client';

import { Panel, PanelGroup, PanelResizeHandle } from 'react-resizable-panels';
import LeftPanel from './LeftPanel';
import RightPanel from './RightPanel';
import RuntimeSync from '@/components/chat/RuntimeSync';
import ReopenSessionModal from '@/components/chat/ReopenSessionModal';
import CommandPalette from '@/components/CommandPalette';

export default function DashboardPanels({ children }: { children: React.ReactNode }) {
  return (
    <>
      <RuntimeSync />
      <ReopenSessionModal />
      <CommandPalette />
      <PanelGroup direction="horizontal" className="h-full">
      <Panel defaultSize={50} minSize={20}>
        <LeftPanel>{children}</LeftPanel>
      </Panel>
      <PanelResizeHandle className="w-1 bg-zinc-200 transition-colors hover:bg-blue-500 dark:bg-zinc-800" />
      <Panel defaultSize={50} minSize={20}>
        <RightPanel />
      </Panel>
    </PanelGroup>
    </>
  );
}
