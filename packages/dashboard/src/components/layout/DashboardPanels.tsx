'use client';

import { Panel, PanelGroup, PanelResizeHandle } from 'react-resizable-panels';
import LeftPanel from './LeftPanel';
import RightPanel from './RightPanel';

export default function DashboardPanels({ children }: { children: React.ReactNode }) {
  return (
    <PanelGroup direction="horizontal" className="h-[calc(100vh-41px)]">
      <Panel defaultSize={50} minSize={20}>
        <LeftPanel>{children}</LeftPanel>
      </Panel>
      <PanelResizeHandle className="w-1 bg-gray-200 transition-colors hover:bg-blue-500" />
      <Panel defaultSize={50} minSize={20}>
        <RightPanel />
      </Panel>
    </PanelGroup>
  );
}
