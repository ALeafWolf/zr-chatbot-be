import OpenAI from "openai";
import { env } from "../../config/env";
import type {
  LLMMessage,
  LLMResponse,
  LLMProvider,
  ChatOptions,
  ToolChatMessage,
  LLMUsage,
} from "./providerTypes";
import { streamOpenAICompatibleChat } from "./openaiStream";

/**
 * Local extension of the SDK's CompletionUsage to access DeepSeek's
 * flat cache siblings and reasoning-token details. DeepSeek returns
 * `prompt_cache_hit_tokens` and `prompt_cache_miss_tokens` as flat
 * fields on the usage object (NOT nested under
 * `prompt_tokens_details`) — these are NOT in the openai-node
 * published types.
 */
interface DeepSeekChatCompletionUsage {
  prompt_cache_hit_tokens?: number | null;
  prompt_cache_miss_tokens?: number | null;
  completion_tokens_details?: {
    reasoning_tokens?: number;
  };
  prompt_tokens: number;
  completion_tokens: number;
}

/** @visibleForTesting — used by deepseekProvider.unit.ts to inject a mock client. */
export function __test_setClient(mockClient: OpenAI | null): void {
  client = mockClient;
}

let client: OpenAI | null = null;

function getClient(): OpenAI {
  if (!client) {
    client = new OpenAI({
      apiKey: env.DEEPSEEK_API_KEY,
      baseURL: "https://api.deepseek.com/v1",
    });
  }
  return client;
}

function buildDeepSeekUsage(usage: DeepSeekChatCompletionUsage): LLMUsage {
  return {
    inputTokens: usage.prompt_tokens,
    outputTokens: usage.completion_tokens,
    cacheHitInputTokens: usage.prompt_cache_hit_tokens ?? undefined,
    cacheMissInputTokens: usage.prompt_cache_miss_tokens ?? undefined,
    reasoningTokens: usage.completion_tokens_details?.reasoning_tokens ?? undefined,
  };
}

export function createDeepSeekProvider(model: string): LLMProvider {
  return {
    async chat(
      messages: LLMMessage[],
      options: ChatOptions = {},
    ): Promise<LLMResponse> {
      const response = await getClient().chat.completions.create(
        Object.assign(
          {},
          options.openAICompatibleRequestExtensions ?? {},
          {
            model,
            max_tokens: options.maxTokens ?? 2048,
            temperature: options.temperature ?? 0.7,
            response_format: options.jsonMode
              ? { type: "json_object" }
              : undefined,
            messages: messages.map((m) => ({
              role: m.role,
              content: m.content,
            })),
          },
        ) as OpenAI.Chat.Completions.ChatCompletionCreateParamsNonStreaming,
        { signal: options.signal },
      );

      const choice = response.choices[0];
      const msg = choice?.message as
        | { content?: string | null; reasoning_content?: string | null }
        | undefined;
      const content = msg?.content ?? "";
      const dsUsage = response.usage
        ? buildDeepSeekUsage(response.usage as unknown as DeepSeekChatCompletionUsage)
        : undefined;
      return {
        content,
        inputTokens: dsUsage?.inputTokens ?? 0,
        outputTokens: dsUsage?.outputTokens ?? 0,
        usage: dsUsage,
        reasoningContent:
          typeof msg?.reasoning_content === "string"
            ? msg.reasoning_content
            : undefined,
        finishReason: choice?.finish_reason ?? null,
      };
    },

    async *streamChat(messages: ToolChatMessage[], options: ChatOptions = {}) {
      yield* streamOpenAICompatibleChat(getClient(), model, messages, options);
    },
  };
}
