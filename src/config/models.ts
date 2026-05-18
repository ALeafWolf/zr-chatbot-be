import { env } from "./env";

export interface ModelBinding {
  provider: "anthropic" | "openai" | "deepseek";
  model: string;
}

export function parseModelBinding(value: string): ModelBinding {
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

export function resolveConsolidationModelBinding(
  value: string,
  extractor: ModelBinding,
): ModelBinding {
  const trimmed = value.trim();
  if (!trimmed || trimmed === "EXTRACTOR_MODEL") {
    return extractor;
  }
  return parseModelBinding(trimmed);
}

export function resolveMemoryRerankModelBinding(
  value: string,
  extractor: ModelBinding,
): ModelBinding {
  const trimmed = value.trim();
  if (!trimmed || trimmed === "EXTRACTOR_MODEL") {
    return extractor;
  }
  return parseModelBinding(trimmed);
}

const extractor = parseModelBinding(env.EXTRACTOR_MODEL);

export const models = {
  generation: parseModelBinding(env.GENERATION_MODEL),
  validator: parseModelBinding(env.VALIDATOR_MODEL),
  extractor,
  attributionJudge: parseModelBinding(
    env.VALIDATOR_ATTRIBUTION_JUDGE_MODEL?.trim()
      ? env.VALIDATOR_ATTRIBUTION_JUDGE_MODEL.trim()
      : env.EXTRACTOR_MODEL,
  ),
  embedding: parseModelBinding(env.EMBEDDING_MODEL),
  consolidation: resolveConsolidationModelBinding(
    env.STRUCTMEM_CONSOLIDATION_MODEL,
    extractor,
  ),
  rerank: resolveMemoryRerankModelBinding(
    env.MEMORY_RERANK_MODEL,
    extractor,
  ),
} as const;
