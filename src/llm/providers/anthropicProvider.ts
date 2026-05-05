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
      const jsonHint =
        options.jsonMode === true
          ? `\nReturn a single JSON object only: no markdown fences, preamble, commentary, or keys outside the requested schema.`
          : "";

      let systemText = systemMessages.map((m) => m.content).join("\n\n") + jsonHint;

      let apiMessages = nonSystemMessages.map((m) => ({
        role: m.role as "user" | "assistant",
        content: m.content,
      }));

      if (options.jsonMode === true && apiMessages.length > 0) {
        apiMessages.push({ role: "assistant", content: "{" });
      }

      const response = await getClient().messages.create({
        model,
        max_tokens: options.maxTokens ?? 2048,
        temperature: options.temperature ?? 1.0,
        system: systemText.trim().length ? systemText.trim() : undefined,
        messages: apiMessages,
      });

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
      };
    },
  };
}
