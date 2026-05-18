import type { QueryRewriteResult } from "../retrieval/query/rewriteQuery";
import { rewriteQuery } from "../retrieval/query/rewriteQuery";

export interface ContextPlannerOutput {
  queryRewrite: QueryRewriteResult;
  structuredUserQuery: {
    userSpeech?: string;
    userAction?: string;
    userThought?: string;
    replyDirection?: string;
  };
  intent:
    | "scene_continuation"
    | "explicit_recall"
    | "implicit_memory_callback"
    | "canon_question"
    | "relationship_state"
    | "real_world_info"
    | "mixed"
    | "unclear";
  entities: string[];
  retrievalHints: {
    sourcePriority: Array<
      | "recent_chat"
      | "session_memory"
      | "structmem"
      | "structmem_consolidation"
      | "interactive_memory"
      | "canon"
      | "web"
    >;
    queryVariants: {
      memory: string[];
      structmem: string[];
      structmemConsolidation: string[];
      interactiveMemory: string[];
      canon: string[];
      web: string[];
    };
    possibleMotif: boolean;
    possibleCanonClaim: boolean;
    possibleOldMemoryReference: boolean;
    possibleDurableMemoryReference: boolean;
  };
  confidence: number;
  reason: string;
}

function mapLane(
  segments: QueryRewriteResult["segments"],
  lane: string,
): string | undefined {
  const text = segments
    .filter((s) => s.lane === lane)
    .map((s) => s.text)
    .join("\n")
    .trim();
  return text || undefined;
}

function deriveIntent(
  queryRewrite: QueryRewriteResult,
  motifSignal?: { hasNegation: boolean; confidence: number },
  annotationFallback?: boolean,
): ContextPlannerOutput["intent"] {
  if (!queryRewrite.parseOk || annotationFallback) return "unclear";
  if (queryRewrite.intent === "attribution") return "canon_question";
  if (queryRewrite.intent === "recall") return "explicit_recall";
  if (
    motifSignal &&
    !motifSignal.hasNegation &&
    motifSignal.confidence >= 0.7
  ) {
    return "implicit_memory_callback";
  }
  return "scene_continuation";
}

/** Wraps rewriteQuery with structured enrichment. First version is a compatibility layer — no new LLM call. */
export async function planContext(userMessage: string): Promise<ContextPlannerOutput> {
  const queryRewrite = await rewriteQuery(userMessage);

  const structuredUserQuery = {
    userSpeech: mapLane(queryRewrite.segments, "user_speech"),
    userAction: mapLane(queryRewrite.segments, "user_action"),
    userThought: mapLane(queryRewrite.segments, "user_thought"),
    replyDirection: mapLane(queryRewrite.segments, "reply_direction"),
  };

  const intent = deriveIntent(queryRewrite);
  const entities = queryRewrite.entities;
  const confidence = queryRewrite.confidence ?? 0;
  const possibleCanonClaim = queryRewrite.intent === "attribution";
  const possibleOldMemoryReference =
    queryRewrite.intent === "recall" ||
    queryRewrite.segments.some((s) => s.lane === "user_thought");

  const reason = [
    `queryRewrite intent: ${queryRewrite.intent}`,
    `parseOk: ${queryRewrite.parseOk}`,
    `confidence: ${confidence}`,
  ].join("; ");

  const memoryQueryText =
    structuredUserQuery.userSpeech ??
    structuredUserQuery.userAction ??
    structuredUserQuery.userThought ??
    userMessage;

  return {
    queryRewrite,
    structuredUserQuery,
    intent,
    entities,
    retrievalHints: {
      sourcePriority: [
        "recent_chat",
        "session_memory",
        "structmem",
        "structmem_consolidation",
        "interactive_memory",
        "canon",
        "web",
      ],
      queryVariants: {
        memory: [memoryQueryText],
        structmem: [memoryQueryText],
        structmemConsolidation: [memoryQueryText],
        interactiveMemory: [memoryQueryText],
        canon: [canonQueryText(queryRewrite, userMessage)],
        web: [userMessage],
      },
      possibleMotif: false,
      possibleCanonClaim,
      possibleOldMemoryReference,
      possibleDurableMemoryReference:
        intent !== "scene_continuation" && intent !== "unclear",
    },
    confidence,
    reason,
  };
}

function canonQueryText(queryRewrite: QueryRewriteResult, userMessage: string): string {
  const parts: string[] = [];
  if (queryRewrite.entities.length > 0) {
    parts.push(`entities: ${queryRewrite.entities.join(", ")}`);
  }
  if (
    queryRewrite.intent === "attribution" ||
    queryRewrite.intent === "recall"
  ) {
    parts.push(`intent: ${queryRewrite.intent}`);
  }
  const raw = userMessage.replace(/\s+/g, " ").trim();
  if (raw) parts.push(raw);
  return parts.join("\n").trim();
}
