import type { Metadata } from "next";
import { cookies } from "next/headers";
import DashboardPanels from "@/components/layout/DashboardPanels";
import { PluginProvider } from "@/components/layout/PluginProvider";
import { Sidebar } from "@/components/layout/Sidebar";
import { ThemeProvider } from "@/components/layout/ThemeProvider";
import "./globals.css";

export const metadata: Metadata = {
  title: "Agent Harness Dashboard",
  description: "Dashboard for the Agent Harness",
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const cookieStore = await cookies();
  const theme = cookieStore.get("theme")?.value;
  const themeClass = theme === "light" || theme === "dark" ? theme : undefined;

  return (
    <html lang="en" suppressHydrationWarning className={themeClass}>
      <head />
      <body>
        <ThemeProvider>
          <div className="flex h-screen min-w-0 overflow-hidden">
            <Sidebar />
            <PluginProvider>
              <DashboardPanels>{children}</DashboardPanels>
            </PluginProvider>
          </div>
        </ThemeProvider>
      </body>
    </html>
  );
}
