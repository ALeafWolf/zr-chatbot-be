import Anthropic from "@anthropic-ai/sdk";
import { env } from "../../config/env";
import type {
  LLMMessage,
  LLMResponse,
  LLMProvider,
  ChatOptions,
  ToolChatMessage,
  LLMStreamEvent,
} from "./providerTypes";

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

      return {
        content: text,
        inputTokens: response.usage.input_tokens,
        outputTokens: response.usage.output_tokens,
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

        yield {
          type: "assistant_done",
          content: text,
          toolCalls: toolCalls.length ? toolCalls : undefined,
          usage: {
            inputTokens: response.usage.input_tokens,
            outputTokens: response.usage.output_tokens,
          },
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
      yield {
        type: "assistant_done",
        content,
        usage: {
          inputTokens: final.usage.input_tokens,
          outputTokens: final.usage.output_tokens,
        },
        finishReason: final.stop_reason,
      };
    },
  };
}
