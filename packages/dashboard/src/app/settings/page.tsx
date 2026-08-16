"use client";

import { SettingsForm } from "@/components/settings/SettingsForm";
import { VoiceSettings } from "@/components/settings/VoiceSettings";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

export default function SettingsPage() {
  return (
    <div className="flex flex-col h-full">
      <div className="px-4 py-3 border-b bg-background">
        <h2 className="text-sm font-semibold text-foreground uppercase tracking-wider">Settings</h2>
      </div>

      <div className="flex-1 overflow-y-auto p-4">
        <Tabs defaultValue="general" className="w-full">
          <TabsList>
            <TabsTrigger value="general">General</TabsTrigger>
            <TabsTrigger value="voice">Voice</TabsTrigger>
          </TabsList>
          <TabsContent value="general" className="mt-4">
            <SettingsForm />
          </TabsContent>
          <TabsContent value="voice" className="mt-4">
            <VoiceSettings />
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
