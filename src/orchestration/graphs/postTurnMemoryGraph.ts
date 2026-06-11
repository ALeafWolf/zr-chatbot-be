import { StateGraph, START, END } from '@langchain/langgraph';
import { env } from '../../config/env';
import { db } from '../../db/client';
import { postTurnJobs } from '../../db/schema/jobs';
import { eq } from 'drizzle-orm';
import type { ChatSession } from '../../db/schema/chat';
import { writeInteractiveMemory } from '../../memory/interactive/writeInteractiveMemory';
import type { MemoryNamespace } from '../../memory/shared/memoryNamespace';
import { writeStructMemTurn, type StructMemTurnWriteInput, type StructMemTurnWriteResult } from '../../memory/structmem/writeStructMemTurn';
import { maybeEnqueueStructMemConsolidation, type MaybeEnqueueStructMemConsolidationResult } from '../../memory/structmem/structmemConsolidationRepo';
import { collectPhase1StructMemPersistRows, type StructMemPersistRow } from '../../memory/structmem/structmemMapping';
import { persistSessionMemoryChunk, sessionMemoryChunkExists, writeRawTurnPairSessionChunkTraced, type SessionChunkTypePersisted, type WriteRawTurnChunkResult } from '../../memory/session/writeSessionMemoryChunk';
import { maybeCompactSessionSummary, type SessionSummaryCompactResult, type MaybeCompactSessionSummaryInput } from '../../memory/session/compactSessionSummary';
import { extractPostTurnSignals, type ExtractSignalsInput, type PostTurnSignals } from '../../llm/extraction/extractPostTurnSignals';
import { buildPostTurnWritePlan, type PostTurnWritePlan, type PostTurnWritePlanSession, type PostTurnWritePlanEnv, type PostTurnWritePlanSignals } from '../../jobs/postTurnPolicies';
import { isStepComplete, markStepCompleted, type PostTurnJobPayloadV1, type PostTurnStepName, type PostTurnStepStatus } from '../../jobs/postTurnJobPayload';
import { recordMemoryWriteSnapshot, incrementSessionChunkWrite } from '../../eval/evalSnapshots';
import type { MemoryWriteEvalSnapshot } from '../../eval/evalSnapshots';
import { PostTurnGraphStateSchema, type PostTurnGraphState, type PostTurnRetryReason } from '../graphState/postTurnGraphState';
import { advanceCharacterState } from '../../state/emotionalEngine/advanceCharacterState';
import { readAxisState, writeAxisState } from '../../state/emotionalEngine/axisStatePersistence';
import { loadCharacterDefaults } from '../../character/characterDefaults';
import { getSessionState } from '../../state/sessionStateRepo';
import { HISTORY_CAP, MAX_AXIS_DELTA_PER_UPDATE, EVENT_TO_DELTA_MAP } from '../../state/emotionalEngine/constants';
import { computeBands } from '../../state/emotionalEngine/bands';
import { resolveAxesConfigForScope } from '../../state/emotionalEngine/resolveAxesConfigForScope';
import type { CharacterStateAxes, AxesConfig, AxisName, Band, PersistedAxisState, TurnEvent } from '../../state/emotionalEngine/types';

