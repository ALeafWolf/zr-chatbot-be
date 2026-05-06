import OpenAI from "openai";
import { env } from "../../config/env";
import type {
  LLMMessage,
  LLMResponse,
  LLMProvider,
  ChatOptions,
  ToolChatMessage,
} from "./providerTypes";
import { streamOpenAICompatibleChat } from "./openaiStream";

let client: OpenAI | null = null;

function getClient(): OpenAI {
  if (!client) {
    client = new OpenAI({ apiKey: env.OPENAI_API_KEY });
  }
  return client;
}

export function createOpenAIProvider(model: string): LLMProvider {
  return {
    async chat(
      messages: LLMMessage[],
      options: ChatOptions = {},
    ): Promise<LLMResponse> {
      const response = await getClient().chat.completions.create({
        model,
        max_tokens: options.maxTokens ?? 2048,
        temperature: options.temperature ?? 1.0,
        response_format: options.jsonMode ? { type: "json_object" } : undefined,
        messages: messages.map((m) => ({
          role: m.role,
          content: m.content,
        })),
      });

      const content = response.choices[0]?.message?.content ?? "";
      return {
        content,
        inputTokens: response.usage?.prompt_tokens ?? 0,
        outputTokens: response.usage?.completion_tokens ?? 0,
      };
    },

    async *streamChat(messages: ToolChatMessage[], options: ChatOptions = {}) {
      yield* streamOpenAICompatibleChat(getClient(), model, messages, options);
    },
  };
}
