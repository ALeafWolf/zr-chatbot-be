import { createAnthropicProvider } from "./anthropicProvider";
import { createOpenAIProvider } from "./openaiProvider";
import { createDeepSeekProvider } from "./deepseekProvider";
import type { ModelBinding } from "../../config/models";

export interface LLMMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface LLMResponse {
  content: string;
  inputTokens: number;
  outputTokens: number;
}

export interface LLMProvider {
  chat(
    messages: LLMMessage[],
    options?: { maxTokens?: number; temperature?: number; jsonMode?: boolean },
  ): Promise<LLMResponse>;
}

/** Dispatch to the correct provider by the ModelBinding derived from env. */
export function getProvider(binding: ModelBinding): LLMProvider {
  switch (binding.provider) {
    case "anthropic":
      return createAnthropicProvider(binding.model);
    case "openai":
      return createOpenAIProvider(binding.model);
    case "deepseek":
      return createDeepSeekProvider(binding.model);
    default:
      throw new Error(`Unknown provider: ${(binding as ModelBinding).provider}`);
  }
}