export interface PostTurnMemoryGraphDeps {
  persistStepComplete: (jobId: string, step: PostTurnStepName, payload: PostTurnJobPayloadV1, stepStatus: PostTurnStepStatus) => Promise<PostTurnStepStatus>;
  completeJobFn: (jobId: string) => Promise<void>;
  writeRawFn: typeof writeRawTurnPairSessionChunkTraced;
  extractFn: typeof extractPostTurnSignals;
  buildWritePlanFn: typeof buildPostTurnWritePlan;
  writeStructMemFn: typeof writeStructMemTurn;
  enqueueConsolidationFn: typeof maybeEnqueueStructMemConsolidation;
  wakeConsolidationFn: () => void;
  sessionChunkExistsFn: typeof sessionMemoryChunkExists;
  persistSessionChunkFn: typeof persistSessionMemoryChunk;
  writeInteractiveMemoryFn: typeof writeInteractiveMemory;
  compactSummaryFn: typeof maybeCompactSessionSummary;
  recordSnapshotFn: typeof recordMemoryWriteSnapshot;
  collectPhase1StructMemRowsFn: typeof collectPhase1StructMemPersistRows;
  structmemNativeExtractor: boolean;
  structmemEnabled: boolean;
  /** TG3: Emotional engine advance function (injectable for tests). */
  advanceCharacterStateFn: typeof advanceCharacterState;
  /** TG3: Read persisted axis state from session row. */
  readAxisStateFn: typeof readAxisState;
  /** TG3: Write axis state to DB (merge-preserving). */
  writeAxisStateFn: typeof writeAxisState;
  /** TG3: Load character defaults (for emotional_axes config). */
  loadCharacterDefaultsFn: typeof loadCharacterDefaults;
  /** TG3: Read session state row from DB (for readAxisState). */
  getSessionStateFn: typeof getSessionState;
  /** TG3: Whether the emotional engine is enabled. */
  emotionalEngineEnabled: boolean;
}

// ---------------------------------------------------------------------------
// Retry-reason detection helpers (TG3)
// ---------------------------------------------------------------------------

function detectRetryReason(err: unknown, stage: string): PostTurnRetryReason | undefined {
  if (stage === 'extractPostTurnSignals') {
    if (err instanceof Error) {
      if (err.name === 'AbortError' || /timeout|aborted/i.test(err.message)) {
        return 'extractor_timeout';
      }
      if (err.name === 'ZodError' || err.name === 'SyntaxError' || err instanceof SyntaxError) {
        return 'extract_json_parse';
      }
    }
  }
  if (stage === 'writeStructMemTurn' || stage === 'writeSessionMemoryChunks' || stage === 'writeInteractiveMemory') {
    const code = (err as any)?.code;
    if (code === '23505' || code === '40P01') {
      return 'db_write_conflict';
    }
  }
  if (stage === 'maybeEnqueueStructMemConsolidation') {
    return 'consolidation_enqueue_failed';
  }
  return undefined;
}

function postTurnWritePlanEnv(): PostTurnWritePlanEnv {
  return {
    STRUCTMEM_ENABLED: env.STRUCTMEM_ENABLED,
    STRUCTMEM_CONSOLIDATION_ENABLED: env.STRUCTMEM_CONSOLIDATION_ENABLED,
    STRUCTMEM_SUPPRESS_EXTRACTOR_SESSION_CHUNKS: env.STRUCTMEM_SUPPRESS_EXTRACTOR_SESSION_CHUNKS,
    STRUCTMEM_NATIVE_EXTRACTOR: env.STRUCTMEM_NATIVE_EXTRACTOR,
  };
}

async function defaultPersistStepComplete(jobId: string, step: PostTurnStepName, payload: PostTurnJobPayloadV1, stepStatus: PostTurnStepStatus): Promise<PostTurnStepStatus> {
  const next = markStepCompleted(stepStatus, step);
  await db.update(postTurnJobs).set({ stepStatus: next, payload: payload as unknown as Record<string, unknown>, updatedAt: new Date() }).where(eq(postTurnJobs.id, jobId));
  return next;
}

async function defaultCompleteJob(jobId: string): Promise<void> {
  await db.update(postTurnJobs).set({ status: 'completed', lockedAt: null, lockedBy: null, updatedAt: new Date() }).where(eq(postTurnJobs.id, jobId));
}

