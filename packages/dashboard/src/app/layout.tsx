import type { Metadata } from 'next';
import Link from 'next/link';
import DashboardPanels from '@/components/layout/DashboardPanels';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import './globals.css';

export const metadata: Metadata = {
  title: 'Agent Harness Dashboard',
  description: 'Dashboard for the Agent Harness',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>
        <ErrorBoundary>
          <nav className="flex items-center gap-4 border-b border-zinc-800 bg-zinc-950 px-4 py-2">
            <span className="text-sm font-bold text-zinc-200 tracking-tight">Agent Harness</span>
            <div className="flex items-center gap-1 ml-4">
              <NavLink href="/">Inbox</NavLink>
              <NavLink href="/agents">Agents</NavLink>
              <NavLink href="/settings">Settings</NavLink>
            </div>
          </nav>
          <DashboardPanels>{children}</DashboardPanels>
        </ErrorBoundary>
      </body>
    </html>
  );
}

function NavLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      className="rounded px-2.5 py-1 text-xs font-medium text-zinc-400 transition-colors hover:bg-zinc-800 hover:text-zinc-200"
    >
      {children}
    </Link>
  );
}
