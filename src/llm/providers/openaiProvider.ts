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
import { requiresMaxCompletionTokens } from "./openaiModelCapabilities";

/** @visibleForTesting — used by openaiProvider.unit.ts to inject a mock client. */
export function __test_setClient(mockClient: OpenAI | null): void {
  client = mockClient;
}

let client: OpenAI | null = null;

function getClient(): OpenAI {
  if (!client) {
    client = new OpenAI({ apiKey: env.OPENAI_API_KEY });
  }
  return client;
}

function buildOpenAIUsage(usage: OpenAI.Completions.CompletionUsage): LLMUsage {
  return {
    inputTokens: usage.prompt_tokens,
    outputTokens: usage.completion_tokens,
    cachedInputTokens:
      usage.prompt_tokens_details?.cached_tokens ?? undefined,
    reasoningTokens:
      usage.completion_tokens_details?.reasoning_tokens ?? undefined,
  };
}

export function createOpenAIProvider(model: string): LLMProvider {
  return {
    async chat(
      messages: LLMMessage[],
      options: ChatOptions = {},
    ): Promise<LLMResponse> {
      const useMaxCompletion = requiresMaxCompletionTokens(model);
      const tokenBudget = options.maxTokens ?? 2048;
      const response = await getClient().chat.completions.create(
        {
          model,
          ...(useMaxCompletion
            ? { max_completion_tokens: tokenBudget }
            : { max_tokens: tokenBudget }),
          temperature: options.temperature ?? 1.0,
          response_format: options.jsonMode ? { type: "json_object" } : undefined,
          messages: messages.map((m) => ({
            role: m.role,
            content: m.content,
          })),
        } as OpenAI.Chat.Completions.ChatCompletionCreateParamsNonStreaming,
        { signal: options.signal },
      );

      const choice = response.choices[0];
      const content = choice?.message?.content ?? "";
      const responseUsage = response.usage;
      return {
        content,
        inputTokens: responseUsage?.prompt_tokens ?? 0,
        outputTokens: responseUsage?.completion_tokens ?? 0,
        usage: responseUsage ? buildOpenAIUsage(responseUsage) : undefined,
        finishReason: choice?.finish_reason ?? null,
      };
    },

    async *streamChat(messages: ToolChatMessage[], options: ChatOptions = {}) {
      yield* streamOpenAICompatibleChat(getClient(), model, messages, options);
    },
  };
}