export function defaultPostTurnMemoryGraphDeps(overrides?: Partial<PostTurnMemoryGraphDeps>): PostTurnMemoryGraphDeps {
  return {
    persistStepComplete: overrides?.persistStepComplete ?? defaultPersistStepComplete,
    completeJobFn: overrides?.completeJobFn ?? defaultCompleteJob,
    writeRawFn: overrides?.writeRawFn ?? writeRawTurnPairSessionChunkTraced,
    extractFn: overrides?.extractFn ?? extractPostTurnSignals,
    buildWritePlanFn: overrides?.buildWritePlanFn ?? buildPostTurnWritePlan,
    writeStructMemFn: overrides?.writeStructMemFn ?? writeStructMemTurn,
    enqueueConsolidationFn: overrides?.enqueueConsolidationFn ?? maybeEnqueueStructMemConsolidation,
    wakeConsolidationFn: overrides?.wakeConsolidationFn ?? (() => {}),
    sessionChunkExistsFn: overrides?.sessionChunkExistsFn ?? sessionMemoryChunkExists,
    persistSessionChunkFn: overrides?.persistSessionChunkFn ?? persistSessionMemoryChunk,
    writeInteractiveMemoryFn: overrides?.writeInteractiveMemoryFn ?? writeInteractiveMemory,
    compactSummaryFn: overrides?.compactSummaryFn ?? maybeCompactSessionSummary,
    recordSnapshotFn: overrides?.recordSnapshotFn ?? recordMemoryWriteSnapshot,
    collectPhase1StructMemRowsFn: overrides?.collectPhase1StructMemRowsFn ?? collectPhase1StructMemPersistRows,
    structmemNativeExtractor: overrides?.structmemNativeExtractor ?? env.STRUCTMEM_NATIVE_EXTRACTOR,
    structmemEnabled: overrides?.structmemEnabled ?? env.STRUCTMEM_ENABLED,
    advanceCharacterStateFn: overrides?.advanceCharacterStateFn ?? advanceCharacterState,
    readAxisStateFn: overrides?.readAxisStateFn ?? readAxisState,
    writeAxisStateFn: overrides?.writeAxisStateFn ?? writeAxisState,
    loadCharacterDefaultsFn: overrides?.loadCharacterDefaultsFn ?? loadCharacterDefaults,
    getSessionStateFn: overrides?.getSessionStateFn ?? getSessionState,
    emotionalEngineEnabled: overrides?.emotionalEngineEnabled ?? env.EMOTIONAL_ENGINE_ENABLED,
  };
}

