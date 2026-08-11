import type { ComponentType } from "react";
import {
  CsvRenderer,
  ExcalidrawRenderer,
  HtmlRenderer,
  ImageRenderer,
  MarkdownRenderer,
  PdfRenderer,
  TextRenderer,
} from "@/components/inbox/renderers";

export interface InboxRendererProps {
  content: string;
  item?: { name: string; type: string; path?: string };
}

export type InboxRendererComponent = ComponentType<InboxRendererProps>;

const inboxRendererComponents: Record<string, InboxRendererComponent> = {
  MarkdownRenderer,
  HtmlRenderer,
  ImageRenderer,
  PdfRenderer,
  CsvRenderer,
  ExcalidrawRenderer,
};

export const fallbackRenderer: InboxRendererComponent = TextRenderer;

export function resolveRenderer(componentKey: string): InboxRendererComponent | null {
  return inboxRendererComponents[componentKey] ?? null;
}
