import { AsyncLocalStorage } from "node:async_hooks";

export type EvalMemorySource =
  | "interactive_memory"
  | "session_chunk"
  | "structmem_entry"
  | "structmem_consolidation"
  | "open_thread"
  | "canon";

export type EvalSourceIds = Record<EvalMemorySource, string[]>;

export interface RetrievalEvalSnapshot {
  query: {
    rawUserMessage: string;
    intent?: string;
    confidence?: number | null;
    hydeUsed: boolean;
    rawFusionUsed: boolean;
  };
  retrieved: EvalSourceIds;
  injected: EvalSourceIds;
  dropped: {
    duplicate: number;
    lowScore: number;
    correctionConflict: number;
    sourceBudget: number;
    other: number;
  };
  topSources: Array<{
    source: EvalMemorySource;
    id?: string;
    score?: number | null;
    reason?: string;
  }>;
  timingsMs?: Record<string, number> | null;
  rerank?: {
    enabled: boolean;
    candidateIds: EvalSourceIds;
    selected: Array<{
      source: EvalMemorySource | "canon" | "session_summary";
      id: string;
      relevance: string;
      usageInstruction: string;
      reason?: string;
    }>;
    rejectedCount: number;
    finalContextMode: string;
    needsEvidenceFallback: boolean;
    fallbackUsed?: boolean;
    /** The selected rerank variant (e.g. llm_rerank_v1, deterministic_only, hybrid_score). */
    rerankVariant?: string;
    /** Human-readable reason for fallback or variant choice. */
    fallbackReason?: string;
  };
}

export interface ValidationEvalSnapshot {
  attempts: Array<{
    attempt: number;
    needsRewrite: boolean;
    inCharacter?: boolean;
    canonConsistent?: boolean;
    issues: string[];
  }>;
  finalNeedsRewrite: boolean;
  wasRewritten: boolean;
  wasDeflected: boolean;
  deflectionReason?: string;
}

export interface MemoryWriteEvalSnapshot {
  postTurnJobId?: string;
  status: "not_run" | "completed" | "failed";
  error?: string;
  extraction?: {
    memoryFactCount: number;
    structMemEntryCount: number;
    shouldWriteMemory: boolean;
  };
  writePlan?: {
    durableMemory: boolean;
    sessionChunks: boolean;
    structMem: boolean;
    structMemConsolidation: boolean;
  };
  durableMemory: {
    written: number;
    deduplicated: number;
    belowThreshold: number;
  };
  sessionChunks: {
    written: number;
    skippedExisting: number;
  };
  structMem: {
    status?: "written" | "skipped_existing" | "skipped_empty";
    eventId?: string;
    entryIds: string[];
  };
  summaryCompaction?: {
    status: string;
    reason?: string;
    lastSummarizedTurnIndex?: number;
  };
}

export interface UsageEvalSnapshot {
  llmSpans: Array<{
    spanName: string;
    modelProvider?: string;
    modelName?: string;
    modelRole?: string;
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
    estimatedCostUsd: number | null;
    pricingKnown: boolean;
  }>;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalTokens: number;
  estimatedCostUsd: number | null;
}

export interface AgentEvalOutput {
  scenarioId: string;
  evalSessionId?: string;
  reply: string;
  assistantMessageId?: string;
  turnIndex?: number;
  mode: "agent_turn";
  success: boolean;
  error?: string;
  retrieval?: RetrievalEvalSnapshot;
  validation?: ValidationEvalSnapshot;
  memoryWrite: MemoryWriteEvalSnapshot;
  usage: UsageEvalSnapshot;
  latencyMs: number;
  cleanup: {
    attempted: boolean;
    completed: boolean;
    error?: string;
  };
}

export interface AgentEvalCapture {
  scenarioId: string;
  evalSessionId?: string;
  startedAt: number;
  retrieval?: RetrievalEvalSnapshot;
  validationAttempts: ValidationEvalSnapshot["attempts"];
  validation?: ValidationEvalSnapshot;
  memoryWrite: MemoryWriteEvalSnapshot;
  usage: UsageEvalSnapshot;
}

const captureStorage = new AsyncLocalStorage<AgentEvalCapture>();

function emptySourceIds(): EvalSourceIds {
  return {
    interactive_memory: [],
    session_chunk: [],
    structmem_entry: [],
    structmem_consolidation: [],
    open_thread: [],
    canon: [],
  };
}

function emptyMemoryWrite(): MemoryWriteEvalSnapshot {
  return {
    status: "not_run",
    durableMemory: {
      written: 0,
      deduplicated: 0,
      belowThreshold: 0,
    },
    sessionChunks: {
      written: 0,
      skippedExisting: 0,
    },
    structMem: {
      entryIds: [],
    },
  };
}

function emptyUsage(): UsageEvalSnapshot {
  return {
    llmSpans: [],
    totalInputTokens: 0,
    totalOutputTokens: 0,
    totalTokens: 0,
    estimatedCostUsd: 0,
  };
}

export function createAgentEvalCapture(input: {
  scenarioId: string;
  evalSessionId?: string;
}): AgentEvalCapture {
  return {
    scenarioId: input.scenarioId,
    evalSessionId: input.evalSessionId,
    startedAt: Date.now(),
    validationAttempts: [],
    memoryWrite: emptyMemoryWrite(),
    usage: emptyUsage(),
  };
}