export function createPostTurnMemoryGraph(deps: PostTurnMemoryGraphDeps = defaultPostTurnMemoryGraphDeps()) {
  async function writeRawTurnPairSessionChunkNode(state: PostTurnGraphState): Promise<Partial<PostTurnGraphState>> {
    if (isStepComplete(state.stepStatus, 'raw_chunk')) return {};
    try {
      await deps.writeRawFn({
        session: state.session as ChatSession,
        userTurnIndex: state.payload.userTurnIndex,
        assistantTurnIndex: state.payload.assistantTurnIndex,
        userMessage: state.payload.userMessage,
        assistantReply: state.payload.assistantReply,
      });
      const newStepStatus = await deps.persistStepComplete(state.jobId, 'raw_chunk', state.payload, state.stepStatus);
      return { stepStatus: newStepStatus, completedSteps: [...(state.completedSteps ?? []), 'raw_chunk'] };
    } catch (err) {
      return { errors: [{ stage: 'writeRawTurnPairSessionChunk', message: err instanceof Error ? err.message : String(err) }] };
    }
  }

  async function extractPostTurnSignalsNode(state: PostTurnGraphState): Promise<Partial<PostTurnGraphState>> {
    // Reuse payload.signals when present (e.g. from a prior partial run).
    // This avoids re-running the LLM call and preserves idempotency.
    if (state.payload.signals) return { signals: state.payload.signals };
    try {
      const signals = await deps.extractFn({
        userMessage: state.payload.userMessage,
        assistantReply: state.payload.assistantReply,
        sessionMode: (state.session as ChatSession).mode,
        recentMemories: state.recentMemoriesStr,
        sessionState: JSON.stringify(state.payload.derivedState),
      });
      deps.recordSnapshotFn({
        extraction: { memoryFactCount: signals.memoryFacts.length, structMemEntryCount: signals.structMemEntries.length, shouldWriteMemory: state.payload.shouldWriteMemory },
      });
      const newStepStatus = await deps.persistStepComplete(state.jobId, 'extract_signals', { ...state.payload, signals }, state.stepStatus);
      return { signals, stepStatus: newStepStatus, completedSteps: [...(state.completedSteps ?? []), 'extract_signals'] };
    } catch (err) {
      return { errors: [{ stage: 'extractPostTurnSignals', message: err instanceof Error ? err.message : String(err) }], lastRetryReason: detectRetryReason(err, 'extractPostTurnSignals') };
    }
  }

  async function applyEngineStateNode(state: PostTurnGraphState): Promise<Partial<PostTurnGraphState>> {
    // Skip if already completed on a prior retry
    if (isStepComplete(state.stepStatus, 'engine_state')) return {};

    // Gate: flag off → skip (mark complete, no-op)
    if (!deps.emotionalEngineEnabled) {
      const newStepStatus = await deps.persistStepComplete(state.jobId, 'engine_state', state.payload, state.stepStatus);
      return { stepStatus: newStepStatus, completedSteps: [...(state.completedSteps ?? []), 'engine_state'] };
    }

    const signals = state.signals ?? state.payload.signals;
    if (!signals) return {};

    const session = state.session as ChatSession;

    try {
      // Load axis config from character defaults
      const defaults = deps.loadCharacterDefaultsFn(session.characterId);
      // Resolve scope-aware config (D8): overrides baseline per continuityScope
      const scope = (session as ChatSession).continuityScope;
      const axesConfig = resolveAxesConfigForScope(
        defaults.emotional_axes!,
        defaults.emotional_axes_baseline_by_scope,
        scope,
      );

      // F2: character without emotional_axes → no-op (mark complete)
      if (!defaults.emotional_axes) {
        const newStepStatus = await deps.persistStepComplete(state.jobId, 'engine_state', state.payload, state.stepStatus);
        return { stepStatus: newStepStatus, completedSteps: [...(state.completedSteps ?? []), 'engine_state'] };
      }

      // Read persisted axis state (null = first tick → init from baselines)
      const row = await deps.getSessionStateFn(session.sessionId);
      const persisted = deps.readAxisStateFn(row);

      const tick = state.payload.assistantTurnIndex;

      let currentState: CharacterStateAxes;
      let currentBands: Record<AxisName, Band>;
      let currentHistory: PersistedAxisState['history'];
      let persistedTrace: PersistedAxisState['lastTrace'];

      if (persisted) {
        currentState = persisted.axes;
        currentBands = persisted.bands;
        currentHistory = persisted.history;
        persistedTrace = persisted.lastTrace;
      } else {
        // First tick: init from baselines
        currentState = {
          connection: axesConfig.connection.baseline,
          valence: axesConfig.valence.baseline,
          arousal: axesConfig.arousal.baseline,
          restraint: axesConfig.restraint.baseline,
        };
        currentBands = { connection: 'mid', valence: 'mid', arousal: 'mid', restraint: 'mid' };
        currentHistory = [];
        persistedTrace = {
          tick: 0,
          axesBefore: { ...currentState },
          axesAfter: { ...currentState },
          couplingsFired: [],
          effectiveBaselines: {},
        };
      }

      // Event deltas: map TurnEvent through event-to-delta table, or empty (drift-only on extraction failure)
      const event = signals.turnEvent;
      const eventDeltas: Partial<CharacterStateAxes> = event
        ? mapEventToDeltas(event)
        : {};

      // Advance state with parsed character couplings (TG6)
      const { next, trace } = deps.advanceCharacterStateFn(
        currentState,
        axesConfig,
        defaults.emotional_coupling ?? [],
        eventDeltas,
        tick,
        event ?? undefined,
      );

      // Compute bands with hysteresis, seeded from persisted previous bands
      const previousBands: Record<AxisName, Band> = persisted?.bands ?? {
        connection: 'mid', valence: 'mid', arousal: 'mid', restraint: 'mid',
      };
      const bands = computeBands(next, previousBands);

      // Append to history
      const historyEntry = { tick, axes: { ...next } };
      const updatedHistory = [...currentHistory, historyEntry];

      // Build persisted state
      const nextPersisted: PersistedAxisState = {
        version: 1 as const,
        tick,
        axes: { ...next },
        lastTrace: trace,
        bands,
        history: updatedHistory,
      };

      // Write to DB
      await deps.writeAxisStateFn(session.sessionId, nextPersisted);

      // Observability snapshot
      deps.recordSnapshotFn({
        engineState: {
          axesBefore: trace.axesBefore,
          axesAfter: trace.axesAfter,
          couplingsFired: trace.couplingsFired,
          tick,
        },
      });

      const newStepStatus = await deps.persistStepComplete(state.jobId, 'engine_state', state.payload, state.stepStatus);
      return { stepStatus: newStepStatus, completedSteps: [...(state.completedSteps ?? []), 'engine_state'] };
    } catch (err) {
      // Catch + log; never fail the job for axis-state problems
      console.error(`[applyEngineState] Error advancing character state: ${(err as Error).message}`);
      // Mark complete to avoid retry loops — degradation is safe (drift-only next tick)
      const newStepStatus = await deps.persistStepComplete(state.jobId, 'engine_state', state.payload, state.stepStatus);
      return { stepStatus: newStepStatus, completedSteps: [...(state.completedSteps ?? []), 'engine_state'] };
    }
  }

  async function buildWritePlanNode(state: PostTurnGraphState): Promise<Partial<PostTurnGraphState>> {
    const signals = state.signals ?? state.payload.signals;
    if (!signals) return { errors: [{ stage: 'buildWritePlan', message: 'post-turn payload missing extracted signals' }] };
    try {
      const writePlan = deps.buildWritePlanFn(state.session as PostTurnWritePlanSession, postTurnWritePlanEnv(), {
        memoryFacts: signals.memoryFacts,
        structMemEntries: signals.structMemEntries,
        shouldWriteMemory: state.payload.shouldWriteMemory,
      });
      deps.recordSnapshotFn({
        writePlan: { durableMemory: writePlan.durableMemory.write, sessionChunks: writePlan.sessionChunks.write, structMem: writePlan.structMem.write, structMemConsolidation: writePlan.structMemConsolidation.write },
      });
      return { writePlan };
    } catch (err) {
      return { errors: [{ stage: 'buildWritePlan', message: err instanceof Error ? err.message : String(err) }] };
    }
  }

  async function writeStructMemTurnNode(state: PostTurnGraphState): Promise<Partial<PostTurnGraphState>> {
    if (isStepComplete(state.stepStatus, 'structmem')) return {};
    if (!state.writePlan?.structMem.write) {
      const newStepStatus = await deps.persistStepComplete(state.jobId, 'structmem', state.payload, state.stepStatus);
      return { stepStatus: newStepStatus };
    }
    const signals = state.signals ?? state.payload.signals;
    if (!signals) return {};
    try {
      const useNative = deps.structmemNativeExtractor;
      const rows: StructMemPersistRow[] = useNative ? (signals.structMemEntries as unknown as StructMemPersistRow[]) : deps.collectPhase1StructMemRowsFn(signals.memoryFacts);
      if (rows.length > 0) {
        await deps.writeStructMemFn({
          session: state.session as ChatSession,
          latestTurnIndex: state.payload.assistantTurnIndex,
          userMessageId: state.payload.userMessageId,
          assistantMessageId: state.payload.assistantMessageId,
          rows,
          extractorBatchConfidence: signals.modelReportedConfidence.memoryFacts,
          mergeNativeStructMemSource: useNative,
        });
      }
      const newStepStatus = await deps.persistStepComplete(state.jobId, 'structmem', state.payload, state.stepStatus);
      return { stepStatus: newStepStatus, completedSteps: [...(state.completedSteps ?? []), 'structmem'] };
    } catch (err) {
      return { errors: [{ stage: 'writeStructMemTurn', message: err instanceof Error ? err.message : String(err) }], lastRetryReason: detectRetryReason(err, 'writeStructMemTurn') };
    }
  }

  async function maybeEnqueueStructMemConsolidationNode(state: PostTurnGraphState): Promise<Partial<PostTurnGraphState>> {
    if (!state.writePlan?.structMemConsolidation.write) return { consolidationEnqueued: false };
    try {
      const result = await deps.enqueueConsolidationFn({ session: state.session as ChatSession });
      if (result.status === 'enqueued') deps.wakeConsolidationFn();
      return { consolidationEnqueued: result.status === 'enqueued' };
    } catch (err) {
      return { errors: [{ stage: 'maybeEnqueueStructMemConsolidation', message: err instanceof Error ? err.message : String(err) }], lastRetryReason: detectRetryReason(err, 'maybeEnqueueStructMemConsolidation') };
    }
  }

  async function writeSessionMemoryChunksNode(state: PostTurnGraphState): Promise<Partial<PostTurnGraphState>> {
    if (isStepComplete(state.stepStatus, 'session_chunks')) return {};
    if (!state.writePlan?.sessionChunks.write) {
      const newStepStatus = await deps.persistStepComplete(state.jobId, 'session_chunks', state.payload, state.stepStatus);
      return { stepStatus: newStepStatus };
    }
    const signals = state.signals ?? state.payload.signals;
    if (!signals) return {};
    try {
      for (let i = 0; i < signals.memoryFacts.length; i++) {
        const candidate = signals.memoryFacts[i];
        if (!candidate || candidate.memoryScope !== 'current_session') continue;
        const chunkType = (candidate.sessionChunkType ?? 'scene_moment') as SessionChunkTypePersisted;
        const metadata = { source: 'extractor', memoryType: candidate.memoryType, assistantMessageId: state.payload.assistantMessageId, candidateIndex: i };
        const exists = await deps.sessionChunkExistsFn({
          sessionId: state.payload.sessionId,
          turnStart: state.payload.userTurnIndex,
          turnEnd: state.payload.assistantTurnIndex,
          chunkType,
          metadataContains: { assistantMessageId: state.payload.assistantMessageId, candidateIndex: i },
        });
        if (exists) {
          incrementSessionChunkWrite('skipped');
          continue;
        }
        await deps.persistSessionChunkFn({
          sessionId: state.payload.sessionId,
          characterId: (state.session as ChatSession).characterId,
          playerId: (state.session as ChatSession).playerId,
          turnStart: state.payload.userTurnIndex,
          turnEnd: state.payload.assistantTurnIndex,
          chunkText: candidate.summary,
          chunkType,
          metadata,
          embedding: candidate.embedding,
        });
      }
      const newStepStatus = await deps.persistStepComplete(state.jobId, 'session_chunks', state.payload, state.stepStatus);
      return { stepStatus: newStepStatus, completedSteps: [...(state.completedSteps ?? []), 'session_chunks'] };
    } catch (err) {
      return { errors: [{ stage: 'writeSessionMemoryChunks', message: err instanceof Error ? err.message : String(err) }], lastRetryReason: detectRetryReason(err, 'writeSessionMemoryChunks') };
    }
  }

  async function writeInteractiveMemoryNode(state: PostTurnGraphState): Promise<Partial<PostTurnGraphState>> {
    if (isStepComplete(state.stepStatus, 'durable_memory')) return {};
    if (!state.writePlan?.durableMemory.write) {
      const newStepStatus = await deps.persistStepComplete(state.jobId, 'durable_memory', state.payload, state.stepStatus);
      return { stepStatus: newStepStatus };
    }
    const signals = state.signals ?? state.payload.signals;
    if (!signals) return {};
    try {
      for (const candidate of signals.memoryFacts) {
        if (candidate.memoryScope !== 'cross_session') continue;
        await deps.writeInteractiveMemoryFn({
          candidate,
          characterId: (state.session as ChatSession).characterId,
          playerId: (state.session as ChatSession).playerId,
          sessionId: state.payload.sessionId,
          continuityScope: (state.session as ChatSession).continuityScope,
          continuityFamily: (state.session as ChatSession).continuityFamily as 'main_world' | 'au',
          memoryNamespace: (state.session as ChatSession).memoryNamespace as MemoryNamespace,
        });
      }
      const newStepStatus = await deps.persistStepComplete(state.jobId, 'durable_memory', state.payload, state.stepStatus);
      return { stepStatus: newStepStatus, completedSteps: [...(state.completedSteps ?? []), 'durable_memory'] };
    } catch (err) {
      return { errors: [{ stage: 'writeInteractiveMemory', message: err instanceof Error ? err.message : String(err) }], lastRetryReason: detectRetryReason(err, 'writeInteractiveMemory') };
    }
  }

  async function maybeCompactSessionSummaryNode(state: PostTurnGraphState): Promise<Partial<PostTurnGraphState>> {
    if (isStepComplete(state.stepStatus, 'summary_compact')) return {};
    try {
      const summaryResult = await deps.compactSummaryFn({ session: state.session as ChatSession, latestTurnIndex: state.payload.assistantTurnIndex });
      deps.recordSnapshotFn({
        summaryCompaction: {
          status: summaryResult.status,
          ...('reason' in summaryResult ? { reason: summaryResult.reason } : {}),
          ...('lastSummarizedTurnIndex' in summaryResult ? { lastSummarizedTurnIndex: summaryResult.lastSummarizedTurnIndex } : {}),
        },
      });
      const newStepStatus = await deps.persistStepComplete(state.jobId, 'summary_compact', state.payload, state.stepStatus);
      return { stepStatus: newStepStatus, completedSteps: [...(state.completedSteps ?? []), 'summary_compact'] };
    } catch (err) {
      return { errors: [{ stage: 'maybeCompactSessionSummary', message: err instanceof Error ? err.message : String(err) }] };
    }
  }

  async function markJobCompleteNode(state: PostTurnGraphState): Promise<Partial<PostTurnGraphState>> {
    try {
      await deps.completeJobFn(state.jobId);
      deps.recordSnapshotFn({ status: 'completed' });
      return {};
    } catch (err) {
      return { errors: [{ stage: 'markJobComplete', message: err instanceof Error ? err.message : String(err) }] };
    }
  }

  // ---- Error sink + conditional routing -----------------------------------

  function errorSinkNode(): Partial<PostTurnGraphState> {
    return {};
  }

  function hasErrors(state: PostTurnGraphState): string {
    if (state.errors && state.errors.length > 0) return '__error__';
    return '__next__';
  }

  // ---- Graph construction --------------------------------------------------

  return new StateGraph(PostTurnGraphStateSchema)
    .addNode('writeRawTurnPairSessionChunk', writeRawTurnPairSessionChunkNode)
    .addNode('extractPostTurnSignals', extractPostTurnSignalsNode)
    .addNode('applyEngineState', applyEngineStateNode)
    .addNode('buildWritePlan', buildWritePlanNode)
    .addNode('writeStructMemTurn', writeStructMemTurnNode)
    .addNode('maybeEnqueueStructMemConsolidation', maybeEnqueueStructMemConsolidationNode)
    .addNode('writeSessionMemoryChunks', writeSessionMemoryChunksNode)
    .addNode('writeInteractiveMemory', writeInteractiveMemoryNode)
    .addNode('maybeCompactSessionSummary', maybeCompactSessionSummaryNode)
    .addNode('markJobComplete', markJobCompleteNode)
    .addNode('errorSink', errorSinkNode)
    .addConditionalEdges(START, hasErrors, {
      __error__: 'errorSink',
      __next__: 'writeRawTurnPairSessionChunk',
    })
    .addConditionalEdges('writeRawTurnPairSessionChunk', hasErrors, {
      __error__: 'errorSink',
      __next__: 'extractPostTurnSignals',
    })
    .addConditionalEdges('extractPostTurnSignals', hasErrors, {
      __error__: 'errorSink',
      __next__: 'applyEngineState',
    })
    .addConditionalEdges('applyEngineState', hasErrors, {
      __error__: 'errorSink',
      __next__: 'buildWritePlan',
    })
    .addConditionalEdges('buildWritePlan', hasErrors, {
      __error__: 'errorSink',
      __next__: 'writeStructMemTurn',
    })
    .addConditionalEdges('writeStructMemTurn', hasErrors, {
      __error__: 'errorSink',
      __next__: 'maybeEnqueueStructMemConsolidation',
    })
    .addConditionalEdges('maybeEnqueueStructMemConsolidation', hasErrors, {
      __error__: 'errorSink',
      __next__: 'writeSessionMemoryChunks',
    })
    .addConditionalEdges('writeSessionMemoryChunks', hasErrors, {
      __error__: 'errorSink',
      __next__: 'writeInteractiveMemory',
    })
    .addConditionalEdges('writeInteractiveMemory', hasErrors, {
      __error__: 'errorSink',
      __next__: 'maybeCompactSessionSummary',
    })
    .addConditionalEdges('maybeCompactSessionSummary', hasErrors, {
      __error__: 'errorSink',
      __next__: 'markJobComplete',
    })
    .addEdge('markJobComplete', END)
    .addEdge('errorSink', END)
    .compile({ name: 'orchestration.post_turn_memory_graph' });
}

