'use client';

import { useEffect, useRef, useState } from 'react';
import {
  Panel,
  PanelGroup,
  PanelResizeHandle,
  type ImperativePanelHandle,
} from 'react-resizable-panels';
import { FileExplorer } from './FileExplorer';
import { InboxContentView } from './InboxContentView';
import { useInboxWorkspaceStore } from '@/stores/inbox-workspace-store';

export function InboxWorkspace() {
  const explorerRef = useRef<ImperativePanelHandle>(null);
  const [collapsed, setCollapsed] = useState(false);
  const selectedPath = useInboxWorkspaceStore((s) => s.selectedPath);
  const setSelectedPath = useInboxWorkspaceStore((s) => s.setSelectedPath);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const file = params.get('file');
    if (file) setSelectedPath(file);
  }, [setSelectedPath]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (selectedPath) {
      params.set('file', selectedPath);
    } else {
      params.delete('file');
    }
    const qs = params.toString();
    const url = qs ? `${window.location.pathname}?${qs}` : window.location.pathname;
    window.history.replaceState(null, '', url);
  }, [selectedPath]);

  const toggleCollapsed = () => {
    const panel = explorerRef.current;
    if (!panel) return;
    if (collapsed) {
      panel.expand();
    } else {
      panel.collapse();
    }
  };

  return (
    <PanelGroup direction="horizontal" autoSaveId="inbox-workspace" className="h-full">
      <Panel
        ref={explorerRef}
        id="inbox-explorer"
        defaultSize={30}
        minSize={12}
        maxSize={60}
        collapsible
        collapsedSize={4}
        onCollapse={() => setCollapsed(true)}
        onExpand={() => setCollapsed(false)}
      >
        <FileExplorer collapsed={collapsed} onToggleCollapse={toggleCollapsed} />
      </Panel>
      <PanelResizeHandle className="w-1 bg-border transition-colors hover:bg-blue-500" />
      <Panel id="inbox-content" defaultSize={70} minSize={20}>
        <InboxContentView />
      </Panel>
    </PanelGroup>
  );
}