export async function withAgentEvalCapture<T>(
  capture: AgentEvalCapture,
  fn: () => Promise<T>,
): Promise<T> {
  return await captureStorage.run(capture, fn);
}

export function getAgentEvalCapture(): AgentEvalCapture | undefined {
  return captureStorage.getStore();
}

export function recordRetrievalSnapshot(
  snapshot: RetrievalEvalSnapshot,
): void {
  const capture = getAgentEvalCapture();
  if (!capture) return;
  capture.retrieval = snapshot;
}

export function recordValidationAttempt(input: {
  attempt: number;
  needsRewrite: boolean;
  inCharacter?: boolean;
  canonConsistent?: boolean;
  issues?: string[];
}): void {
  const capture = getAgentEvalCapture();
  if (!capture) return;
  capture.validationAttempts.push({
    attempt: input.attempt,
    needsRewrite: input.needsRewrite,
    ...(input.inCharacter !== undefined
      ? { inCharacter: input.inCharacter }
      : {}),
    ...(input.canonConsistent !== undefined
      ? { canonConsistent: input.canonConsistent }
      : {}),
    issues: input.issues ?? [],
  });
}

export function recordValidationSnapshot(
  snapshot: Omit<ValidationEvalSnapshot, "attempts">,
): void {
  const capture = getAgentEvalCapture();
  if (!capture) return;
  capture.validation = {
    attempts: [...capture.validationAttempts],
    ...snapshot,
  };
}

export function recordLlmUsageSnapshot(input: {
  spanName: string;
  modelProvider?: string;
  modelName?: string;
  modelRole?: string;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  estimatedCostUsd?: number | null;
  pricingKnown?: boolean;
}): void {
  const capture = getAgentEvalCapture();
  if (!capture) return;
  const estimatedCostUsd = input.estimatedCostUsd ?? null;
  capture.usage.llmSpans.push({
    spanName: input.spanName,
    modelProvider: input.modelProvider,
    modelName: input.modelName,
    modelRole: input.modelRole,
    inputTokens: input.inputTokens,
    outputTokens: input.outputTokens,
    totalTokens: input.totalTokens,
    estimatedCostUsd,
    pricingKnown: input.pricingKnown ?? estimatedCostUsd !== null,
  });
  capture.usage.totalInputTokens += input.inputTokens;
  capture.usage.totalOutputTokens += input.outputTokens;
  capture.usage.totalTokens += input.totalTokens;
  if (estimatedCostUsd === null || capture.usage.estimatedCostUsd === null) {
    capture.usage.estimatedCostUsd = null;
  } else {
    capture.usage.estimatedCostUsd = Number(
      (capture.usage.estimatedCostUsd + estimatedCostUsd).toFixed(8),
    );
  }
}

export function recordMemoryWriteSnapshot(
  patch: Partial<MemoryWriteEvalSnapshot>,
): void {
  const capture = getAgentEvalCapture();
  if (!capture) return;
  capture.memoryWrite = {
    ...capture.memoryWrite,
    ...patch,
    durableMemory: {
      ...capture.memoryWrite.durableMemory,
      ...patch.durableMemory,
    },
    sessionChunks: {
      ...capture.memoryWrite.sessionChunks,
      ...patch.sessionChunks,
    },
    structMem: {
      ...capture.memoryWrite.structMem,
      ...patch.structMem,
    },
  };
}

export function incrementDurableMemoryStatus(
  status: "written" | "deduplicated" | "below_threshold",
): void {
  const capture = getAgentEvalCapture();
  if (!capture) return;
  const durableMemory = { ...capture.memoryWrite.durableMemory };
  if (status === "written") durableMemory.written += 1;
  if (status === "deduplicated") durableMemory.deduplicated += 1;
  if (status === "below_threshold") durableMemory.belowThreshold += 1;
  recordMemoryWriteSnapshot({ durableMemory });
}

export function incrementSessionChunkWrite(status: "written" | "skipped"): void {
  const capture = getAgentEvalCapture();
  if (!capture) return;
  const sessionChunks = { ...capture.memoryWrite.sessionChunks };
  if (status === "written") sessionChunks.written += 1;
  if (status === "skipped") sessionChunks.skippedExisting += 1;
  recordMemoryWriteSnapshot({ sessionChunks });
}

export function buildAgentEvalOutput(input: {
  capture: AgentEvalCapture;
  reply: string;
  assistantMessageId?: string;
  turnIndex?: number;
  success: boolean;
  error?: string;
  cleanup: AgentEvalOutput["cleanup"];
}): AgentEvalOutput {
  return {
    scenarioId: input.capture.scenarioId,
    evalSessionId: input.capture.evalSessionId,
    reply: input.reply,
    assistantMessageId: input.assistantMessageId,
    turnIndex: input.turnIndex,
    mode: "agent_turn",
    success: input.success,
    ...(input.error ? { error: input.error } : {}),
    ...(input.capture.retrieval
      ? { retrieval: input.capture.retrieval }
      : {}),
    ...(input.capture.validation
      ? { validation: input.capture.validation }
      : {}),
    memoryWrite: input.capture.memoryWrite,
    usage: input.capture.usage,
    latencyMs: Date.now() - input.capture.startedAt,
    cleanup: input.cleanup,
  };
}

export const __testing = {
  emptySourceIds,
  emptyMemoryWrite,
  emptyUsage,
};

export { emptySourceIds as createEmptyEvalSourceIds };
