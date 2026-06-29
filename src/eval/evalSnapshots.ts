import { AsyncLocalStorage } from "node:async_hooks";
import type { AxisName, Band, CharacterStateAxes } from "../state/emotionalEngine/types";

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
  /** TG3: Emotional engine state after a post-turn advance tick. */
  engineState?: {
    axesBefore: unknown;
    axesAfter: unknown;
    couplingsFired: string[];
    tick: number;
  };
  summaryCompaction?: {
    status: string;
    reason?: string;
    lastSummarizedTurnIndex?: number;
  };
}

/**
 * TG1: Dedicated emotional-axis eval snapshot capturing both the update-side
 * (post-turn engine advance) and render-side (foreground prompt building) data.
 * Rule IDs (`renderRuleIds`) may be absent until TG2.
 */
export interface EmotionalAxisEvalSnapshot {
  /** Update-side: classified TurnEvent from the post-turn extractor. */
  event?: { type: string; intensity: number; reason: string };
  /** Update-side: model-reported confidence for turnEvent parse presence. */
  modelReportedConfidence?: number;
  /** Update-side: axes state before the engine tick. */
  axesBefore?: CharacterStateAxes;
  /** Update-side: event deltas applied this tick (clamped). */
  eventDeltas?: Partial<CharacterStateAxes>;
  /** Update-side: coupling ids whose effect was non-zero this tick. */
  couplingsFired?: string[];
  /** Update-side: shifted effective baselines after baseline_shift couplings. */
  effectiveBaselines?: Partial<CharacterStateAxes>;
  /** Update-side: condition transitions detected this tick. */
  conditionTransitions?: Array<{ id: string; from: boolean; to: boolean }>;
  /** Update-side: axes state after the full engine tick. */
  axesAfter?: CharacterStateAxes;
  /** Update-side: band labels computed after the engine tick. */
  bandsAfter?: Record<AxisName, Band>;
  /** Update-side: tick number when this update was computed. */
  tick?: number;
  /** Update-side: continuityScope used during the engine tick. */
  scope?: string;
  /** Update-side: scope-resolved baselines used this tick. */
  resolvedBaselines?: CharacterStateAxes;

  /** Render-side: source of the render input data. */
  render?: {
    source: "persisted_axis_state" | "scope_baseline_synthetic";
    sourceTick: number;
    bands: Record<AxisName, Band>;
    /** Rule IDs matched during render select; empty until TG2. */
    renderRuleIds: string[];
    /** The final render block text injected into the system prompt. */
    renderBlock: string | null;
    /** Render tier used when building the render block. */
    tier: "A" | "B" | "C";
    /** Scope-resolved baselines used by the resolver at render time. */
    resolvedBaselines: CharacterStateAxes;
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
  /** TG1: Dedicated emotional-axis eval snapshot. */
  emotionalAxis?: EmotionalAxisEvalSnapshot;
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
  /** TG1: Dedicated emotional-axis eval snapshot (built incrementally). */
  emotionalAxis?: EmotionalAxisEvalSnapshot;
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

/**
 * TG1: Record (merge) an emotional-axis update snapshot onto the current capture.
 * Only fields provided in `patch` are set; existing fields are preserved.
 * This is safe to call from the post-turn engine node after `computeEngineAdvance`.
 */
export function recordEmotionalAxisUpdateSnapshot(
  patch: EmotionalAxisEvalSnapshot,
): void {
  const capture = getAgentEvalCapture();
  if (!capture) return;
  capture.emotionalAxis = {
    ...patch,
    render: capture.emotionalAxis?.render,
  };
}

/**
 * TG1: Record (merge) an emotional-axis render snapshot onto the current capture.
 * Only the `render` sub-object is set; existing update-side fields are preserved.
 * Safe to call from the foreground prompt-building path.
 *
 * This function does NOT fabricate update-side fields — if only a render snapshot
 * has been captured, `axesBefore`/`axesAfter`/etc. remain undefined.
 */
export function recordEmotionalAxisRenderSnapshot(
  render: EmotionalAxisEvalSnapshot["render"],
): void {
  const capture = getAgentEvalCapture();
  if (!capture) return;
  capture.emotionalAxis = {
    ...(capture.emotionalAxis ?? {} as EmotionalAxisEvalSnapshot),
    render,
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
    ...(input.capture.emotionalAxis
      ? { emotionalAxis: input.capture.emotionalAxis }
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
