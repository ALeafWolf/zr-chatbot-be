import type { Env } from "../config/env";
import type { ChatSession } from "../db/schema/chat";
import type { PostTurnSignals } from "../llm/extraction/extractPostTurnSignals";

export interface SessionChunkSuppressionInput {
  structMemEnabled: boolean;
  suppressExtractorSessionChunks: boolean;
  nativeStructMemExtractor: boolean;
}

export function shouldSuppressExtractorSessionChunks(
  input: SessionChunkSuppressionInput,
): boolean {
  return (
    input.structMemEnabled &&
    (input.suppressExtractorSessionChunks || input.nativeStructMemExtractor)
  );
}

export type PostTurnWritePlanTarget =
  | "rawChunk"
  | "structMem"
  | "structMemConsolidation"
  | "sessionChunks"
  | "durableMemory"
  | "summaryCompact";

export interface PostTurnWriteDecision {
  write: boolean;
  skippedReason: string | null;
}

export interface PostTurnWritePlan {
  rawChunk: PostTurnWriteDecision;
  structMem: PostTurnWriteDecision;
  structMemConsolidation: PostTurnWriteDecision;
  sessionChunks: PostTurnWriteDecision;
  durableMemory: PostTurnWriteDecision;
  summaryCompact: PostTurnWriteDecision;
  skippedReasons: Partial<Record<PostTurnWritePlanTarget, string>>;
  signalCounts: {
    memoryFacts: number;
    crossSessionMemoryFacts: number;
    currentSessionMemoryFacts: number;
    nativeStructMemEntries: number;
  };
}

export type PostTurnWritePlanSession = Pick<
  ChatSession,
  "mode" | "writebackPolicy"
>;

export type PostTurnWritePlanEnv = Pick<
  Env,
  | "STRUCTMEM_ENABLED"
  | "STRUCTMEM_CONSOLIDATION_ENABLED"
  | "STRUCTMEM_SUPPRESS_EXTRACTOR_SESSION_CHUNKS"
  | "STRUCTMEM_NATIVE_EXTRACTOR"
>;

export type PostTurnWritePlanSignals = Pick<
  PostTurnSignals,
  "memoryFacts" | "structMemEntries"
> & {
  shouldWriteMemory?: boolean;
};

function decision(write: boolean, skippedReason: string | null): PostTurnWriteDecision {
  return { write, skippedReason: write ? null : skippedReason };
}

export function buildPostTurnWritePlan(
  session: PostTurnWritePlanSession,
  env: PostTurnWritePlanEnv,
  signals: PostTurnWritePlanSignals,
): PostTurnWritePlan {
  const sandbox = session.mode === "sandbox";
  const suppressSessionChunks = shouldSuppressExtractorSessionChunks({
    structMemEnabled: env.STRUCTMEM_ENABLED,
    suppressExtractorSessionChunks:
      env.STRUCTMEM_SUPPRESS_EXTRACTOR_SESSION_CHUNKS,
    nativeStructMemExtractor: env.STRUCTMEM_NATIVE_EXTRACTOR,
  });
  const crossSessionMemoryFacts = signals.memoryFacts.filter(
    (candidate) => candidate.memoryScope === "cross_session",
  ).length;
  const currentSessionMemoryFacts = signals.memoryFacts.filter(
    (candidate) => candidate.memoryScope === "current_session",
  ).length;
  const shouldWriteMemory =
    signals.shouldWriteMemory ?? session.writebackPolicy !== "no_writeback";

  const plan: PostTurnWritePlan = {
    rawChunk: decision(true, null),
    structMem: decision(
      env.STRUCTMEM_ENABLED && !sandbox,
      sandbox ? "sandbox_session" : "structmem_disabled",
    ),
    structMemConsolidation: decision(
      env.STRUCTMEM_ENABLED && env.STRUCTMEM_CONSOLIDATION_ENABLED && !sandbox,
      sandbox
        ? "sandbox_session"
        : !env.STRUCTMEM_ENABLED
          ? "structmem_disabled"
          : "structmem_consolidation_disabled",
    ),
    sessionChunks: decision(
      !sandbox && !suppressSessionChunks,
      sandbox
        ? "sandbox_session"
        : suppressSessionChunks
          ? "suppressed_by_structmem_policy"
          : "disabled",
    ),
    durableMemory: decision(
      shouldWriteMemory && crossSessionMemoryFacts > 0,
      !shouldWriteMemory
        ? "writeback_disabled"
        : "no_cross_session_memory_facts",
    ),
    summaryCompact: decision(!sandbox, sandbox ? "sandbox_session" : null),
    skippedReasons: {},
    signalCounts: {
      memoryFacts: signals.memoryFacts.length,
      crossSessionMemoryFacts,
      currentSessionMemoryFacts,
      nativeStructMemEntries: signals.structMemEntries.length,
    },
  };

  for (const target of [
    "rawChunk",
    "structMem",
    "structMemConsolidation",
    "sessionChunks",
    "durableMemory",
    "summaryCompact",
  ] as const) {
    const skippedReason = plan[target].skippedReason;
    if (skippedReason) {
      plan.skippedReasons[target] = skippedReason;
    }
  }

  return plan;
}