let _postTurnMemoryGraph: ReturnType<typeof createPostTurnMemoryGraph> | undefined;

export function getPostTurnMemoryGraph(): ReturnType<typeof createPostTurnMemoryGraph> {
  if (!_postTurnMemoryGraph) {
    _postTurnMemoryGraph = createPostTurnMemoryGraph();
  }
  return _postTurnMemoryGraph;
}

// ---------------------------------------------------------------------------
// Event-to-delta mapping helper (Step 3 — replaces interim flat-delta path)
// ---------------------------------------------------------------------------

/**
 * Map a classified TurnEvent to axis deltas using the deterministic
 * event-to-delta mapping table, scaled by intensity and clamped to
 * ±MAX_AXIS_DELTA_PER_UPDATE.
 *
 * @param event - The classified turn event.
 * @returns Clamped axis deltas to pass into advanceCharacterState Phase 1.
 */
export function mapEventToDeltas(event: TurnEvent): Partial<CharacterStateAxes> {
  const base = EVENT_TO_DELTA_MAP[event.type] ?? {};
  const out: Partial<CharacterStateAxes> = {};

  const axes: (keyof CharacterStateAxes)[] = ['connection', 'valence', 'arousal', 'restraint'];
  for (const axis of axes) {
    const baseDelta = base[axis];
    if (baseDelta === undefined) continue;
    const scaled = baseDelta * event.intensity;
    out[axis] = Math.min(
      MAX_AXIS_DELTA_PER_UPDATE,
      Math.max(-MAX_AXIS_DELTA_PER_UPDATE, Number.isFinite(scaled) ? scaled : 0),
    );
  }

  return out;
}
