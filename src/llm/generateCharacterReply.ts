import { getProvider } from "./providers";
import { models } from "../config/models";
import type { LLMMessage } from "./providers";

export interface GenerateReplyInput {
  systemPrompt: string;
  conversationHistory: Array<{ role: "user" | "assistant"; content: string }>;
  userMessage: string;
}

export interface GenerateReplyOutput {
  content: string;
  inputTokens: number;
  outputTokens: number;
}

/**
 * Generate a character reply using the configured generation model.
 * The full prompt is assembled by the caller (buildPromptContext); this
 * function is a thin wrapper around the provider that exposes token counts
 * for LangSmith logging.
 */
export async function generateCharacterReply(
  input: GenerateReplyInput,
): Promise<GenerateReplyOutput> {
  const provider = getProvider(models.generation);

  const messages: LLMMessage[] = [
    { role: "system", content: input.systemPrompt },
    ...input.conversationHistory.map((m) => ({
      role: m.role as "user" | "assistant",
      content: m.content,
    })),
    { role: "user", content: input.userMessage },
  ];

  const response = await provider.chat(messages, {
    maxTokens: 1024,
    temperature: 1.0,
  });

  return {
    content: response.content,
    inputTokens: response.inputTokens,
    outputTokens: response.outputTokens,
  };
}
