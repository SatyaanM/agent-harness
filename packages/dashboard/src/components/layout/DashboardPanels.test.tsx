import { cleanup, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import DashboardPanels from "./DashboardPanels";

vi.mock("react-resizable-panels", () => ({
  PanelGroup: ({
    children,
    direction,
    className,
  }: {
    children: ReactNode;
    direction: string;
    className?: string;
  }) => (
    <div data-testid="panel-group" data-direction={direction} className={className}>
      {children}
    </div>
  ),
  Panel: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  PanelResizeHandle: ({ children, ...props }: { children?: ReactNode; [key: string]: unknown }) => (
    <div data-testid="resize-handle" {...props}>
      {children}
    </div>
  ),
}));

vi.mock("@/components/CommandPalette", () => ({ default: () => null }));
vi.mock("@/components/chat/ReopenSessionModal", () => ({ default: () => null }));
vi.mock("@/components/chat/RuntimeSync", () => ({ default: () => null }));
vi.mock("./LeftPanel", () => ({
  default: ({ children }: { children: ReactNode }) => <>{children}</>,
}));
vi.mock("./RightPanel", () => ({ default: () => <div>Chat</div> }));

function installMatchMedia(matches: boolean) {
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: vi.fn().mockImplementation(() => ({
      matches,
      media: "(max-width: 1023px)",
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  });
}

afterEach(() => {
  cleanup();
});

describe("DashboardPanels", () => {
  it("uses a main landmark and stacks panels at narrow widths", () => {
    installMatchMedia(true);

    render(
      <DashboardPanels>
        <div>Workspace</div>
      </DashboardPanels>,
    );

    expect(screen.getByRole("main")).toBeInTheDocument();
    expect(screen.getByTestId("panel-group")).toHaveAttribute("data-direction", "vertical");
    expect(screen.getByTestId("resize-handle")).toHaveAttribute("aria-orientation", "horizontal");
    expect(screen.getByTestId("resize-handle")).toHaveClass("h-3", "focus-visible:ring-2");
  });

  it("keeps the desktop split horizontal with a vertical resize handle", () => {
    installMatchMedia(false);

    render(
      <DashboardPanels>
        <div>Workspace</div>
      </DashboardPanels>,
    );

    expect(screen.getByTestId("panel-group")).toHaveAttribute("data-direction", "horizontal");
    expect(screen.getByTestId("resize-handle")).toHaveAttribute("aria-orientation", "vertical");
    expect(screen.getByTestId("resize-handle")).toHaveClass("w-3", "focus-visible:ring-2");
  });
});
