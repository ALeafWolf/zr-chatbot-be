import Anthropic from "@anthropic-ai/sdk";
import { env } from "../../config/env";
import type {
  LLMMessage,
  LLMResponse,
  LLMProvider,
  ChatOptions,
  ToolChatMessage,
  LLMStreamEvent,
  LLMUsage,
} from "./providerTypes";

/**
 * Local extension of the SDK's `Usage` type to access the nested
 * `cache_creation` TTL-split object. The public SDK `Usage` exposes
 * flat `cache_creation_input_tokens` / `cache_read_input_tokens` but
 * NOT the nested `cache_creation: { ephemeral_5m_input_tokens,
 * ephemeral_1h_input_tokens }` — that lives on `BetaUsage` only
 * (confirmed in SDK 0.52.0).
 */
interface AnthropicUsageWithCacheTTL {
  cache_creation?: {
    ephemeral_5m_input_tokens: number;
    ephemeral_1h_input_tokens: number;
  } | null;
  cache_creation_input_tokens: number | null;
  cache_read_input_tokens: number | null;
  input_tokens: number;
  output_tokens: number;
}

function buildAnthropicUsage(usage: AnthropicUsageWithCacheTTL): LLMUsage {
  const cacheCreation = usage.cache_creation;
  return {
    inputTokens: usage.input_tokens,
    outputTokens: usage.output_tokens,
    cacheReadInputTokens: usage.cache_read_input_tokens ?? undefined,
    cacheCreationInputTokens: usage.cache_creation_input_tokens ?? undefined,
    cacheCreation5mTokens: cacheCreation?.ephemeral_5m_input_tokens ?? undefined,
    cacheCreation1hTokens: cacheCreation?.ephemeral_1h_input_tokens ?? undefined,
  };
}

function buildAnthropicStreamUsage(usage: AnthropicUsageWithCacheTTL): LLMUsage {
  // Streaming path: no TTL split available; emit only the sum
  return {
    inputTokens: usage.input_tokens,
    outputTokens: usage.output_tokens,
    cacheReadInputTokens: usage.cache_read_input_tokens ?? undefined,
    cacheCreationInputTokens: usage.cache_creation_input_tokens ?? undefined,
  };
}

/** @visibleForTesting — used by anthropicProvider.unit.ts to inject a mock client. */
export function __test_setClient(mockClient: Anthropic | null): void {
  client = mockClient;
}

let client: Anthropic | null = null;

function getClient(): Anthropic {
  if (!client) {
    client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });
  }
  return client;
}

function toAnthropicTools(
  tools: NonNullable<ChatOptions["tools"]>,
): Anthropic.Tool[] {
  return tools.map((t) => ({
    name: t.function.name,
    description: t.function.description,
    input_schema: t.function.parameters as Anthropic.Tool.InputSchema,
  }));
}

function toAnthropicMessages(messages: ToolChatMessage[]): Anthropic.MessageParam[] {
  const out: Anthropic.MessageParam[] = [];
  let i = 0;
  while (i < messages.length) {
    const m = messages[i];
    if (m.role === "user") {
      out.push({ role: "user", content: m.content });
      i++;
      continue;
    }
    if (m.role === "assistant") {
      if (m.tool_calls?.length) {
        const blocks: Anthropic.Messages.ContentBlockParam[] = [];
        if (m.content && m.content.trim().length) {
          blocks.push({ type: "text", text: m.content });
        }
        for (const tc of m.tool_calls) {
          let input: Record<string, unknown> = {};
          try {
            input = tc.function.arguments
              ? (JSON.parse(tc.function.arguments) as Record<string, unknown>)
              : {};
          } catch {
            input = { raw: tc.function.arguments };
          }
          blocks.push({
            type: "tool_use",
            id: tc.id,
            name: tc.function.name,
            input,
          });
        }
        out.push({ role: "assistant", content: blocks });
        i++;
        continue;
      }
      out.push({
        role: "assistant",
        content: m.content ?? "",
      });
      i++;
      continue;
    }
    if (m.role === "tool") {
      const results: Anthropic.Messages.ToolResultBlockParam[] = [];
      while (i < messages.length && messages[i].role === "tool") {
        const tm = messages[i] as Extract<ToolChatMessage, { role: "tool" }>;
        results.push({
          type: "tool_result",
          tool_use_id: tm.tool_call_id,
          content: tm.content,
        });
        i++;
      }
      out.push({ role: "user", content: results });
      continue;
    }
    i++;
  }
  return out;
}

