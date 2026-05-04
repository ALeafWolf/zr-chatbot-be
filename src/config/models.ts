import { env } from "./env";

export interface ModelBinding {
  provider: "anthropic" | "openai" | "deepseek";
  model: string;
}

function parseModelBinding(value: string): ModelBinding {
  const colonIdx = value.indexOf(":");
  if (colonIdx === -1) {
    throw new Error(
      `Invalid model binding format "${value}". Expected "provider:model".`,
    );
  }
  const provider = value.slice(0, colonIdx) as ModelBinding["provider"];
  const model = value.slice(colonIdx + 1);
  if (!["anthropic", "openai", "deepseek"].includes(provider)) {
    throw new Error(`Unknown provider "${provider}" in model binding "${value}"`);
  }
  return { provider, model };
}

export const models = {
  generation: parseModelBinding(env.GENERATION_MODEL),
  validator: parseModelBinding(env.VALIDATOR_MODEL),
  extractor: parseModelBinding(env.EXTRACTOR_MODEL),
  embedding: parseModelBinding(env.EMBEDDING_MODEL),
} as const;
