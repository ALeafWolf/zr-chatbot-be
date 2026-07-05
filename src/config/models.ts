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

function formatModelBinding(binding: ModelBinding): string {
  return `${binding.provider}:${binding.model}`;
}

export function parseFallbackModelBindings(
  value: string | undefined,
  primary?: ModelBinding,
): ModelBinding[] {
  const trimmed = (value ?? "").trim();
  if (!trimmed || trimmed.toLowerCase() === "none") return [];

  const seen = new Set<string>();
  const out: ModelBinding[] = [];
  for (const part of trimmed.split(/[,\s]+/)) {
    const item = part.trim();
    if (!item) continue;
    const binding = parseModelBinding(item);
    const formatted = formatModelBinding(binding);
    if (primary && formatted === formatModelBinding(primary)) continue;
    if (seen.has(formatted)) continue;
    seen.add(formatted);
    out.push(binding);
  }
  return out;
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
  director: resolveMemoryRerankModelBinding(
    env.RESPONSE_DIRECTOR_MODEL,
    extractor,
  ),
  fallbacks: {
    classifyTurnRoute: parseFallbackModelBindings(
      env.CLASSIFY_TURN_ROUTE_FALLBACK_MODEL,
      extractor,
    ),
    queryRewrite: parseFallbackModelBindings(
      env.QUERY_REWRITE_FALLBACK_MODEL,
      extractor,
    ),
    memoryRerank: parseFallbackModelBindings(
      env.MEMORY_RERANK_FALLBACK_MODEL,
      resolveMemoryRerankModelBinding(env.MEMORY_RERANK_MODEL, extractor),
    ),
    recallThought: parseFallbackModelBindings(
      env.RECALL_THOUGHT_FALLBACK_MODEL,
      extractor,
    ),
    responseValidator: parseFallbackModelBindings(
      env.RESPONSE_VALIDATOR_FALLBACK_MODEL,
      parseModelBinding(env.VALIDATOR_MODEL),
    ),
    attributionJudge: parseFallbackModelBindings(
      env.VALIDATOR_ATTRIBUTION_JUDGE_FALLBACK_MODEL,
      parseModelBinding(
        env.VALIDATOR_ATTRIBUTION_JUDGE_MODEL?.trim()
          ? env.VALIDATOR_ATTRIBUTION_JUDGE_MODEL.trim()
          : env.EXTRACTOR_MODEL,
      ),
    ),
    memoryDedupJudge: parseFallbackModelBindings(
      env.MEMORY_DEDUP_JUDGE_FALLBACK_MODEL,
      parseModelBinding(env.VALIDATOR_MODEL),
    ),
    postTurnExtractor: parseFallbackModelBindings(
      env.POST_TURN_EXTRACTOR_FALLBACK_MODEL,
      extractor,
    ),
    sessionSummaryMerger: parseFallbackModelBindings(
      env.POST_TURN_EXTRACTOR_FALLBACK_MODEL,
      extractor,
    ),
    structMemConsolidation: parseFallbackModelBindings(
      env.STRUCTMEM_CONSOLIDATION_FALLBACK_MODEL,
      resolveConsolidationModelBinding(env.STRUCTMEM_CONSOLIDATION_MODEL, extractor),
    ),
    structMemCrossSessionDistillation: parseFallbackModelBindings(
      env.STRUCTMEM_CROSS_SESSION_DISTILLATION_FALLBACK_MODEL,
      resolveConsolidationModelBinding(env.STRUCTMEM_CONSOLIDATION_MODEL, extractor),
    ),
    responseDirector: parseFallbackModelBindings(
      env.RESPONSE_DIRECTOR_FALLBACK_MODEL,
      resolveMemoryRerankModelBinding(env.RESPONSE_DIRECTOR_MODEL, extractor),
    ),
  },
} as const;