export function createAnthropicProvider(model: string): LLMProvider {
  return {
    async chat(
      messages: LLMMessage[],
      options: ChatOptions = {},
    ): Promise<LLMResponse> {
      const systemMessages = messages.filter((m) => m.role === "system");
      const nonSystemMessages = messages.filter((m) => m.role !== "system");
      const jsonHint =
        options.jsonMode === true
          ? `\nReturn a single JSON object only: no markdown fences, preamble, commentary, or keys outside the requested schema.`
          : "";

      const systemText = systemMessages.map((m) => m.content).join("\n\n") + jsonHint;

      let apiMessages = nonSystemMessages.map((m) => ({
        role: m.role as "user" | "assistant",
        content: m.content,
      }));

      if (options.jsonMode === true && apiMessages.length > 0) {
        apiMessages.push({ role: "assistant", content: "{" });
      }

      const response = await getClient().messages.create(
        {
          model,
          max_tokens: options.maxTokens ?? 2048,
          temperature: options.temperature ?? 1.0,
          system: systemText.trim().length ? systemText.trim() : undefined,
          messages: apiMessages,
        },
        { signal: options.signal },
      );

      const textChunks = response.content
        .filter((b): b is Anthropic.Messages.TextBlock => b.type === "text")
        .map((b) => b.text);
      let text = textChunks.join("");
      if (options.jsonMode === true) {
        text = `{${text}`;
      }

      const antUsage = response.usage as AnthropicUsageWithCacheTTL;
      return {
        content: text,
        inputTokens: antUsage.input_tokens,
        outputTokens: antUsage.output_tokens,
        usage: buildAnthropicUsage(antUsage),
        finishReason: response.stop_reason,
      };
    },

    async *streamChat(
      messages: ToolChatMessage[],
      options: ChatOptions = {},
    ): AsyncGenerator<LLMStreamEvent> {
      const systemMessages = messages.filter((m) => m.role === "system");
      const nonSystem = messages.filter((m) => m.role !== "system");
      const jsonHint =
        options.jsonMode === true
          ? `\nReturn a single JSON object only: no markdown fences, preamble, commentary, or keys outside the requested schema.`
          : "";

      const systemText =
        systemMessages.map((m) => m.content).join("\n\n") + jsonHint;

      const nonSystemAdj =
        options.jsonMode === true && nonSystem.length > 0
          ? [...nonSystem, { role: "assistant" as const, content: "{" }]
          : [...nonSystem];

      const anthropicMessages = toAnthropicMessages(nonSystemAdj);

      const tools =
        options.tools?.length && options.toolChoice !== "none"
          ? toAnthropicTools(options.tools)
          : undefined;

      if (tools?.length) {
        const response = await getClient().messages.create(
          {
            model,
            max_tokens: options.maxTokens ?? 2048,
            temperature: options.temperature ?? 1.0,
            system: systemText.trim().length ? systemText.trim() : undefined,
            tools,
            messages: anthropicMessages,
          },
          { signal: options.signal },
        );

        let text = "";
        const toolCalls: Array<{ id: string; name: string; arguments: string }> =
          [];
        for (const block of response.content) {
          if (block.type === "text") text += block.text;
          if (block.type === "tool_use") {
            toolCalls.push({
              id: block.id,
              name: block.name,
              arguments: JSON.stringify(block.input ?? {}),
            });
          }
        }

        const toolsUsage = response.usage as AnthropicUsageWithCacheTTL;
        yield {
          type: "assistant_done",
          content: text,
          toolCalls: toolCalls.length ? toolCalls : undefined,
          usage: buildAnthropicUsage(toolsUsage),
          finishReason: response.stop_reason,
        };
        return;
      }

      const stream = getClient().messages.stream({
        model,
        max_tokens: options.maxTokens ?? 2048,
        temperature: options.temperature ?? 1.0,
        system: systemText.trim().length ? systemText.trim() : undefined,
        messages: anthropicMessages,
      }, { signal: options.signal });

      let buf = "";
      for await (const event of stream) {
        if (
          event.type === "content_block_delta" &&
          event.delta.type === "text_delta"
        ) {
          const piece = event.delta.text;
          buf += piece;
          yield { type: "delta", text: piece };
        }
      }

      const final = await stream.finalMessage();
      const content =
        options.jsonMode === true ? `{${buf}` : buf;
      const streamUsage = final.usage as AnthropicUsageWithCacheTTL;
      yield {
        type: "assistant_done",
        content,
        usage: buildAnthropicStreamUsage(streamUsage),
        finishReason: final.stop_reason,
      };
    },
  };
}
