import type { QueryRewriteResult } from "../retrieval/query/rewriteQuery";
import { RETRIEVAL_LIMITS } from "../character/canonRules";
import type { MotifSignal, StructMemMotifProbeSummary } from "./motifTypes";

export type RetrievalIntent =
  | "scene_continuation"
  | "canon_fact"
  | "personal_recall"
  | "emotional_response"
  | "plan_or_promise"
  | "relationship_progression"
  | "general";

export type CanonRetrievalMode = "full" | "compact" | "skip";

export type TurnType =
  | "immediate_action"
  | "recent_reference"
  | "older_recall"
  | "canon_question"
  | "web_question"
  | "general_roleplay";

export type RetrievalInjectionMode = "full" | "compact" | "skip";

export interface EnhancedContextNeed {
  needsRecentTurns: boolean;
  needsOlderSessionRecall: boolean;
  needsDurableMemory: boolean;
  needsStructMem: boolean;
  needsStructMemConsolidation: boolean;
  needsCanon: boolean;
  needsWeb: boolean;
  structMemReason?:
    | "none"
    | "explicit_recall"
    | "implicit_repeated_motif"
    | "open_thread"
    | "relationship_state"
    | "promise_or_decision"
    | "emotional_shift";
  injectionMode: RetrievalInjectionMode;
  reason: string;
}

export interface RetrievalPlan {
  intent: RetrievalIntent;
  broadFailOpen: boolean;
  canonMode: CanonRetrievalMode;
  forceOpenThreads: boolean;
  durableMemoryTopK: number;
  sessionRecallTopK: number;
  structMemEntryTopK: number;
  structMemConsolidationTopK: number;
  openThreadTopK: number;
  contextNeed: EnhancedContextNeed;
}

export interface RetrievalPlanInput {
  queryRewrite: QueryRewriteResult;
  userMessage: string;
  annotationFallback: boolean;
  confidenceThreshold: number;
  structMemEntryDefaultTopK: number;
  structMemConsolidationDefaultTopK: number;
  motifSignal?: MotifSignal;
  motifProbe?: StructMemMotifProbeSummary;
}

function normalizedText(input: RetrievalPlanInput): string {
  return [
    input.userMessage,
    input.queryRewrite.entities.join(" "),
    input.queryRewrite.segments.map((s) => s.text).join(" "),
  ]
    .join(" ")
    .toLowerCase();
}

function hasAny(text: string, terms: string[]): boolean {
  return terms.some((term) => text.includes(term));
}

function inferIntent(input: RetrievalPlanInput): RetrievalIntent {
  const text = normalizedText(input);
  const replyDirectionOnly =
    input.queryRewrite.segments.length > 0 &&
    input.queryRewrite.segments.every((s) => s.lane === "reply_direction");

  if (
    input.queryRewrite.intent === "attribution" ||
    hasAny(text, [
      "canon",
      "原作",
      "剧情",
      "谁",
      "哪一",
      "chapter",
      "episode",
      "安排",
      "提出",
    ])
  ) {
    return "canon_fact";
  }

  if (
    hasAny(text, [
      "promise",
      "promised",
      "plan",
      "later",
      "next time",
      "pending",
      "remind",
      "约定",
      "承诺",
      "计划",
      "之后",
      "待会",
      "下次",
      "记得",
    ])
  ) {
    return "plan_or_promise";
  }

  if (
    hasAny(text, [
      "relationship",
      "trust",
      "distance",
      "closer",
      "恋人",
      "关系",
      "信任",
      "疏远",
      "靠近",
      "亲密",
    ])
  ) {
    return "relationship_progression";
  }

  if (
    hasAny(text, [
      "feel",
      "hurt",
      "angry",
      "sad",
      "afraid",
      "开心",
      "难过",
      "生气",
      "害怕",
      "委屈",
      "情绪",
    ])
  ) {
    return "emotional_response";
  }

  if (
    input.queryRewrite.intent === "recall" ||
    hasAny(text, ["remember", "memory", "recall", "记得", "回忆", "之前"])
  ) {
    return "personal_recall";
  }

  if (
    replyDirectionOnly ||
    hasAny(text, [
      "continue",
      "继续",
      "接着",
      "然后",
      "现在",
      "scene",
      "场景",
    ])
  ) {
    return "scene_continuation";
  }

  return "general";
}

