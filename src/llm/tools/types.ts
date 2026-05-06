import type { ZodTypeAny } from "zod";

export interface ToolCtx {
  sessionId: string;
  signal: AbortSignal;
}

export interface ToolDef<TArgs, TResult extends Record<string, unknown>> {
  name: string;
  description: string;
  parameters: ZodTypeAny;
  execute(args: TArgs, ctx: ToolCtx): Promise<TResult>;
  summarize(args: TArgs, result: TResult): string;
}
