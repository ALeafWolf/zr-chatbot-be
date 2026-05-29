import { createHash } from "node:crypto";
import { env } from "../config/env";
import { models, type ModelBinding } from "../config/models";
import { buildExperimentVariantMetadata } from "../eval/experimentVariants";
import type { ChatFallbackAttempt } from "../llm/providers";

export const TRACE_SCHEMA_VERSION = 1;
export const TRACE_PRICING_VERSION = "2026-05-15";

export type TraceModelRole =
  | "generation"
  | "validator"
  | "extractor"
  | "attributionJudge"
  | "memoryDedupJudge"
  | "memoryRerank"
  | "consolidation"
  | "embedding";

export interface TraceSessionLike {
  sessionId: string;
  characterId: string;
  playerId: string;
  mode: string;
  continuityScope: string;
  continuityFamily: string;
  memoryNamespace: string;
}

export interface TraceBaseMetadata {
  traceSchemaVersion: number;
  environment: string;
  appVersion: string;
  gitSha: string;
  requestId?: string;
  sessionId?: string;
  characterId?: string;
  playerIdHash?: string;
  mode?: string;
  continuityScope?: string;
  continuityFamily?: string;
  memoryNamespace?: string;
  turnIndex?: number;
  canonRetrievalPipeline: string;
  canonQueryHyde: boolean;
  useRewrittenQueryForMemoryEmbedding: boolean;
  structMemEnabled: boolean;
  structMemNativeExtractor: boolean;
  structMemConsolidationEnabled: boolean;
  structMemCrossSessionRetrievalEnabled: boolean;
  structMemCrossSessionWriteEnabled: boolean;
  modelGeneration: string;
  modelValidator: string;
  modelExtractor: string;
  modelAttributionJudge: string;
  modelEmbedding: string;
  modelConsolidation: string;

  // Experiment variant metadata
  graphVersion?: string;
  rerankVariant?: string;
  contextPlannerVariant?: string;
  retrievalVariant?: string;
  validatorVariant?: string;
}

export interface TraceLlmMetadata {
  modelProvider: ModelBinding["provider"];
  modelName: string;
  ls_provider: ModelBinding["provider"];
  ls_model_name: string;
  modelRole?: TraceModelRole;
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  estimatedCostUsd?: number | null;
  pricingKnown?: boolean;
  pricingVersion?: string;
  usage_metadata?: LangSmithUsageMetadata;
  fallbackUsed?: boolean;
  fallbackAttempts?: readonly {
    provider: ModelBinding["provider"];
    model: string;
    trigger: ChatFallbackAttempt["trigger"];
    inputTokens?: number;
    outputTokens?: number;
    finishReason?: string | null;
  }[];
  fallbackAttemptTotalInputTokens?: number;
  fallbackAttemptTotalOutputTokens?: number;
  fallbackAttemptEstimatedCostUsd?: number | null;
}

export interface LangSmithUsageMetadata {
  input_tokens: number;
  output_tokens: number;
  total_tokens: number;
}

export interface TraceUsageInput {
  inputTokens: number;
  outputTokens: number;
}

export interface TraceContextInput {
  session?: TraceSessionLike | null;
  requestId?: string;
  turnIndex?: number;
  extra?: Record<string, unknown>;
}

type ModelPrice = {
  inputPerMillion: number;
  outputPerMillion: number;
};

const MODEL_PRICES_USD_PER_MILLION: Record<string, ModelPrice> = {
  "anthropic:claude-sonnet-4-5": { inputPerMillion: 3, outputPerMillion: 15 },
  "anthropic:claude-haiku-4-5": { inputPerMillion: 1, outputPerMillion: 5 },
  "deepseek:deepseek-chat": { inputPerMillion: 0.27, outputPerMillion: 1.1 },
  // TODO(match-provider-pricing-dimensions): add deepseek-v4-flash,
  // deepseek-v4-pro, gpt-5-nano, gpt-5-mini with verified per-provider
  // dimensional pricing.
  "openai:text-embedding-3-small": {
    inputPerMillion: 0.02,
    outputPerMillion: 0,
  },
};

export const TRACE_LLM_METADATA_SYMBOL = Symbol.for(
  "zuoran.trace.llmMetadata",
);

export function hashPlayerId(playerId: string): string {
  return createHash("sha256")
    .update(env.TRACE_PLAYER_HASH_SALT)
    .update(":")
    .update(playerId)
    .digest("hex");
}

