import { createHash } from "node:crypto";
import { env } from "../config/env";
import { models, type ModelBinding } from "../config/models";
import { buildExperimentVariantMetadata } from "../eval/experimentVariants";
import type { ChatFallbackAttempt } from "../llm/providers";

export const TRACE_SCHEMA_VERSION = 1;
export const TRACE_PRICING_VERSION = "2026-05-29";

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

  // Per-provider cache / reasoning dimensions (passthrough from TraceUsageInput)
  cachedInputTokens?: number;
  cacheHitInputTokens?: number;
  cacheMissInputTokens?: number;
  cacheReadInputTokens?: number;
  cacheCreationInputTokens?: number;
  cacheCreation5mTokens?: number;
  cacheCreation1hTokens?: number;
  reasoningTokens?: number;

  fallbackUsed?: boolean;
  fallbackAttempts?: readonly {
    provider: ModelBinding["provider"];
    model: string;
    trigger: ChatFallbackAttempt["trigger"];
    inputTokens?: number;
    outputTokens?: number;
    finishReason?: string | null;
    cachedInputTokens?: number;
    cacheHitInputTokens?: number;
    cacheMissInputTokens?: number;
    cacheReadInputTokens?: number;
    cacheCreationInputTokens?: number;
  }[];
  fallbackAttemptTotalInputTokens?: number;
  fallbackAttemptTotalOutputTokens?: number;
  fallbackAttemptEstimatedCostUsd?: number | null;
}

export interface LangSmithUsageMetadata {
  input_tokens: number;
  output_tokens: number;
  total_tokens: number;

  // Cost fields read by LangSmith UI's Cost column (per
  // langsmith@^0.3.0 UsageMetadata schema).
  input_cost?: number;
  output_cost?: number;
  total_cost?: number;
  input_cost_details?: {
    cache_creation?: number;
    cache_read?: number;
  };
  output_cost_details?: {
    reasoning?: number;
  };
}

export type ModelCostBreakdown = {
  total: number;
  input: number;
  output: number;
  inputDetails?: {
    cache_read?: number;
    cache_creation?: number;
  };
  outputDetails?: {
    reasoning?: number;
  };
};

