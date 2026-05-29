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

export type ChatJsonResult<T> = ChatJsonOk<T> | ChatJsonErr;

export type ChatFallbackAttempt = {
  binding: ModelBinding;
  trigger:
    | "provider_error"
    | "network_error"
    | "rate_limit"
    | "server_error"
    | "parse_failure";
  error: string;
  inputTokens?: number;
  outputTokens?: number;
  finishReason?: string | null;
};

export type ChatResultWithFallback<T extends ChatJsonResult<unknown>> = T & {
  binding: ModelBinding;
  fallbackUsed: boolean;
  fallbackAttempts: ChatFallbackAttempt[];
};

export type ChatTextResultWithFallback = LLMResponse & {
  binding: ModelBinding;
  fallbackUsed: boolean;
  fallbackAttempts: ChatFallbackAttempt[];
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

function normalizeFallbacks(
  fallback: ModelBinding | readonly ModelBinding[] | undefined,
): ModelBinding[] {
  if (!fallback) return [];
  if (Array.isArray(fallback)) return [...fallback];
  return [fallback as ModelBinding];
}

function sameBinding(a: ModelBinding, b: ModelBinding): boolean {
  return a.provider === b.provider && a.model === b.model;
}

function orderedBindings(
  primary: ModelBinding,
  fallback: ModelBinding | readonly ModelBinding[] | undefined,
): ModelBinding[] {
  const out = [primary];
  for (const binding of normalizeFallbacks(fallback)) {
    if (!out.some((existing) => sameBinding(existing, binding))) {
      out.push(binding);
    }
  }
  return out;
}

function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  try {
    return JSON.stringify(err);
  } catch {
    return String(err);
  }
}

function errorStatus(err: unknown): number | undefined {
  if (!err || typeof err !== "object") return undefined;
  const record = err as {
    status?: unknown;
    code?: unknown;
    response?: { status?: unknown };
    error?: { status?: unknown; code?: unknown; type?: unknown };
  };
  const candidates = [
    record.status,
    record.response?.status,
    record.error?.status,
    typeof record.code === "number" ? record.code : undefined,
  ];
  for (const candidate of candidates) {
    if (typeof candidate === "number" && Number.isFinite(candidate)) {
      return candidate;
    }
  }
  return undefined;
}

function errorCode(err: unknown): string | undefined {
  if (!err || typeof err !== "object") return undefined;
  const record = err as {
    code?: unknown;
    name?: unknown;
    error?: { code?: unknown; type?: unknown };
  };
  for (const candidate of [record.code, record.error?.code, record.error?.type, record.name]) {
    if (typeof candidate === "string" && candidate.trim()) {
      return candidate;
    }
  }
  return undefined;
}

function fallbackTriggerForError(
  err: unknown,
  signal?: AbortSignal,
): ChatFallbackAttempt["trigger"] | null {
  if (signal?.aborted) return null;

  const status = errorStatus(err);
  if (status === 429) return "rate_limit";
  if (status !== undefined && status >= 500 && status <= 599) {
    return "server_error";
  }
  if (status === 408) return "network_error";

  const code = errorCode(err)?.toLowerCase() ?? "";
  if (
    code === "apiConnectionError".toLowerCase() ||
    code === "apiConnectionTimeoutError".toLowerCase() ||
    code === "apitimeouterror" ||
    code === "timeoutError".toLowerCase() ||
    code === "fetcherror" ||
    code === "overloaded_error" ||
    [
      "econnreset",
      "etimedout",
      "econnrefused",
      "enotfound",
      "eai_again",
      "sockettimeout",
    ].includes(code)
  ) {
    return code === "overloaded_error" ? "server_error" : "network_error";
  }

  const text = errorMessage(err).toLowerCase();
  if (
    text.includes("rate_limit") ||
    text.includes("too many requests") ||
    text.includes("rate limit")
  ) {
    return "rate_limit";
  }
  if (
    text.includes("overloaded") ||
    text.includes("server error") ||
    text.includes("service unavailable") ||
    text.includes("bad gateway") ||
    text.includes("gateway timeout") ||
    /\b5\d\d\b/.test(text) ||
    /\b529\b/.test(text)
  ) {
    return "server_error";
  }
  if (
    text.includes("network") ||
    text.includes("fetch failed") ||
    text.includes("connection") ||
    text.includes("socket") ||
    text.includes("timeout") ||
    text.includes("timed out") ||
    text.includes("econnreset") ||
    text.includes("etimedout") ||
    text.includes("enotfound")
  ) {
    return "network_error";
  }

  return null;
}

