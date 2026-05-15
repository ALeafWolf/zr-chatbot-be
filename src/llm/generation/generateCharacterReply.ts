import { traceStreamingLLM } from "../../observability/langsmithTracing";
import { getProvider } from "../providers";
import { models } from "../../config/models";
import type { ToolChatMessage, LLMMessage } from "../providers";

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

export type CharacterReplyStreamEvent =
  | { type: "delta"; text: string }
  | {
      type: "done";
      content: string;
      inputTokens: number;
      outputTokens: number;
    };

export interface GenerateReplyCallOptions {
  signal?: AbortSignal;
  openAICompatibleRequestExtensions?: Record<string, unknown>;
  temperature?: number;
}

/**
 * Generate a character reply using the configured generation model.
 * The full prompt is assembled by the caller (buildPromptContext); this
 * function is a thin wrapper around the provider that exposes token counts
 * for LangSmith logging.
 */
export async function generateCharacterReply(
  input: GenerateReplyInput,
  options?: GenerateReplyCallOptions,
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
    maxTokens: 4096,
    temperature: options?.temperature ?? 1,
    ...(options?.openAICompatibleRequestExtensions !== undefined
      ? {
          openAICompatibleRequestExtensions:
            options.openAICompatibleRequestExtensions,
        }
      : {}),
  });

  return {
    content: response.content,
    inputTokens: response.inputTokens,
    outputTokens: response.outputTokens,
  };
}

async function* generateCharacterReplyStreamInner(
  input: GenerateReplyInput,
  options?: GenerateReplyCallOptions,
): AsyncGenerator<CharacterReplyStreamEvent, void> {
  const provider = getProvider(models.generation);

  const messages: ToolChatMessage[] = [
    { role: "system", content: input.systemPrompt },
    ...input.conversationHistory.map((m) => ({
      role: m.role as "user" | "assistant",
      content: m.content,
    })),
    { role: "user", content: input.userMessage },
  ];

  let content = "";
  let inputTokens = 0;
  let outputTokens = 0;

  for await (const ev of provider.streamChat(messages, {
    maxTokens: 4096,
    temperature: options?.temperature ?? 1,
    toolChoice: "none",
    signal: options?.signal,
    ...(options?.openAICompatibleRequestExtensions !== undefined
      ? {
          openAICompatibleRequestExtensions:
            options.openAICompatibleRequestExtensions,
        }
      : {}),
  })) {
    if (options?.signal?.aborted) {
      throw Object.assign(new Error("Aborted"), { name: "AbortError" });
    }
    if (ev.type === "delta" && ev.text) {
      content += ev.text;
      yield { type: "delta", text: ev.text };
    }
    if (ev.type === "assistant_done") {
      content = ev.content ?? content;
      inputTokens = ev.usage.inputTokens;
      outputTokens = ev.usage.outputTokens;
    }
  }

  yield { type: "done", content, inputTokens, outputTokens };
}

export const generateCharacterReplyStream = traceStreamingLLM(
  "llm.generate_character_reply_stream",
  generateCharacterReplyStreamInner,
  {
    subsystem: "llm",
    turn: "foreground",
    llm: { binding: models.generation, modelRole: "generation" },
  },
);