export interface TraceUsageInput {
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

export interface TraceContextInput {
  session?: TraceSessionLike | null;
  requestId?: string;
  turnIndex?: number;
  extra?: Record<string, unknown>;
}

type AnthropicRateCard = {
  kind: "anthropic";
  input: number;           // per 1M tokens
  cacheWrite5m: number;
  cacheWrite1h: number;
  cacheRead: number;
  output: number;
};

type OpenAIRateCard = {
  kind: "openai";
  input: number;
  cachedInput?: number;    // optional — embeddings have none
  output?: number;         // optional — embeddings have none
};

type DeepSeekRateCard = {
  kind: "deepseek";
  cacheHitInput: number;
  cacheMissInput: number;
  output: number;
};

type RateCard = AnthropicRateCard | OpenAIRateCard | DeepSeekRateCard;

const MODEL_RATE_CARDS: Record<string, RateCard> = {
  "anthropic:claude-sonnet-4-5": {
    kind: "anthropic",
    input: 3, cacheWrite5m: 3.75, cacheWrite1h: 6, cacheRead: 0.3, output: 15,
  },
  "anthropic:claude-haiku-4-5": {
    kind: "anthropic",
    input: 1, cacheWrite5m: 1.25, cacheWrite1h: 2, cacheRead: 0.1, output: 5,
  },
  "openai:gpt-5-nano": {
    kind: "openai",
    input: 0.05, cachedInput: 0.005, output: 0.4,
  },
  "openai:gpt-5-mini": {
    kind: "openai",
    input: 0.25, cachedInput: 0.025, output: 2,
  },
  "openai:text-embedding-3-small": {
    kind: "openai", input: 0.02,
  },
  "deepseek:deepseek-v4-flash": {
    kind: "deepseek",
    cacheHitInput: 0.0028, cacheMissInput: 0.14, output: 0.28,
  },
  "deepseek:deepseek-chat": {
    // Documented alias for deepseek-v4-flash non-thinking. Inherits flash rates.
    kind: "deepseek",
    cacheHitInput: 0.0028, cacheMissInput: 0.14, output: 0.28,
  },
  "deepseek:deepseek-v4-pro": {
    // 75%-off discount made permanent 2026-05-22.
    kind: "deepseek",
    cacheHitInput: 0.003625, cacheMissInput: 0.435, output: 0.87,
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
        ...(a.cachedInputTokens !== undefined ? { cachedInputTokens: a.cachedInputTokens } : {}),
        ...(a.cacheHitInputTokens !== undefined ? { cacheHitInputTokens: a.cacheHitInputTokens } : {}),
        ...(a.cacheMissInputTokens !== undefined ? { cacheMissInputTokens: a.cacheMissInputTokens } : {}),
        ...(a.cacheReadInputTokens !== undefined ? { cacheReadInputTokens: a.cacheReadInputTokens } : {}),
        ...(a.cacheCreationInputTokens !== undefined ? { cacheCreationInputTokens: a.cacheCreationInputTokens } : {}),
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
        const breakdown = estimateModelCost(a.binding, {
          inputTokens: a.inputTokens ?? 0,
          outputTokens: a.outputTokens ?? 0,
          ...(a.cachedInputTokens !== undefined ? { cachedInputTokens: a.cachedInputTokens } : {}),
          ...(a.cacheHitInputTokens !== undefined ? { cacheHitInputTokens: a.cacheHitInputTokens } : {}),
          ...(a.cacheMissInputTokens !== undefined ? { cacheMissInputTokens: a.cacheMissInputTokens } : {}),
          ...(a.cacheReadInputTokens !== undefined ? { cacheReadInputTokens: a.cacheReadInputTokens } : {}),
          ...(a.cacheCreationInputTokens !== undefined ? { cacheCreationInputTokens: a.cacheCreationInputTokens } : {}),
        });
        if (breakdown === null) {
          anyUnknownPricing = true;
        } else {
          totalCost += breakdown.total;
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
> & Pick<
  TraceLlmMetadata,
  | "cachedInputTokens"
  | "cacheHitInputTokens"
  | "cacheMissInputTokens"
  | "cacheReadInputTokens"
  | "cacheCreationInputTokens"
  | "cacheCreation5mTokens"
  | "cacheCreation1hTokens"
  | "reasoningTokens"
> {
  const inputTokens = Math.max(0, usage.inputTokens);
  const outputTokens = Math.max(0, usage.outputTokens);
  const totalTokens = inputTokens + outputTokens;
  const breakdown = estimateModelCost(binding, usage);
  return {
    inputTokens,
    outputTokens,
    totalTokens,
    estimatedCostUsd: breakdown?.total ?? null,
    pricingKnown: breakdown !== null,
    pricingVersion: TRACE_PRICING_VERSION,
    usage_metadata: {
      input_tokens: inputTokens,
      output_tokens: outputTokens,
      total_tokens: totalTokens,
      ...(breakdown
        ? {
            input_cost: breakdown.input,
            output_cost: breakdown.output,
            total_cost: breakdown.total,
            ...(breakdown.inputDetails
              ? { input_cost_details: breakdown.inputDetails }
              : {}),
            ...(breakdown.outputDetails
              ? { output_cost_details: breakdown.outputDetails }
              : {}),
          }
        : {}),
    },
    ...(usage.cachedInputTokens !== undefined
      ? { cachedInputTokens: usage.cachedInputTokens }
      : {}),
    ...(usage.cacheHitInputTokens !== undefined
      ? { cacheHitInputTokens: usage.cacheHitInputTokens }
      : {}),
    ...(usage.cacheMissInputTokens !== undefined
      ? { cacheMissInputTokens: usage.cacheMissInputTokens }
      : {}),
    ...(usage.cacheReadInputTokens !== undefined
      ? { cacheReadInputTokens: usage.cacheReadInputTokens }
      : {}),
    ...(usage.cacheCreationInputTokens !== undefined
      ? { cacheCreationInputTokens: usage.cacheCreationInputTokens }
      : {}),
    ...(usage.cacheCreation5mTokens !== undefined
      ? { cacheCreation5mTokens: usage.cacheCreation5mTokens }
      : {}),
    ...(usage.cacheCreation1hTokens !== undefined
      ? { cacheCreation1hTokens: usage.cacheCreation1hTokens }
      : {}),
    ...(usage.reasoningTokens !== undefined
      ? { reasoningTokens: usage.reasoningTokens }
      : {}),
  };
}

export function estimateModelCost(
  binding: ModelBinding,
  usage: TraceUsageInput,
): ModelCostBreakdown | null {
  const card = MODEL_RATE_CARDS[formatModelBinding(binding)];
  if (!card) return null;

  const M = 1_000_000;
  // `cents` accumulates everything (identical to the pre-TG7 return value so
  // the .total field preserves the exact same numeric results).
  let cents = 0;
  let inputCents = 0;
  let outputCents = 0;
  let cacheReadCents: number | undefined;
  let cacheCreationCents: number | undefined;
  let reasoningCents: number | undefined;

  const addInput = (v: number): void => { cents += v; inputCents += v; };
  const addOutput = (v: number): void => { cents += v; outputCents += v; };

  switch (card.kind) {
    case "anthropic": {
      addInput((usage.inputTokens / M) * card.input);
      const cr = (usage.cacheReadInputTokens ?? 0) / M * card.cacheRead;
      addInput(cr);
      cacheReadCents = cr;

      const c5 = usage.cacheCreation5mTokens;
      const c1 = usage.cacheCreation1hTokens;
      if (c5 !== undefined || c1 !== undefined) {
        const w5 = ((c5 ?? 0) / M) * card.cacheWrite5m;
        const w1 = ((c1 ?? 0) / M) * card.cacheWrite1h;
        addInput(w5 + w1);
        cacheCreationCents = w5 + w1;
      } else if (usage.cacheCreationInputTokens !== undefined) {
        const w = (usage.cacheCreationInputTokens / M) * card.cacheWrite5m;
        addInput(w);
        cacheCreationCents = w;
      }

      addOutput((usage.outputTokens / M) * card.output);
      break;
    }
    case "openai": {
      const cached = usage.cachedInputTokens ?? 0;
      const fresh = usage.inputTokens - cached;
      addInput((fresh / M) * card.input);
      if (card.cachedInput !== undefined) {
        const cc = (cached / M) * card.cachedInput;
        addInput(cc);
        cacheReadCents = cc;
      }
      if (card.output !== undefined) {
        addOutput((usage.outputTokens / M) * card.output);
      }
      if (usage.reasoningTokens && card.output !== undefined) {
        reasoningCents = ((usage.reasoningTokens) / M) * card.output;
      }
      break;
    }
    case "deepseek": {
      const hit = usage.cacheHitInputTokens ?? 0;
      const miss = usage.cacheMissInputTokens ?? (usage.inputTokens - hit);
      const hitC = (hit / M) * card.cacheHitInput;
      const missC = (miss / M) * card.cacheMissInput;
      addInput(hitC + missC);
      cacheReadCents = hitC;

      addOutput((usage.outputTokens / M) * card.output);
      if (usage.reasoningTokens) {
        reasoningCents = ((usage.reasoningTokens) / M) * card.output;
      }
      break;
    }
  }

  const input = Number(inputCents.toFixed(8));
  const output = Number(outputCents.toFixed(8));
  // total is the rounded sum of rounded input + output (matches the
  // pre-TG7 single-cents rounding for all existing test cases).
  const total = Number((input + output).toFixed(8));

  const breakdown: ModelCostBreakdown = { total, input, output };

  if (cacheReadCents !== undefined || cacheCreationCents !== undefined) {
    breakdown.inputDetails = {};
    if (cacheReadCents !== undefined) breakdown.inputDetails.cache_read = Number(cacheReadCents.toFixed(8));
    if (cacheCreationCents !== undefined) breakdown.inputDetails.cache_creation = Number(cacheCreationCents.toFixed(8));
  }

  if (reasoningCents !== undefined) {
    breakdown.outputDetails = { reasoning: Number(reasoningCents.toFixed(8)) };
  }

  return breakdown;
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
