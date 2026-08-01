import type { Metadata } from 'next';
import { ThemeProvider } from '@/components/layout/ThemeProvider';
import { Sidebar } from '@/components/layout/Sidebar';
import { PluginProvider } from '@/components/layout/PluginProvider';
import DashboardPanels from '@/components/layout/DashboardPanels';
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
    <html lang="en" suppressHydrationWarning>
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var t=localStorage.getItem('theme');if(t==='light'||t==='dark'){document.documentElement.classList.toggle('dark',t==='dark')}else if(window.matchMedia('(prefers-color-scheme: dark)').matches){document.documentElement.classList.add('dark')}}catch(e){}})();`,
          }}
        />
      </head>
      <body>
        <ThemeProvider>
          <div className="flex h-screen">
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
