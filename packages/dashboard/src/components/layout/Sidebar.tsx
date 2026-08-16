"use client";

import {
  Bot,
  ChevronsLeft,
  ChevronsRight,
  Inbox,
  Moon,
  Puzzle,
  Settings as SettingsIcon,
  Sun,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { useSidebarStore } from "@/stores/sidebar-store";
import { useThemeStore } from "@/stores/theme-store";

const NAV_ITEMS = [
  { href: "/", label: "Inbox", icon: Inbox },
  { href: "/agents", label: "Agents", icon: Bot },
  { href: "/plugins", label: "Plugins", icon: Puzzle },
  { href: "/settings", label: "Settings", icon: SettingsIcon },
];

export function Sidebar() {
  const { collapsed, init, toggle } = useSidebarStore();
  const pathname = usePathname();
  const theme = useThemeStore((s) => s.theme);
  const setTheme = useThemeStore((s) => s.setTheme);

  useEffect(() => {
    init();
  }, [init]);

  const link = (item: (typeof NAV_ITEMS)[number]) => {
    const isActive = item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);
    const Icon = item.icon;

    const content = (
      <Link
        href={item.href}
        aria-current={isActive ? "page" : undefined}
        className={`flex items-center justify-center gap-2.5 rounded-md px-2.5 py-2 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background md:justify-start ${
          isActive
            ? "bg-accent text-accent-foreground"
            : "text-muted-foreground hover:bg-accent/60 hover:text-accent-foreground"
        }`}
        title={item.label}
      >
        <Icon className="h-4 w-4 shrink-0" />
        {!collapsed && <span className="hidden truncate md:inline">{item.label}</span>}
      </Link>
    );

    if (!collapsed) return content;

    return (
      <Tooltip>
        <TooltipTrigger asChild>{content}</TooltipTrigger>
        <TooltipContent side="right">{item.label}</TooltipContent>
      </Tooltip>
    );
  };

  return (
    <TooltipProvider>
      <aside
        className={`z-20 flex shrink-0 flex-col border-r bg-background transition-[width] duration-200 ${
          collapsed ? "w-14" : "w-14 md:w-44"
        }`}
      >
        <div className="flex h-12 items-center justify-between border-b px-2">
          {!collapsed && (
            <span className="hidden truncate px-2 text-sm font-bold tracking-tight text-foreground md:block">
              Agent Harness
            </span>
          )}
          <Button
            variant="ghost"
            size="icon"
            onClick={toggle}
            title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            aria-label="Toggle sidebar"
            className={`${collapsed ? "mx-auto" : ""} hidden md:inline-flex`}
          >
            {collapsed ? (
              <ChevronsRight className="h-4 w-4" />
            ) : (
              <ChevronsLeft className="h-4 w-4" />
            )}
          </Button>
        </div>

        <nav className="flex flex-col gap-1 p-2">
          {NAV_ITEMS.map((item) => (
            <div key={item.href}>{link(item)}</div>
          ))}
        </nav>

        <div className="mt-auto flex items-center justify-center gap-1 border-t p-2">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
            title={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
            aria-label="Toggle color theme"
          >
            {theme === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
          </Button>
        </div>
      </aside>
    </TooltipProvider>
  );
}
