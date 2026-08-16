import type { z } from "zod";

export interface ToolExecutionContext {
  signal: AbortSignal;
}

export interface Tool<TParams extends z.ZodType = z.ZodType> {
  name: string;
  description: string;
  parameters: TParams;
  execute(args: z.infer<TParams>, context?: ToolExecutionContext): Promise<string>;
}

export interface ToolRegistry {
  register(tool: Tool): void;
  get(name: string): Tool | undefined;
  getAll(): Tool[];
}
