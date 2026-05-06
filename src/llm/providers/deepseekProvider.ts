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
    client = new OpenAI({
      apiKey: env.DEEPSEEK_API_KEY,
      baseURL: "https://api.deepseek.com/v1",
    });
  }
  return client;
}

export function createDeepSeekProvider(model: string): LLMProvider {
  return {
    async chat(
      messages: LLMMessage[],
      options: ChatOptions = {},
    ): Promise<LLMResponse> {
      const response = await getClient().chat.completions.create({
        model,
        max_tokens: options.maxTokens ?? 2048,
        temperature: options.temperature ?? 0.7,
        response_format: options.jsonMode ? { type: "json_object" } : undefined,
        messages: messages.map((m) => ({
          role: m.role,
          content: m.content,
        })),
      });

      const msg = response.choices[0]?.message as
        | { content?: string | null; reasoning_content?: string | null }
        | undefined;
      const content = msg?.content ?? "";
      return {
        content,
        inputTokens: response.usage?.prompt_tokens ?? 0,
        outputTokens: response.usage?.completion_tokens ?? 0,
        reasoningContent:
          typeof msg?.reasoning_content === "string"
            ? msg.reasoning_content
            : undefined,
      };
    },

    async *streamChat(messages: ToolChatMessage[], options: ChatOptions = {}) {
      yield* streamOpenAICompatibleChat(getClient(), model, messages, options);
    },
  };
}
