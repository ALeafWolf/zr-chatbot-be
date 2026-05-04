import OpenAI from "openai";
import { env } from "../../config/env";
import type { LLMMessage, LLMResponse, LLMProvider } from "./index";

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
      options: { maxTokens?: number; temperature?: number; jsonMode?: boolean } = {},
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

      const content = response.choices[0]?.message?.content ?? "";
      return {
        content,
        inputTokens: response.usage?.prompt_tokens ?? 0,
        outputTokens: response.usage?.completion_tokens ?? 0,
      };
    },
  };
}
