import { createAnthropicProvider } from "./anthropicProvider";
import { createOpenAIProvider } from "./openaiProvider";
import { createDeepSeekProvider } from "./deepseekProvider";
import type { ModelBinding } from "../../config/models";
import { z } from "zod";
import { parseJsonOutput } from "../json/parseJsonOutput";
import type {
  LLMMessage,
  LLMProvider,
  LLMResponse,
  ChatOptions,
  ToolChatMessage,
  LLMStreamEvent,
} from "./providerTypes";

export type {
  LLMMessage,
  LLMProvider,
  LLMResponse,
  ChatOptions,
  ToolChatMessage,
  LLMStreamEvent,
  OpenAIToolCall,
} from "./providerTypes";

export type ChatJsonOk<T> = {
  ok: true;
  data: T;
  raw: string;
  inputTokens: number;
  outputTokens: number;
};

export type ChatJsonErr = {
  ok: false;
  raw: string;
  error: string;
  inputTokens: number;
  outputTokens: number;
  finishReason?: string | null;
};

export interface ChatJsonOptions {
  maxTokens?: number;
  temperature?: number;
  signal?: AbortSignal;
  openAICompatibleRequestExtensions?: Record<string, unknown>;
}

/**
 * Build provider chat options from chatJson options.
 * Exported for testing: verifies openAICompatibleRequestExtensions forwarding.
 */
export function buildChatJsonOptions(options?: ChatJsonOptions): ChatOptions {
  return {
    maxTokens: options?.maxTokens,
    temperature: options?.temperature,
    jsonMode: true,
    signal: options?.signal,
    ...(options?.openAICompatibleRequestExtensions !== undefined
      ? { openAICompatibleRequestExtensions: options.openAICompatibleRequestExtensions }
      : {}),
  };
}

/**
 * JSON-mode chat with tolerant parsing (fences, preamble) + Zod validation.
 * Uses each provider's strongest JSON hint (response_format or Anthropic prefill).
 */
export async function chatJson<T>(
  binding: ModelBinding,
  messages: LLMMessage[],
  schema: z.ZodType<T, z.ZodTypeDef, unknown>,
  options?: ChatJsonOptions,
): Promise<ChatJsonOk<T> | ChatJsonErr> {
  const provider = getProvider(binding);
  const response = await provider.chat(messages, buildChatJsonOptions(options));

  const extracted = parseJsonOutput(response.content);
  if (!extracted.ok) {
    return {
      ok: false,
      raw: response.content,
      error: extracted.error,
      inputTokens: response.inputTokens,
      outputTokens: response.outputTokens,
      finishReason: response.finishReason,
    };
  }

  const zResult = schema.safeParse(extracted.data);
  if (!zResult.success) {
    return {
      ok: false,
      raw: response.content,
      error: zResult.error.message,
      inputTokens: response.inputTokens,
      outputTokens: response.outputTokens,
      finishReason: response.finishReason,
    };
  }

  return {
    ok: true,
    data: zResult.data,
    raw: response.content,
    inputTokens: response.inputTokens,
    outputTokens: response.outputTokens,
  };
}

/**
 * Like {@link chatJson}, but consumes a streaming completion, concatenates assistant
 * output, then runs the same parse + Zod path.
 */
export async function chatJsonStream<T>(
  binding: ModelBinding,
  messages: LLMMessage[],
  schema: z.ZodType<T, z.ZodTypeDef, unknown>,
  options?: {
    maxTokens?: number;
    temperature?: number;
    signal?: AbortSignal;
  },
): Promise<ChatJsonOk<T> | ChatJsonErr> {
  const provider = getProvider(binding);
  const msgs: ToolChatMessage[] = messages.map((m) => ({
    role: m.role,
    content: m.content,
  }));

  let raw = "";
  let inputTokens = 0;
  let outputTokens = 0;
  let finishReason: string | null | undefined;

  for await (const ev of provider.streamChat(msgs, {
    maxTokens: options?.maxTokens,
    temperature: options?.temperature,
    jsonMode: true,
    toolChoice: "none",
    signal: options?.signal,
  })) {
    if (ev.type === "assistant_done") {
      raw = ev.content;
      inputTokens = ev.usage.inputTokens;
      outputTokens = ev.usage.outputTokens;
      finishReason = ev.finishReason;
    }
  }

  return parseJsonStreamResult(raw, inputTokens, outputTokens, finishReason, schema);
}

/**
 * Parse + Zod-validate a completed stream result and produce a ChatJsonOk/E.
 * Exported for testing: given raw content and finishReason, verifies the
 * error path preserves finishReason.
 */
export function parseJsonStreamResult<T>(
  raw: string,
  inputTokens: number,
  outputTokens: number,
  finishReason: string | null | undefined,
  schema: z.ZodType<T, z.ZodTypeDef, unknown>,
): ChatJsonOk<T> | ChatJsonErr {
  const extracted = parseJsonOutput(raw);
  if (!extracted.ok) {
    return { ok: false, raw, error: extracted.error, inputTokens, outputTokens, finishReason };
  }

  const zResult = schema.safeParse(extracted.data);
  if (!zResult.success) {
    return { ok: false, raw, error: zResult.error.message, inputTokens, outputTokens, finishReason };
  }

  return { ok: true, data: zResult.data, raw, inputTokens, outputTokens };
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
