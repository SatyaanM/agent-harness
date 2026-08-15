import { z } from "zod";

export const PluginIdentifierSchema = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/u);

export const InboxRendererManifestSchema = z
  .object({
    extensions: z
      .array(
        z
          .string()
          .min(1)
          .max(32)
          .regex(/^[A-Za-z0-9]+$/u),
      )
      .min(1)
      .max(64),
    component: PluginIdentifierSchema,
    label: z.string().min(1).max(256).optional(),
  })
  .strict();

export const PluginCommandManifestSchema = z
  .object({
    id: PluginIdentifierSchema,
    label: z.string().min(1).max(256),
    keywords: z.string().max(2_048).optional(),
    group: z.string().max(128).optional(),
    icon: PluginIdentifierSchema.optional(),
    action: z.discriminatedUnion("type", [
      z
        .object({
          type: z.literal("navigate"),
          href: z.string().min(1).max(2_048).refine(isLocalNavigationPath, "must be local"),
        })
        .strict(),
      z.object({ type: z.literal("builtin"), commandId: PluginIdentifierSchema }).strict(),
    ]),
  })
  .strict();

export const PluginManifestSchema = z
  .object({
    name: PluginIdentifierSchema,
    version: z.string().min(1).max(128),
    description: z.string().max(10_000).optional(),
    provides: z
      .object({
        inboxRenderers: z.array(InboxRendererManifestSchema).max(128).optional(),
        commands: z.array(PluginCommandManifestSchema).max(256).optional(),
      })
      .strict(),
  })
  .strict();

export type InboxRendererManifest = z.infer<typeof InboxRendererManifestSchema>;
export type PluginCommandManifest = z.infer<typeof PluginCommandManifestSchema>;
export type PluginManifest = z.infer<typeof PluginManifestSchema>;

function isLocalNavigationPath(value: string): boolean {
  if (
    !value.startsWith("/") ||
    value.startsWith("//") ||
    containsUnsafeNavigationCharacter(value)
  ) {
    return false;
  }
  const base = "https://dashboard.invalid";
  return new URL(value, base).origin === base;
}

function containsUnsafeNavigationCharacter(value: string): boolean {
  for (const character of value) {
    const code = character.charCodeAt(0);
    if (character === "\\" || code <= 0x1f || code === 0x7f) {
      return true;
    }
  }
  return false;
}
