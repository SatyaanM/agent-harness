"use client";

import { useSyncExternalStore } from "react";
import { Panel, PanelGroup, PanelResizeHandle } from "react-resizable-panels";
import CommandPalette from "@/components/CommandPalette";
import ReopenSessionModal from "@/components/chat/ReopenSessionModal";
import RuntimeSync from "@/components/chat/RuntimeSync";
import LeftPanel from "./LeftPanel";
import RightPanel from "./RightPanel";

const NARROW_LAYOUT_QUERY = "(max-width: 1023px)";

function subscribeToNarrowLayout(callback: () => void) {
  const mediaQuery = window.matchMedia(NARROW_LAYOUT_QUERY);
  mediaQuery.addEventListener("change", callback);
  return () => mediaQuery.removeEventListener("change", callback);
}

function getNarrowLayoutSnapshot() {
  return window.matchMedia(NARROW_LAYOUT_QUERY).matches;
}

function getServerNarrowLayoutSnapshot() {
  return false;
}

export default function DashboardPanels({ children }: { children: React.ReactNode }) {
  const isNarrow = useSyncExternalStore(
    subscribeToNarrowLayout,
    getNarrowLayoutSnapshot,
    getServerNarrowLayoutSnapshot,
  );
  const direction = isNarrow ? "vertical" : "horizontal";

  return (
    <>
      <RuntimeSync />
      <ReopenSessionModal />
      <CommandPalette />
      <main className="min-w-0 flex-1 overflow-hidden">
        <PanelGroup key={direction} direction={direction} className="h-full min-w-0">
          <Panel defaultSize={50} minSize={20}>
            <LeftPanel>{children}</LeftPanel>
          </Panel>
          <PanelResizeHandle
            aria-label={
              isNarrow ? "Resize workspace and chat vertically" : "Resize workspace and chat"
            }
            aria-orientation={isNarrow ? "horizontal" : "vertical"}
            className={`group relative z-10 flex shrink-0 items-center justify-center bg-transparent outline-none transition-colors focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-1 focus-visible:ring-offset-background ${
              isNarrow ? "h-3 cursor-row-resize" : "w-3 cursor-col-resize"
            }`}
          >
            <span
              aria-hidden="true"
              className={`bg-zinc-400 transition-colors group-hover:bg-blue-500 group-focus-visible:bg-blue-500 dark:bg-zinc-600 ${
                isNarrow ? "h-px w-full" : "h-full w-px"
              }`}
            />
          </PanelResizeHandle>
          <Panel defaultSize={50} minSize={20}>
            <RightPanel />
          </Panel>
        </PanelGroup>
      </main>
    </>
  );
}
