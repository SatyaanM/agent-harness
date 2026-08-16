import { BoundaryValidationError, parseJsonBoundary } from "@agent-harness/core/contracts";
import type { ExcalidrawInitialDataState } from "@excalidraw/excalidraw/types";
import { z } from "zod";

const ExcalidrawElementSchema = z
  .object({
    id: z.string().min(1),
    type: z.enum([
      "selection",
      "rectangle",
      "diamond",
      "ellipse",
      "embeddable",
      "iframe",
      "image",
      "frame",
      "magicframe",
      "line",
      "arrow",
      "freedraw",
      "text",
    ]),
    x: z.number().finite(),
    y: z.number().finite(),
    width: z.number().finite(),
    height: z.number().finite(),
    angle: z.number().finite(),
    strokeColor: z.string(),
    backgroundColor: z.string(),
    fillStyle: z.string(),
    strokeWidth: z.number().finite(),
    strokeStyle: z.string(),
    roughness: z.number().finite(),
    opacity: z.number().finite(),
    seed: z.number().int(),
    version: z.number().int(),
    versionNonce: z.number().int(),
    isDeleted: z.boolean(),
    groupIds: z.array(z.string()),
    frameId: z.string().nullable(),
    boundElements: z
      .array(z.object({ id: z.string(), type: z.enum(["arrow", "text"]) }))
      .nullable(),
    updated: z.number().finite(),
    link: z.string().nullable(),
    locked: z.boolean(),
  })
  .passthrough();

const ExcalidrawDocumentSchema = z
  .object({
    type: z.string().optional(),
    version: z.number().optional(),
    source: z.string().optional(),
    elements: z.array(ExcalidrawElementSchema).nullable().optional(),
    appState: z.record(z.unknown()).nullable().optional(),
    files: z.record(z.unknown()).optional(),
    scrollToContent: z.boolean().optional(),
  })
  .passthrough();

function isExcalidrawInitialData(value: unknown): value is ExcalidrawInitialDataState {
  return ExcalidrawDocumentSchema.safeParse(value).success;
}

export function parseExcalidrawContent(content: string): ExcalidrawInitialDataState {
  const value = parseJsonBoundary(z.unknown(), content, "Excalidraw document");
  if (!isExcalidrawInitialData(value)) {
    const details = ExcalidrawDocumentSchema.safeParse(value);
    throw new BoundaryValidationError(
      "Excalidraw document",
      details.success ? "invalid document" : details.error.message,
    );
  }
  return value;
}