function resolveContextNeed(
  intent: RetrievalIntent,
  broadFailOpen: boolean,
  motifSignal?: MotifSignal,
): EnhancedContextNeed {
  if (broadFailOpen) {
    return {
      needsRecentTurns: true,
      needsOlderSessionRecall: true,
      needsDurableMemory: true,
      needsStructMem: true,
      needsStructMemConsolidation: true,
      needsCanon: true,
      needsWeb: false,
      injectionMode: "full",
      reason: "broad fail-open — low confidence or parse failure",
    };
  }

  const base: EnhancedContextNeed = {
    needsRecentTurns: true,
    needsOlderSessionRecall: false,
    needsDurableMemory: false,
    needsStructMem: false,
    needsStructMemConsolidation: false,
    needsCanon: false,
    needsWeb: false,
    injectionMode: "compact",
    reason: "",
  };

  switch (intent) {
    case "canon_fact":
      return {
        ...base,
        needsCanon: true,
        needsDurableMemory: true,
        injectionMode: "full",

        reason: "canon fact query — needs canon + durable memory",
      };
    case "personal_recall":
      return {
        ...base,
        needsOlderSessionRecall: true,
        needsStructMem: true,
        needsDurableMemory: true,
        injectionMode: "full",

        reason: "personal recall — needs older session + structmem + durable memory + optional canon",
      };
    case "plan_or_promise":
      return {
        ...base,
        needsStructMem: true,
        needsDurableMemory: true,

        reason: "plan/promise — needs structmem for open threads + durable memory",
      };
    case "relationship_progression":
      return {
        ...base,
        needsStructMem: true,
        needsDurableMemory: true,
        injectionMode: "compact",

        reason: "relationship progression — structmem for relevant history",
      };
    case "emotional_response":
      return {
        ...base,
        needsDurableMemory: true,

        reason: "emotional response — durable memory for emotional context",
      };
    case "scene_continuation":
    case "general":
    default: {
      const hasStrongMotif =
        motifSignal &&
        !motifSignal.hasNegation &&
        motifSignal.bodyOrObjectTerms.length > 0 &&
        motifSignal.actionTerms.length > 0 &&
        motifSignal.confidence >= 0.7;
      return {
        ...base,
        needsDurableMemory: true,
        ...(hasStrongMotif
          ? {
              needsStructMem: true,
              structMemReason: "implicit_repeated_motif" as const,
      
              reason: "scene continuation with distinctive motif signal — probe structmem",
            }
          : {
      
              reason: "scene continuation / general — minimal context, durable memory only",
            }),
      };
    }
  }
}

function maxInjectionMode(
  a: RetrievalInjectionMode,
  b: RetrievalInjectionMode,
): RetrievalInjectionMode {
  if (a === "full" || b === "full") return "full";
  if (a === "compact" || b === "compact") return "compact";
  return "skip";
}

/** Compact snapshot for LangSmith / observability (avoid huge payloads). */
export function summarizeContextNeedForTrace(
  need: EnhancedContextNeed | undefined,
): Record<string, unknown> | undefined {
  if (!need) return undefined;
  const maxReason = 320;
  const reason =
    need.reason.length > maxReason
      ? `${need.reason.slice(0, maxReason)}…`
      : need.reason;
  return {
    needsRecentTurns: need.needsRecentTurns,
    needsOlderSessionRecall: need.needsOlderSessionRecall,
    needsDurableMemory: need.needsDurableMemory,
    needsStructMem: need.needsStructMem,
    needsStructMemConsolidation: need.needsStructMemConsolidation,
    needsCanon: need.needsCanon,
    needsWeb: need.needsWeb,
    injectionMode: need.injectionMode,
    structMemReason: need.structMemReason,
    reasonPreview: reason,
  };
}