export function buildTraceBaseMetadata(
  input: TraceContextInput = {},
): TraceBaseMetadata & Record<string, unknown> {
  const session = input.session ?? undefined;
  return {
    traceSchemaVersion: TRACE_SCHEMA_VERSION,
    environment: env.TRACE_ENVIRONMENT,
    appVersion: env.APP_VERSION,
    gitSha: env.GIT_SHA,
    ...(input.requestId ? { requestId: input.requestId } : {}),
    ...(session
      ? {
          sessionId: session.sessionId,
          characterId: session.characterId,
          playerIdHash: hashPlayerId(session.playerId),
          mode: session.mode,
          continuityScope: session.continuityScope,
          continuityFamily: session.continuityFamily,
          memoryNamespace: session.memoryNamespace,
        }
      : {}),
    ...(input.turnIndex !== undefined ? { turnIndex: input.turnIndex } : {}),
    canonRetrievalPipeline: env.CANON_RETRIEVAL_PIPELINE,
    canonQueryHyde: env.CANON_QUERY_HYDE,
    useRewrittenQueryForMemoryEmbedding:
      env.USE_REWRITTEN_QUERY_FOR_MEMORY_EMBEDDING,
    structMemEnabled: env.STRUCTMEM_ENABLED,
    structMemNativeExtractor: env.STRUCTMEM_NATIVE_EXTRACTOR,
    structMemConsolidationEnabled: env.STRUCTMEM_CONSOLIDATION_ENABLED,
    structMemCrossSessionRetrievalEnabled:
      env.STRUCTMEM_CROSS_SESSION_RETRIEVAL_ENABLED,
    structMemCrossSessionWriteEnabled: env.STRUCTMEM_CROSS_SESSION_WRITE_ENABLED,
    modelGeneration: formatModelBinding(models.generation),
    modelValidator: formatModelBinding(models.validator),
    modelExtractor: formatModelBinding(models.extractor),
    modelAttributionJudge: formatModelBinding(models.attributionJudge),
    modelEmbedding: formatModelBinding(models.embedding),
    modelConsolidation: formatModelBinding(models.consolidation),
    ...(input.extra ?? {}),
    ...buildExperimentVariantMetadata(),
  };
}

export function buildLlmTraceMetadata(input: {
  binding: ModelBinding;
  modelRole?: TraceModelRole;
  usage?: TraceUsageInput;
  fallback?: {
    used: boolean;
    attempts: readonly ChatFallbackAttempt[];
  };
}): TraceLlmMetadata {
  const usage = input.usage
    ? buildUsageMetadata(input.binding, input.usage)
    : undefined;

  let fallbackMetadata: {
    fallbackUsed?: boolean;
    fallbackAttempts?: TraceLlmMetadata["fallbackAttempts"];
    fallbackAttemptTotalInputTokens?: number;
    fallbackAttemptTotalOutputTokens?: number;
    fallbackAttemptEstimatedCostUsd?: number | null;
  } = {};

  if (input.fallback && input.fallback.attempts.length > 0) {
    const binding = input.binding;
    const attempts = input.fallback.attempts;

    // Drop final attempt when its binding matches the trace binding —
    // its tokens are already counted in `usage`.
    const deduped =
      attempts.length > 0 &&
      binding &&
      attempts[attempts.length - 1]!.binding.provider === binding.provider &&
      attempts[attempts.length - 1]!.binding.model === binding.model
        ? attempts.slice(0, -1)
        : attempts;

    if (deduped.length > 0) {
      const mapped = deduped.map((a) => ({
        provider: a.binding.provider,
        model: a.binding.model,
        trigger: a.trigger,
        ...(a.inputTokens !== undefined ? { inputTokens: a.inputTokens } : {}),
        ...(a.outputTokens !== undefined ? { outputTokens: a.outputTokens } : {}),
        ...(a.finishReason !== undefined ? { finishReason: a.finishReason } : {}),
      }));

      const hasAnyInputTokens = deduped.some((a) => a.inputTokens !== undefined);
      const hasAnyOutputTokens = deduped.some((a) => a.outputTokens !== undefined);

      const totalInputTokens = hasAnyInputTokens
        ? deduped.reduce((sum, a) => sum + (a.inputTokens ?? 0), 0)
        : undefined;
      const totalOutputTokens = hasAnyOutputTokens
        ? deduped.reduce((sum, a) => sum + (a.outputTokens ?? 0), 0)
        : undefined;

      // Compute cost rollup: if any attempt has unknown pricing, result is null
      let totalCost = 0;
      let anyUnknownPricing = false;
      for (const a of deduped) {
        const cost = estimateModelCost(a.binding, {
          inputTokens: a.inputTokens ?? 0,
          outputTokens: a.outputTokens ?? 0,
        });
        if (cost === null) {
          anyUnknownPricing = true;
        } else {
          totalCost += cost;
        }
      }

      fallbackMetadata = {
        fallbackUsed: input.fallback.used,
        fallbackAttempts: mapped,
        ...(totalInputTokens !== undefined
          ? { fallbackAttemptTotalInputTokens: totalInputTokens }
          : {}),
        ...(totalOutputTokens !== undefined
          ? { fallbackAttemptTotalOutputTokens: totalOutputTokens }
          : {}),
        fallbackAttemptEstimatedCostUsd: anyUnknownPricing
          ? null
          : Number(totalCost.toFixed(8)),
      };
    } else {
      fallbackMetadata = {
        fallbackUsed: input.fallback.used,
        fallbackAttempts: [],
      };
    }
  }

  return {
    modelProvider: input.binding.provider,
    modelName: input.binding.model,
    ls_provider: input.binding.provider,
    ls_model_name: input.binding.model,
    ...(input.modelRole ? { modelRole: input.modelRole } : {}),
    ...(usage ?? {}),
    ...fallbackMetadata,
  };
}

