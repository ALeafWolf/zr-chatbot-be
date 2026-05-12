import { getProvider } from "../llm/providers";
import { models } from "../config/models";
import type { ToolChatMessage } from "../llm/providers/providerTypes";
import { getOpenAISchemas, dispatchTool } from "../llm/tools";
import type { ToolCtx } from "../llm/tools/types";

export const MAX_TOOL_STEPS = 4;

export type GenerateWithToolsYield =
  | { type: "delta"; text?: string; reasoning?: string }
  | { type: "before_tool"; id: string; name: string; args: unknown }
  | {
      type: "after_tool";
      id: string;
      name: string;
      summary: string;
    }
  | { type: "done"; content: string; inputTokens: number; outputTokens: number };

function parseToolArgs(raw: string): unknown {
  try {
    return JSON.parse(raw || "{}") as unknown;
  } catch {
    return { raw };
  }
}

export interface GenerateWithToolsResult {
  content: string;
  inputTokens: number;
  outputTokens: number;
}

/**
 * Provider-native tool loop with streaming deltas surfaced as async iterable yields.
 */
export async function* generateWithToolsStream(input: {
  messages: ToolChatMessage[];
  ctx: ToolCtx;
  signal?: AbortSignal;
  enableTools?: boolean;
  /** Precomputed for {@link models.generation} only (e.g. DeepSeek thinking). */
  openAICompatibleRequestExtensions?: Record<string, unknown>;
  /** Max assistant completion rounds (each tool use consumes one round before the final reply). Default {@link MAX_TOOL_STEPS}. */
  maxToolSteps?: number;
}): AsyncGenerator<GenerateWithToolsYield> {
  const provider = getProvider(models.generation);
  const tools =
    input.enableTools !== false ? getOpenAISchemas() : undefined;
  const toolChoice =
    tools?.length && input.enableTools !== false ? "auto" : "none";

  let messages = [...input.messages];
  let totalIn = 0;
  let totalOut = 0;
  const maxSteps = input.maxToolSteps ?? MAX_TOOL_STEPS;

  for (let step = 0; step < maxSteps; step++) {
    let assistantText = "";
    let toolCalls:
      | Array<{ id: string; name: string; arguments: string }>
      | undefined;

    const stream = provider.streamChat(messages, {
      tools,
      toolChoice,
      maxTokens: 4096,
      temperature: 1.0,
      signal: input.signal,
      ...(input.openAICompatibleRequestExtensions !== undefined
        ? {
            openAICompatibleRequestExtensions:
              input.openAICompatibleRequestExtensions,
          }
        : {}),
    });

    for await (const ev of stream) {
      if (ev.type === "delta") {
        if (ev.text) {
          assistantText += ev.text;
          yield { type: "delta", text: ev.text };
        }
        if (ev.reasoning) {
          yield { type: "delta", reasoning: ev.reasoning };
        }
      }
      if (ev.type === "assistant_done") {
        assistantText = ev.content ?? assistantText;
        toolCalls = ev.toolCalls;
        totalIn += ev.usage.inputTokens;
        totalOut += ev.usage.outputTokens;
      }
    }

    if (!toolCalls?.length) {
      yield {
        type: "done",
        content: assistantText,
        inputTokens: totalIn,
        outputTokens: totalOut,
      };
      return;
    }

    const tc = toolCalls[0];
    const args = parseToolArgs(tc.arguments);

    yield { type: "before_tool", id: tc.id, name: tc.name, args };

    const dispatched = await dispatchTool(tc.name, args, input.ctx);

    yield {
      type: "after_tool",
      id: tc.id,
      name: tc.name,
      summary: dispatched.summary,
    };

    messages = [
      ...messages,
      {
        role: "assistant",
        content: assistantText || null,
        tool_calls: [
          {
            id: tc.id,
            type: "function",
            function: { name: tc.name, arguments: tc.arguments },
          },
        ],
      },
      {
        role: "tool",
        tool_call_id: tc.id,
        content: JSON.stringify(dispatched.result),
      },
    ];
  }

  throw new ToolLoopExceededError();
}

export async function generateWithTools(input: {
  messages: ToolChatMessage[];
  ctx: ToolCtx;
  signal?: AbortSignal;
  enableTools?: boolean;
  openAICompatibleRequestExtensions?: Record<string, unknown>;
  maxToolSteps?: number;
}): Promise<GenerateWithToolsResult> {
  let final: GenerateWithToolsResult | undefined;
  for await (const ev of generateWithToolsStream(input)) {
    if (ev.type === "done") {
      final = {
        content: ev.content,
        inputTokens: ev.inputTokens,
        outputTokens: ev.outputTokens,
      };
    }
  }
  if (!final) {
    throw new Error("generateWithTools finished without a completion event");
  }
  return final;
}

export class ToolLoopExceededError extends Error {
  constructor() {
    super("MAX_TOOL_STEPS exceeded");
    this.name = "ToolLoopExceededError";
  }
}
