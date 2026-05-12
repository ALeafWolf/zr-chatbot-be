import { zodToJsonSchema } from "zod-to-json-schema";
import { env } from "../../config/env";
import type { ToolCtx, ToolDef } from "./types";
import { webSearchTool } from "./webSearchTool";
import { canonLookupTool } from "./canonLookupTool";

/** OpenAI-compatible tool schema for providers. */
export interface OpenAIToolDefinition {
  type: "function";
  function: {
    name: string;
    description?: string;
    parameters: Record<string, unknown>;
  };
}

const registry = new Map<string, ToolDef<unknown, Record<string, unknown>>>();

export function registerTool<TArgs, TResult extends Record<string, unknown>>(
  def: ToolDef<TArgs, TResult>,
): void {
  registry.set(def.name, def as ToolDef<unknown, Record<string, unknown>>);
}

export function getOpenAISchemas(): OpenAIToolDefinition[] {
  const out: OpenAIToolDefinition[] = [];
  for (const def of registry.values()) {
    const parameters = zodToJsonSchema(def.parameters as never, {
      target: "openApi3",
      $refStrategy: "none",
    }) as Record<string, unknown>;
    out.push({
      type: "function",
      function: {
        name: def.name,
        description: def.description,
        parameters,
      },
    });
  }
  return out;
}

export async function dispatchTool(
  name: string,
  rawArgs: unknown,
  ctx: ToolCtx,
): Promise<{ result: Record<string, unknown>; summary: string }> {
  const def = registry.get(name);
  if (!def) {
    const err = { error: `unknown_tool:${name}` };
    return { result: err, summary: `Unknown tool: ${name}` };
  }
  const parsed = def.parameters.safeParse(rawArgs);
  if (!parsed.success) {
    const err = { error: "invalid_args", detail: parsed.error.message };
    return { result: err, summary: "Invalid tool arguments." };
  }
  const result = await def.execute(parsed.data, ctx);
  return { result, summary: def.summarize(parsed.data, result) };
}

export function defaultTools(): void {
  registerTool(webSearchTool);
  if (env.CANON_LOOKUP_TOOL_ENABLED) registerTool(canonLookupTool);
}