export function isFallbackableLlmError(
  err: unknown,
  signal?: AbortSignal,
): boolean {
  return fallbackTriggerForError(err, signal) !== null;
}

function addAttempt(
  attempts: ChatFallbackAttempt[],
  attempt: ChatFallbackAttempt,
): ChatFallbackAttempt[] {
  return [...attempts, attempt];
}

function withFallbackMetadata<T extends ChatJsonResult<unknown>>(
  result: T,
  binding: ModelBinding,
  fallbackUsed: boolean,
  fallbackAttempts: ChatFallbackAttempt[],
): ChatResultWithFallback<T> {
  return Object.assign(result, { binding, fallbackUsed, fallbackAttempts });
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

export async function chatJsonWithFallback<T>(
  primary: ModelBinding,
  fallback: ModelBinding | readonly ModelBinding[] | undefined,
  messages: LLMMessage[],
  schema: z.ZodType<T, z.ZodTypeDef, unknown>,
  options?: ChatJsonOptions,
): Promise<ChatResultWithFallback<ChatJsonResult<T>>> {
  const bindings = orderedBindings(primary, fallback);
  let attempts: ChatFallbackAttempt[] = [];

  for (let i = 0; i < bindings.length; i++) {
    const binding = bindings[i]!;
    const tag = `${binding.provider}:${binding.model}`;
    try {
      const result = await chatJson(binding, messages, schema, options);
      if (result.ok || i === bindings.length - 1) {
        return withFallbackMetadata(result, binding, i > 0, attempts);
      }
      console.warn(
        `[chatJsonWithFallback] ${tag} parse_failure: ${result.error} — trying next binding`,
      );
      attempts = addAttempt(attempts, {
        binding,
        trigger: "parse_failure",
        error: result.error,
        inputTokens: result.inputTokens,
        outputTokens: result.outputTokens,
        finishReason: result.finishReason,
      });
    } catch (err) {
      const trigger = fallbackTriggerForError(err, options?.signal);
      if (!trigger || i === bindings.length - 1) {
        if (attempts.length > 0) {
          console.error(
            `[chatJsonWithFallback] chain exhausted — prior failures:`,
            attempts.map((a) => `${a.binding.provider}:${a.binding.model} (${a.trigger}): ${a.error}`),
          );
        }
        throw err;
      }
      const msg = errorMessage(err);
      console.warn(
        `[chatJsonWithFallback] ${tag} ${trigger}: ${msg} — trying next binding`,
      );
      attempts = addAttempt(attempts, {
        binding,
        trigger,
        error: msg,
      });
    }
  }

  throw new Error("chatJsonWithFallback exhausted without an attempt");
}

export interface ChatJsonStreamOptions {
  maxTokens?: number;
  temperature?: number;
  signal?: AbortSignal;
  openAICompatibleRequestExtensions?: Record<string, unknown>;
}

/**
 * Like {@link chatJson}, but consumes a streaming completion, concatenates assistant
 * output, then runs the same parse + Zod path.
 *
 * DeepSeek reasoning models (deepseek-v4-pro, etc.) produce empty `content` fields
 * in streaming JSON mode when thinking is enabled — reasoning goes into
 * `reasoning_content` only, leaving `content` empty and causing a parse_failure.
 * This function automatically disables thinking for any DeepSeek binding.
 */
export async function chatJsonStream<T>(
  binding: ModelBinding,
  messages: LLMMessage[],
  schema: z.ZodType<T, z.ZodTypeDef, unknown>,
  options?: ChatJsonStreamOptions,
): Promise<ChatJsonOk<T> | ChatJsonErr> {
  const provider = getProvider(binding);
  const msgs: ToolChatMessage[] = messages.map((m) => ({
    role: m.role,
    content: m.content,
  }));

  // DeepSeek reasoning models emit content only in reasoning_content during
  // streaming, leaving content empty when thinking is active. Disable it so
  // the JSON lands in the content field where the parser expects it.
  const deepseekExtensions: Record<string, unknown> | undefined =
    binding.provider === "deepseek" ? { thinking: { type: "disabled" } } : undefined;
  const extensions: Record<string, unknown> | undefined =
    deepseekExtensions || options?.openAICompatibleRequestExtensions
      ? { ...deepseekExtensions, ...options?.openAICompatibleRequestExtensions }
      : undefined;

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
    openAICompatibleRequestExtensions: extensions,
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

export async function chatJsonStreamWithFallback<T>(
  primary: ModelBinding,
  fallback: ModelBinding | readonly ModelBinding[] | undefined,
  messages: LLMMessage[],
  schema: z.ZodType<T, z.ZodTypeDef, unknown>,
  options?: ChatJsonStreamOptions,
): Promise<ChatResultWithFallback<ChatJsonResult<T>>> {
  const bindings = orderedBindings(primary, fallback);
  let attempts: ChatFallbackAttempt[] = [];

  for (let i = 0; i < bindings.length; i++) {
    const binding = bindings[i]!;
    const tag = `${binding.provider}:${binding.model}`;
    try {
      const result = await chatJsonStream(binding, messages, schema, options);
      if (result.ok || i === bindings.length - 1) {
        return withFallbackMetadata(result, binding, i > 0, attempts);
      }
      console.warn(
        `[chatJsonStreamWithFallback] ${tag} parse_failure: ${result.error} — trying next binding`,
      );
      attempts = addAttempt(attempts, {
        binding,
        trigger: "parse_failure",
        error: result.error,
        inputTokens: result.inputTokens,
        outputTokens: result.outputTokens,
        finishReason: result.finishReason,
      });
    } catch (err) {
      const trigger = fallbackTriggerForError(err, options?.signal);
      if (!trigger || i === bindings.length - 1) {
        if (attempts.length > 0) {
          console.error(
            `[chatJsonStreamWithFallback] chain exhausted — prior failures:`,
            attempts.map((a) => `${a.binding.provider}:${a.binding.model} (${a.trigger}): ${a.error}`),
          );
        }
        throw err;
      }
      const msg = errorMessage(err);
      console.warn(
        `[chatJsonStreamWithFallback] ${tag} ${trigger}: ${msg} — trying next binding`,
      );
      attempts = addAttempt(attempts, {
        binding,
        trigger,
        error: msg,
      });
    }
  }

  throw new Error("chatJsonStreamWithFallback exhausted without an attempt");
}

export async function chatWithFallback(
  primary: ModelBinding,
  fallback: ModelBinding | readonly ModelBinding[] | undefined,
  messages: LLMMessage[],
  options?: ChatOptions,
): Promise<ChatTextResultWithFallback> {
  const bindings = orderedBindings(primary, fallback);
  let attempts: ChatFallbackAttempt[] = [];

  for (let i = 0; i < bindings.length; i++) {
    const binding = bindings[i]!;
    const tag = `${binding.provider}:${binding.model}`;
    try {
      const provider = getProvider(binding);
      const response = await provider.chat(messages, options);
      return {
        ...response,
        binding,
        fallbackUsed: i > 0,
        fallbackAttempts: attempts,
      };
    } catch (err) {
      const trigger = fallbackTriggerForError(err, options?.signal);
      if (!trigger || i === bindings.length - 1) {
        if (attempts.length > 0) {
          console.error(
            `[chatWithFallback] chain exhausted — prior failures:`,
            attempts.map((a) => `${a.binding.provider}:${a.binding.model} (${a.trigger}): ${a.error}`),
          );
        }
        throw err;
      }
      const msg = errorMessage(err);
      console.warn(
        `[chatWithFallback] ${tag} ${trigger}: ${msg} — trying next binding`,
      );
      attempts = addAttempt(attempts, {
        binding,
        trigger,
        error: msg,
      });
    }
  }

  throw new Error("chatWithFallback exhausted without an attempt");
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