export function buildUsageMetadata(
  binding: ModelBinding,
  usage: TraceUsageInput,
): Required<
  Pick<
    TraceLlmMetadata,
    | "inputTokens"
    | "outputTokens"
    | "totalTokens"
    | "estimatedCostUsd"
    | "pricingKnown"
    | "pricingVersion"
    | "usage_metadata"
  >
> {
  const inputTokens = Math.max(0, usage.inputTokens);
  const outputTokens = Math.max(0, usage.outputTokens);
  const totalTokens = inputTokens + outputTokens;
  const cost = estimateModelCost(binding, { inputTokens, outputTokens });
  return {
    inputTokens,
    outputTokens,
    totalTokens,
    estimatedCostUsd: cost,
    pricingKnown: cost !== null,
    pricingVersion: TRACE_PRICING_VERSION,
    usage_metadata: {
      input_tokens: inputTokens,
      output_tokens: outputTokens,
      total_tokens: totalTokens,
    },
  };
}

export function estimateModelCost(
  binding: ModelBinding,
  usage: TraceUsageInput,
): number | null {
  const price = MODEL_PRICES_USD_PER_MILLION[formatModelBinding(binding)];
  if (!price) return null;
  const cost =
    (usage.inputTokens / 1_000_000) * price.inputPerMillion +
    (usage.outputTokens / 1_000_000) * price.outputPerMillion;
  return Number(cost.toFixed(8));
}

export function attachTraceLlmMetadata<T extends object>(
  value: T,
  input: {
    binding: ModelBinding;
    modelRole?: TraceModelRole;
    usage: TraceUsageInput;
    fallback?: {
      used: boolean;
      attempts: readonly ChatFallbackAttempt[];
    };
  },
): T {
  Object.defineProperty(value, TRACE_LLM_METADATA_SYMBOL, {
    value: buildLlmTraceMetadata(input),
    enumerable: true,
    configurable: true,
  });
  return value;
}

export function getAttachedTraceLlmMetadata(
  value: unknown,
): TraceLlmMetadata | undefined {
  if (!value || typeof value !== "object") return undefined;
  return (value as Record<symbol, unknown>)[TRACE_LLM_METADATA_SYMBOL] as
    | TraceLlmMetadata
    | undefined;
}

export function findAttachedTraceLlmMetadata(
  value: unknown,
): TraceLlmMetadata | undefined {
  const direct = getAttachedTraceLlmMetadata(value);
  if (direct) return direct;

  if (!value || typeof value !== "object") return undefined;
  const rec = value as Record<string, unknown>;

  for (const key of ["output", "outputs", "result", "data"] as const) {
    const nested = getAttachedTraceLlmMetadata(rec[key]);
    if (nested) return nested;
  }

  return undefined;
}

export function formatModelBinding(binding: ModelBinding): string {
  return `${binding.provider}:${binding.model}`;
}
