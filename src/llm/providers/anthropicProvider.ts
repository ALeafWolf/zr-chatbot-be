import Anthropic from "@anthropic-ai/sdk";
import { env } from "../../config/env";
import type { LLMMessage, LLMResponse, LLMProvider } from "./index";

let client: Anthropic | null = null;

function getClient(): Anthropic {
  if (!client) {
    client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });
  }
  return client;
}

export function createAnthropicProvider(model: string): LLMProvider {
  return {
    async chat(
      messages: LLMMessage[],
      options: { maxTokens?: number; temperature?: number; jsonMode?: boolean } = {},
    ): Promise<LLMResponse> {
      const systemMessages = messages.filter((m) => m.role === "system");
      const nonSystemMessages = messages.filter((m) => m.role !== "system");
      const systemText = systemMessages.map((m) => m.content).join("\n\n");

      const response = await getClient().messages.create({
        model,
        max_tokens: options.maxTokens ?? 2048,
        temperature: options.temperature ?? 1.0,
        system: systemText || undefined,
        messages: nonSystemMessages.map((m) => ({
          role: m.role as "user" | "assistant",
          content: m.content,
        })),
      });

      const text =
        response.content[0].type === "text" ? response.content[0].text : "";
      return {
        content: text,
        inputTokens: response.usage.input_tokens,
        outputTokens: response.usage.output_tokens,
      };
    },
  };
}
