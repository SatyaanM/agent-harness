import { z } from "zod";

export const InboxRendererManifestSchema = z.object({
  extensions: z.array(z.string().min(1)).min(1),
  component: z.string().min(1),
  label: z.string().optional(),
});

export const PluginCommandManifestSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  keywords: z.string().optional(),
  group: z.string().optional(),
  icon: z.string().optional(),
  action: z.discriminatedUnion("type", [
    z.object({ type: z.literal("navigate"), href: z.string().min(1) }),
    z.object({ type: z.literal("builtin"), commandId: z.string().min(1) }),
  ]),
});

export const PluginManifestSchema = z.object({
  name: z.string().min(1),
  version: z.string().min(1),
  description: z.string().optional(),
  provides: z.object({
    inboxRenderers: z.array(InboxRendererManifestSchema).optional(),
    commands: z.array(PluginCommandManifestSchema).optional(),
  }),
});

export type InboxRendererManifest = z.infer<typeof InboxRendererManifestSchema>;
export type PluginCommandManifest = z.infer<typeof PluginCommandManifestSchema>;
export type PluginManifest = z.infer<typeof PluginManifestSchema>;