export function applyContextNeedConflictRules(
  need: EnhancedContextNeed,
  queryRewrite: QueryRewriteResult,
  motifProbe?: StructMemMotifProbeSummary,
): EnhancedContextNeed {
  const result = { ...need };

  if (queryRewrite.intent === "attribution") {
    result.needsCanon = true;
    result.injectionMode = maxInjectionMode(result.injectionMode, "compact");
    result.reason += " | attribution intent forces canon";
  }

  if (queryRewrite.intent === "recall") {
    result.needsOlderSessionRecall = true;
    result.needsStructMem = true;
    result.reason += " | recall intent forces older recall + structmem";
  }

  if (motifProbe?.hasStrongMatch) {
    result.needsStructMem = true;
    result.structMemReason = "implicit_repeated_motif";
    result.injectionMode = maxInjectionMode(result.injectionMode, "compact");
    result.reason += " | motif probe strong match forces structmem";
  }

  return result;
}

export function buildRetrievalPlan(input: RetrievalPlanInput): RetrievalPlan {
  const lowConfidence =
    input.queryRewrite.confidence !== undefined &&
    input.queryRewrite.confidence < input.confidenceThreshold;
  const broadFailOpen =
    !input.queryRewrite.parseOk || input.annotationFallback || lowConfidence;

  const intent = broadFailOpen ? "general" : inferIntent(input);
  const contextNeed = applyContextNeedConflictRules(
    resolveContextNeed(intent, broadFailOpen, input.motifSignal),
    input.queryRewrite,
    input.motifProbe,
  );

  const base: RetrievalPlan = {
    intent,
    broadFailOpen,
    canonMode: "full",
    forceOpenThreads: false,
    durableMemoryTopK: RETRIEVAL_LIMITS.durableMemoryTopK,
    sessionRecallTopK: RETRIEVAL_LIMITS.sessionRecallTopK,
    structMemEntryTopK: input.structMemEntryDefaultTopK,
    structMemConsolidationTopK: input.structMemConsolidationDefaultTopK,
    openThreadTopK: 5,
    contextNeed,
  };

  if (broadFailOpen) return base;

  switch (intent) {
    case "canon_fact":
      return {
        ...base,
        canonMode: "full",
        durableMemoryTopK: Math.max(2, Math.ceil(base.durableMemoryTopK / 2)),
        sessionRecallTopK: Math.max(2, Math.ceil(base.sessionRecallTopK / 2)),
      };
    case "scene_continuation":
      return {
        ...base,
        canonMode: "compact",
        durableMemoryTopK: Math.max(2, Math.ceil(base.durableMemoryTopK / 2)),
        sessionRecallTopK: Math.max(2, Math.ceil(base.sessionRecallTopK / 2)),
      };
    case "personal_recall":
      return {
        ...base,
        canonMode: "compact",
        durableMemoryTopK: base.durableMemoryTopK + 2,
        sessionRecallTopK: base.sessionRecallTopK + 2,
      };
    case "plan_or_promise":
      return {
        ...base,
        canonMode: "compact",
        forceOpenThreads: true,
        openThreadTopK: 7,
        structMemEntryTopK: base.structMemEntryTopK + 2,
      };
    case "relationship_progression":
    case "emotional_response":
      return {
        ...base,
        canonMode: "compact",
        durableMemoryTopK: base.durableMemoryTopK + 1,
        structMemEntryTopK: base.structMemEntryTopK + 1,
      };
    case "general":
    default:
      return base;
  }
}

export function classifyTurnType(
  retrievalPlan: RetrievalPlan,
  userMessage: string,
  queryRewrite: QueryRewriteResult,
): TurnType {
  const text = [userMessage, queryRewrite.entities.join(" ")]
    .join(" ")
    .toLowerCase();

  if (retrievalPlan.intent === "canon_fact") return "canon_question";
  if (retrievalPlan.intent === "personal_recall") return "older_recall";

  if (retrievalPlan.intent === "scene_continuation") {
    const hasContinuationMarker = /继续|接着|然后|之后|下一步|接下来|现在/.test(text);
    return hasContinuationMarker ? "recent_reference" : "immediate_action";
  }

  if (retrievalPlan.intent === "general") {
    const hasWebPattern = /搜索|查一下|天气|新闻|最新|查找/.test(text);
    if (hasWebPattern) return "web_question";
  }

  return "general_roleplay";
}
