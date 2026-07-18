'use client';

import { SettingsForm } from '@/components/settings/SettingsForm';

export default function SettingsPage() {
  return (
    <div className="flex flex-col h-full">
      <div className="px-4 py-3 border-b border-zinc-800">
        <h2 className="text-sm font-semibold text-zinc-300 uppercase tracking-wider">
          Settings
        </h2>
      </div>
      <div className="flex-1 overflow-y-auto p-4">
        <SettingsForm />
      </div>
    </div>
  );
}
