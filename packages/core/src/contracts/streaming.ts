import { z } from "zod";

export const MAX_STREAM_DELTA_BYTES = 64_000;
export const MAX_STREAM_TOTAL_DELTA_BYTES = 10_000_000;
export const MAX_STREAM_TEXT_CHARS = 1_000_000;
export const MAX_STREAM_REASONING_CHARS = 1_000_000;
export const MAX_STREAM_TOOL_ARGUMENT_CHARS = 1_000_000;
export const MAX_STREAM_TOOL_CALL_ID_BYTES = 256;
export const MAX_STREAM_TOOL_NAME_BYTES = 128;

const ToolCallDeltaSchema = z
  .object({
    id: boundedUtf8String(MAX_STREAM_TOOL_CALL_ID_BYTES).pipe(z.string().min(1)),
    name: boundedUtf8String(MAX_STREAM_TOOL_NAME_BYTES).pipe(z.string().min(1)),
    argumentsDelta: boundedUtf8String(MAX_STREAM_DELTA_BYTES),
  })
  .strict();

export const ChatStreamEventSchema = z.discriminatedUnion("type", [
  z
    .object({ type: z.literal("text-delta"), text: boundedUtf8String(MAX_STREAM_DELTA_BYTES) })
    .strict(),
  z.object({ type: z.literal("tool-call-delta"), toolCall: ToolCallDeltaSchema }).strict(),
  z.object({ type: z.literal("done") }).strict(),
  z.object({ type: z.literal("error"), error: z.string().max(10_000) }).strict(),
]);
export type ChatStreamEvent = z.infer<typeof ChatStreamEventSchema>;

function boundedUtf8String(maxBytes: number): z.ZodType<string> {
  return z
    .string()
    .max(maxBytes)
    .refine(
      (value) => new TextEncoder().encode(value).byteLength <= maxBytes,
      `string must encode to at most ${maxBytes} UTF-8 bytes`,
    );
}
