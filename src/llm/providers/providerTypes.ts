import type { OpenAIToolDefinition } from "../tools/toolRegistry";

export interface LLMMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface OpenAIToolCall {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}

export type ToolChatMessage =
  | { role: "system"; content: string }
  | { role: "user"; content: string }
  | {
      role: "assistant";
      content: string | null;
      tool_calls?: OpenAIToolCall[];
      reasoning_content?: string;
    }
  | { role: "tool"; tool_call_id: string; content: string };

export interface ChatOptions {
  maxTokens?: number;
  temperature?: number;
  jsonMode?: boolean;
  tools?: OpenAIToolDefinition[];
  toolChoice?: "auto" | "none";
  signal?: AbortSignal;
  /** Extra JSON fields for OpenAI-compatible APIs that accept vendor extensions (e.g. DeepSeek `thinking`). */
  openAICompatibleRequestExtensions?: Record<string, unknown>;
}

export interface LLMUsage {
  inputTokens: number;
  outputTokens: number;

  // OpenAI-style cache: cached subset of inputTokens
  cachedInputTokens?: number;

  // DeepSeek-style cache: hit + miss sum to inputTokens
  cacheHitInputTokens?: number;
  cacheMissInputTokens?: number;

  // Anthropic-style cache: siblings to inputTokens (not subset)
  cacheReadInputTokens?: number;
  cacheCreationInputTokens?: number;       // Sum across TTLs
  cacheCreation5mTokens?: number;          // Non-streaming only
  cacheCreation1hTokens?: number;          // Non-streaming only

  // Reasoning-token visibility (subset of outputTokens; billed at output rate)
  reasoningTokens?: number;
}

export type LLMStreamEvent =
  | { type: "delta"; text?: string; reasoning?: string }
  | {
      type: "assistant_done";
      content: string;
      toolCalls?: Array<{ id: string; name: string; arguments: string }>;
      usage: LLMUsage;
      finishReason?: string | null;
    };

export interface LLMResponse {
  content: string;
  inputTokens: number;
  outputTokens: number;
  toolCalls?: Array<{ id: string; name: string; arguments: string }>;
  reasoningContent?: string;
  finishReason?: string | null;

  /** Per-provider dimensional usage breakdown (populated by provider adapters). */
  usage?: LLMUsage;
}

export interface LLMProvider {
  chat(
    messages: LLMMessage[],
    options?: ChatOptions,
  ): Promise<LLMResponse>;
  streamChat(
    messages: ToolChatMessage[],
    options?: ChatOptions,
  ): AsyncGenerator<LLMStreamEvent>;
}
