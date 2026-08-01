import { z } from "zod";

export const InboxRendererManifestSchema = z.object({
  extensions: z.array(z.string().min(1)).min(1),
  component: z.string().min(1),
  label: z.string().optional(),
});

export const PluginManifestSchema = z.object({
  name: z.string().min(1),
  version: z.string().min(1),
  description: z.string().optional(),
  provides: z.object({
    inboxRenderers: z.array(InboxRendererManifestSchema).optional(),
  }),
});

export type InboxRendererManifest = z.infer<typeof InboxRendererManifestSchema>;
export type PluginManifest = z.infer<typeof PluginManifestSchema>;
