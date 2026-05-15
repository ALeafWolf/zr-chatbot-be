import type { QueryRewriteResult } from "../retrieval/query/rewriteQuery";
import { RETRIEVAL_LIMITS } from "../character/canonRules";

export type RetrievalIntent =
  | "scene_continuation"
  | "canon_fact"
  | "personal_recall"
  | "emotional_response"
  | "plan_or_promise"
  | "relationship_progression"
  | "general";

export type CanonRetrievalMode = "full" | "compact" | "skip";

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
}

export interface RetrievalPlanInput {
  queryRewrite: QueryRewriteResult;
  userMessage: string;
  annotationFallback: boolean;
  confidenceThreshold: number;
  structMemEntryDefaultTopK: number;
  structMemConsolidationDefaultTopK: number;
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

export function buildRetrievalPlan(input: RetrievalPlanInput): RetrievalPlan {
  const lowConfidence =
    input.queryRewrite.confidence !== undefined &&
    input.queryRewrite.confidence < input.confidenceThreshold;
  const broadFailOpen =
    !input.queryRewrite.parseOk || input.annotationFallback || lowConfidence;

  const intent = broadFailOpen ? "general" : inferIntent(input);
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
