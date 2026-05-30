import type OpenAI from "openai";
import type {
  ChatCompletionCreateParamsStreaming,
  ChatCompletionMessageParam,
  ChatCompletionToolChoiceOption,
} from "openai/resources/chat/completions";
import type {
  ChatOptions,
  LLMStreamEvent,
  LLMUsage,
  ToolChatMessage,
} from "./providerTypes";
import { requiresMaxCompletionTokens } from "./openaiModelCapabilities";

/**
 * Local extension to access DeepSeek's flat cache fields on the usage
 * object. These are NOT in the openai-node published types: DeepSeek
 * returns `prompt_cache_hit_tokens` and `prompt_cache_miss_tokens` as
 * flat siblings (not nested). OpenAI streams won't populate them.
 */
interface DeepSeekChatCompletionUsage {
  prompt_cache_hit_tokens?: number | null;
  prompt_cache_miss_tokens?: number | null;
  prompt_tokens: number;
  completion_tokens: number;
}

function toOpenAIMessages(messages: ToolChatMessage[]): ChatCompletionMessageParam[] {
  const out: ChatCompletionMessageParam[] = [];
  for (const m of messages) {
    if (m.role === "system") {
      out.push({ role: "system", content: m.content });
      continue;
    }
    if (m.role === "user") {
      out.push({ role: "user", content: m.content });
      continue;
    }
    if (m.role === "tool") {
      out.push({
        role: "tool",
        tool_call_id: m.tool_call_id,
        content: m.content,
      });
      continue;
    }
    if (m.tool_calls?.length) {
      out.push({
        role: "assistant",
        content: m.content ?? null,
        tool_calls: m.tool_calls.map((tc) => ({
          id: tc.id,
          type: "function" as const,
          function: {
            name: tc.function.name,
            arguments: tc.function.arguments,
          },
        })),
      });
      continue;
    }
    out.push({ role: "assistant", content: m.content ?? "" });
  }
  return out;
}

function mergeToolCallFragments(
  deltaToolCalls: Array<{
    index?: number;
    id?: string;
    type?: string;
    function?: { name?: string; arguments?: string };
  }>,
  acc: Map<number, { id?: string; name?: string; arguments?: string }>,
): void {
  for (const tc of deltaToolCalls) {
    const idx = tc.index ?? 0;
    const cur = acc.get(idx) ?? {};
    if (tc.id) cur.id = tc.id;
    if (tc.function?.name) cur.name = tc.function.name;
    if (tc.function?.arguments)
      cur.arguments = (cur.arguments ?? "") + tc.function.arguments;
    acc.set(idx, cur);
  }
}

function finalizeToolCalls(
  acc: Map<number, { id?: string; name?: string; arguments?: string }>,
): Array<{ id: string; name: string; arguments: string }> | undefined {
  if (acc.size === 0) return undefined;
  const sorted = [...acc.entries()].sort((a, b) => a[0] - b[0]);
  const calls = sorted
    .map(([, v]) => ({
      id: v.id ?? "",
      name: v.name ?? "",
      arguments: v.arguments ?? "",
    }))
    .filter((c) => c.id && c.name);
  return calls.length ? calls : undefined;
}

/** Shared streaming path for OpenAI-compatible APIs (OpenAI + DeepSeek). */
export async function* streamOpenAICompatibleChat(
  client: OpenAI,
  model: string,
  messages: ToolChatMessage[],
  options: ChatOptions = {},
): AsyncGenerator<LLMStreamEvent> {
  const apiMessages = toOpenAIMessages(messages);
  const tools = options.tools?.length ? options.tools : undefined;
  const toolChoice: ChatCompletionToolChoiceOption | undefined =
    tools && options.toolChoice === "none"
      ? "none"
      : tools
        ? "auto"
        : undefined;

  const useMaxCompletion = requiresMaxCompletionTokens(model);
  const tokenBudget = options.maxTokens ?? 2048;
  const extensions = options.openAICompatibleRequestExtensions ?? {};
  const withDefaults =
    useMaxCompletion && !("reasoning_effort" in extensions)
      ? { ...extensions, reasoning_effort: "low" as const }
      : extensions;

  const createParams = Object.assign(
    {},
    withDefaults,
    {
      model,
      messages: apiMessages,
      ...(useMaxCompletion
        ? { max_completion_tokens: tokenBudget }
        : { max_tokens: tokenBudget }),
      ...(useMaxCompletion ? {} : { temperature: options.temperature ?? 1.0 }),
      stream: true,
      ...(options.jsonMode && !tools
        ? { response_format: { type: "json_object" as const } }
        : {}),
      tools,
      tool_choice: toolChoice,
    },
  ) as ChatCompletionCreateParamsStreaming;

  const stream = await client.chat.completions.create(createParams, {
    signal: options.signal,
  });

  let buf = "";
  const toolAcc = new Map<number, { id?: string; name?: string; arguments?: string }>();
  let finishReason: string | null | undefined;
  let inputTokens = 0;
  let outputTokens = 0;
  let reasoningTokens: number | undefined;
  let cachedInputTokens: number | undefined;
  // DeepSeek-style cache fields (flat siblings on usage object)
  let cacheHitInputTokens: number | undefined;
  let cacheMissInputTokens: number | undefined;

  for await (const part of stream) {
    const choice = part.choices?.[0];
    const delta = choice?.delta as {
      content?: string | null;
      tool_calls?: Array<{
        index?: number;
        id?: string;
        type?: string;
        function?: { name?: string; arguments?: string };
      }>;
      reasoning_content?: string | null;
    };

    if (delta?.content) {
      buf += delta.content;
      yield { type: "delta", text: delta.content };
    }

    const reasoning =
      typeof delta?.reasoning_content === "string"
        ? delta.reasoning_content
        : "";
    if (reasoning) {
      yield { type: "delta", reasoning };
    }

    if (delta?.tool_calls?.length) {
      mergeToolCallFragments(delta.tool_calls, toolAcc);
    }

    if (choice?.finish_reason) {
      finishReason = choice.finish_reason;
    }

    const usage = part.usage;
    if (usage) {
      inputTokens = usage.prompt_tokens ?? inputTokens;
      outputTokens = usage.completion_tokens ?? outputTokens;
      reasoningTokens =
        usage.completion_tokens_details?.reasoning_tokens ?? reasoningTokens;
      cachedInputTokens =
        usage.prompt_tokens_details?.cached_tokens ?? cachedInputTokens;

      // DeepSeek flat cache fields (cast through local extension)
      const ds = usage as unknown as DeepSeekChatCompletionUsage;
      cacheHitInputTokens = ds.prompt_cache_hit_tokens ?? cacheHitInputTokens;
      cacheMissInputTokens = ds.prompt_cache_miss_tokens ?? cacheMissInputTokens;
    }
  }

  const toolCalls = finalizeToolCalls(toolAcc);
  const wantsTools =
    Boolean(toolCalls?.length) ||
    finishReason === "tool_calls" ||
    finishReason === "requires_action";

  const finalUsage: LLMUsage = {
    inputTokens,
    outputTokens,
    ...(reasoningTokens !== undefined ? { reasoningTokens } : {}),
    ...(cachedInputTokens !== undefined ? { cachedInputTokens } : {}),
    ...(cacheHitInputTokens !== undefined ? { cacheHitInputTokens } : {}),
    ...(cacheMissInputTokens !== undefined ? { cacheMissInputTokens } : {}),
  };

  yield {
    type: "assistant_done",
    content: buf,
    toolCalls: wantsTools ? toolCalls : undefined,
    usage: finalUsage,
    finishReason,
  };
}
