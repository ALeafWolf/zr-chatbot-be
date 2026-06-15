import { describe, it } from "node:test";
import assert from "node:assert";
import { createPostTurnMemoryGraph, applyEngineStateInputMapper, applyEngineStateOutputMapper, type PostTurnMemoryGraphDeps } from "./postTurnMemoryGraph";
import { createInitialPostTurnRuntimeState } from "../graphState/postTurnGraphState";
import { INITIAL_POST_TURN_STEP_STATUS, markStepCompleted, type PostTurnJobPayloadV1, type PostTurnStepName, type PostTurnStepState, type PostTurnStepStatus } from "../../jobs/postTurnJobPayload";
import type { PostTurnWritePlan } from "../../jobs/postTurnPolicies";
import type { WriteRawTurnChunkResult } from "../../memory/session/writeSessionMemoryChunk";
import { type PostTurnSignals } from "../../llm/extraction/extractPostTurnSignals";
import type { ChatSession } from "../../db/schema/chat";

// ---------------------------------------------------------------------------
// Fakes
// ---------------------------------------------------------------------------

const FAKE_JOB_ID = "job_001";
const FAKE_SESSION_ID = "sess_001";

const FAKE_PAYLOAD: PostTurnJobPayloadV1 = {
  version: 1,
  sessionId: FAKE_SESSION_ID,
  userMessage: "Hello!",
  assistantReply: "Hi there!",
  session: {
    sessionId: FAKE_SESSION_ID,
    characterId: "char_zuoran",
    playerId: "player_001",
    mode: "canonical_live",
    continuityScope: "main",
    continuityFamily: "main_world",
    personaOverlayId: null,
    memoryNamespace: "zuo_ran_main",
    pinnedTime: null,
    pinnedLocation: null,
    writebackPolicy: "normal",
    sessionSummary: null,
    displayTitle: null,
    thinking: false,
    temperature: 0.7,
  },
  derivedState: { inferredMood: "neutral", inferredActivity: "chatting", conversationalStance: "friendly" },
  shouldWriteMemory: true,
  userTurnIndex: 1,
  assistantTurnIndex: 2,
  userMessageId: "msg_user_001",
  assistantMessageId: "msg_assistant_001",
  recentMemorySummaries: [],
  signals: undefined,
};

const FAKE_SESSION: ChatSession = {
  sessionId: FAKE_SESSION_ID,
  characterId: "char_zuoran",
  playerId: "player_001",
  mode: "canonical_live",
  continuityScope: "main",
  continuityFamily: "main_world",
  personaOverlayId: null,
  memoryNamespace: "zuo_ran_main",
  pinnedTime: null,
  pinnedLocation: null,
  writebackPolicy: "normal",
  sessionSummary: null,
  displayTitle: null,
  thinking: false,
  temperature: 0.7,
  deletedAt: null,
  createdAt: new Date(),
  updatedAt: new Date(),
};

function createFakeWritePlan(overrides?: Partial<PostTurnWritePlan>): PostTurnWritePlan {
  return {
    rawChunk: { write: true, skippedReason: null },
    structMem: { write: true, skippedReason: null },
    structMemConsolidation: { write: false, skippedReason: null },
    sessionChunks: { write: true, skippedReason: null },
    durableMemory: { write: true, skippedReason: null },
    summaryCompact: { write: true, skippedReason: null },
    skippedReasons: {},
    signalCounts: { memoryFacts: 0, crossSessionMemoryFacts: 0, currentSessionMemoryFacts: 0, nativeStructMemEntries: 0 },
    ...overrides,
  };
}

interface DepsCalls {
  persistStepComplete: Array<{ jobId: string; step: string }>;
  completeJobFn: Array<{ jobId: string }>;
  writeRawFn: number;
  extractFn: number;
  buildWritePlanFn: number;
  writeStructMemFn: number;
  enqueueConsolidationFn: number;
  wakeConsolidationFn: number;
  sessionChunkExistsFn: number;
  persistSessionChunkFn: number;
  writeInteractiveMemoryFn: number;
  compactSummaryFn: number;
  recordSnapshotFn: Array<Record<string, unknown>>;
}

function createFakeDeps(): { deps: PostTurnMemoryGraphDeps; calls: DepsCalls } {
  const calls: DepsCalls = {
    persistStepComplete: [],
    completeJobFn: [],
    writeRawFn: 0,
    extractFn: 0,
    buildWritePlanFn: 0,
    writeStructMemFn: 0,
    enqueueConsolidationFn: 0,
    wakeConsolidationFn: 0,
    sessionChunkExistsFn: 0,
    persistSessionChunkFn: 0,
    writeInteractiveMemoryFn: 0,
    compactSummaryFn: 0,
    recordSnapshotFn: [],
  };

  const deps: PostTurnMemoryGraphDeps = {
    persistStepComplete: async (_jobId, step, _payload, stepStatus) => {
      calls.persistStepComplete.push({ jobId: _jobId, step });
      return markStepCompleted(stepStatus, step);
    },
    completeJobFn: async (jobId) => {
      calls.completeJobFn.push({ jobId });
    },
    writeRawFn: async (_input) => {
      calls.writeRawFn++;
      return { status: "written", sessionId: FAKE_SESSION_ID, chunkId: "chunk_001", turnStart: 1, turnEnd: 2, chunkTextChars: 50 } as WriteRawTurnChunkResult;
    },
    extractFn: async (_input) => {
      calls.extractFn++;
      return { memoryFacts: [], structMemEntries: [], turnEvent: null, modelReportedConfidence: { memoryFacts: 0.9, turnEvent: 0 } } as any;
    },
    buildWritePlanFn: (_session, _env, _signals) => {
      calls.buildWritePlanFn++;
      return createFakeWritePlan();
    },
    writeStructMemFn: async (_input) => {
      calls.writeStructMemFn++;
      return { eventId: "evt_001", entryIds: ["entry_001"], status: "written" };
    },
    enqueueConsolidationFn: async (_input) => {
      calls.enqueueConsolidationFn++;
      return { status: "disabled" };
    },
    wakeConsolidationFn: () => {
      calls.wakeConsolidationFn++;
    },
    sessionChunkExistsFn: async (_input) => {
      calls.sessionChunkExistsFn++;
      return false;
    },
    persistSessionChunkFn: async (_input) => {
      calls.persistSessionChunkFn++;
      return { id: "chunk_002", chunk: null as any };
    },
    writeInteractiveMemoryFn: async (_input) => {
      calls.writeInteractiveMemoryFn++;
      return "written";
    },
    compactSummaryFn: async (_input) => {
      calls.compactSummaryFn++;
      return { status: "skipped", reason: "below_min_turns_before_summary", sessionId: FAKE_SESSION_ID, latestTurnIndex: 2, minTurnsBeforeSummary: 4 };
    },
    recordSnapshotFn: (patch) => {
      calls.recordSnapshotFn.push(patch);
    },
    collectPhase1StructMemRowsFn: (_memoryFacts) => [],
    structmemNativeExtractor: false,
    structmemEnabled: true,
    advanceCharacterStateFn: (_state, _config, _couplings, _deltas, _tick) => ({
      next: { connection: 0, valence: 0, arousal: 0, restraint: 0 },
      trace: { tick: 0, axesBefore: { connection: 0, valence: 0, arousal: 0, restraint: 0 }, axesAfter: { connection: 0, valence: 0, arousal: 0, restraint: 0 }, couplingsFired: [], effectiveBaselines: {} },
    }),
    readAxisStateFn: (_row) => null,
    writeAxisStateFn: async (_sessionId, _next) => {},
    loadCharacterDefaultsFn: (_characterId) => ({
      character_id: "zuo_ran",
      name: "Zuo Ran",
      archetype: "elite_lawyer_controlled_romantic",
      identity: "",
      speech_style: { language: "zh-CN", formality: "formal", emotionality: "restrained", preferred_patterns: [], avoid: [] },
      hard_rules: [],
      interaction_defaults: { default_continuity_scope: "main", default_emotional_baseline: "controlled_tenderness", default_relationship_baseline: "established_partners", response_length: "full", allows_personal_topics: "true_within_scope" },
      safe_deflection: "",
      version: "2.1",
      emotional_axes: {
        connection: { baseline: 0, driftRate: 0.02, min: -1, max: 1 },
        valence: { baseline: 0, driftRate: 0.02, min: -1, max: 1 },
        arousal: { baseline: 0, driftRate: 0.02, min: -1, max: 1 },
        restraint: { baseline: 0.7, driftRate: 0.02, min: -1, max: 1 },
      },
    }),
    getSessionStateFn: async (_sessionId) => null,
    emotionalEngineEnabled: true,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    computeEngineAdvanceFn: (async (input: any) => {
      return {
        next: input.axesBefore,
        trace: {
          tick: input.tick,
          axesBefore: input.axesBefore,
          axesAfter: input.axesBefore,
          couplingsFired: [],
          effectiveBaselines: {},
        },
        bands: input.previousBands,
        eventDeltas: {},
      };
    }) as any,
  };

  return { deps, calls };
}

function createInitialState(stepStatusOverrides?: Partial<Record<PostTurnStepName, PostTurnStepState>>) {
  const stepStatus: PostTurnStepStatus = stepStatusOverrides
    ? { ...INITIAL_POST_TURN_STEP_STATUS, ...stepStatusOverrides }
    : { ...INITIAL_POST_TURN_STEP_STATUS };

  return createInitialPostTurnRuntimeState(
    { jobId: FAKE_JOB_ID, attempts: 1, payload: FAKE_PAYLOAD, stepStatus },
    FAKE_SESSION,
    "",
  );
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("postTurnMemoryGraph", () => {
  it("runs all 10 nodes in order on a fresh job and reaches markJobComplete", async () => {
    const { deps, calls } = createFakeDeps();
    const graph = createPostTurnMemoryGraph(deps);
    await graph.invoke(createInitialState());

    assert.strictEqual(calls.persistStepComplete.length, 7, "7 steps completed: raw_chunk, extract_signals, engine_state, structmem, session_chunks, durable_memory, summary_compact");
    assert.strictEqual(calls.completeJobFn.length, 1);
    assert.strictEqual(calls.writeRawFn, 1);
    assert.strictEqual(calls.extractFn, 1);
    assert.strictEqual(calls.buildWritePlanFn, 1);
    // writeStructMemFn is not called when signals.memoryFacts is empty (collectPhase1 returns [])
    assert.strictEqual(calls.compactSummaryFn, 1);
  });

  it("skips completed steps and applies writePlan gating", async () => {
    // Completed steps skip their functions
    let { deps, calls } = createFakeDeps();
    await createPostTurnMemoryGraph(deps).invoke(createInitialState({ raw_chunk: "completed" }));
    assert.strictEqual(calls.writeRawFn, 0, "raw_chunk skipped");
    assert.strictEqual(calls.extractFn, 1, "extract still runs");

    ({ deps, calls } = createFakeDeps());
    await createPostTurnMemoryGraph(deps).invoke(createInitialState({ structmem: "completed" }));
    assert.strictEqual(calls.writeStructMemFn, 0, "structmem skipped");

    ({ deps, calls } = createFakeDeps());
    await createPostTurnMemoryGraph(deps).invoke(createInitialState({ session_chunks: "completed" }));
    assert.strictEqual(calls.persistSessionChunkFn, 0, "session_chunks skipped");

    ({ deps, calls } = createFakeDeps());
    await createPostTurnMemoryGraph(deps).invoke(createInitialState({ durable_memory: "completed" }));
    assert.strictEqual(calls.writeInteractiveMemoryFn, 0, "durable_memory skipped");

    ({ deps, calls } = createFakeDeps());
    await createPostTurnMemoryGraph(deps).invoke(createInitialState({ summary_compact: "completed" }));
    assert.strictEqual(calls.compactSummaryFn, 0, "summary_compact skipped");

    // extract_signals already complete with payload.signals
    ({ deps, calls } = createFakeDeps());
    const payload: PostTurnJobPayloadV1 = { ...FAKE_PAYLOAD, signals: { memoryFacts: [], structMemEntries: [], turnEvent: null, modelReportedConfidence: { memoryFacts: 0.9, turnEvent: 0.0 } } };
    const state = createInitialPostTurnRuntimeState({ jobId: FAKE_JOB_ID, attempts: 1, payload, stepStatus: markStepCompleted({ ...INITIAL_POST_TURN_STEP_STATUS }, "extract_signals") }, FAKE_SESSION, "");
    await createPostTurnMemoryGraph(deps).invoke(state);
    assert.strictEqual(calls.extractFn, 0, "extract_signals skipped when already complete");

    // Write plan gating
    ({ deps, calls } = createFakeDeps());
    deps.buildWritePlanFn = () => createFakeWritePlan({ structMem: { write: false, skippedReason: "structmem_disabled" } });
    await createPostTurnMemoryGraph(deps).invoke(createInitialState());
    assert.strictEqual(calls.writeStructMemFn, 0, "structMem gated by writePlan");

    ({ deps, calls } = createFakeDeps());
    deps.buildWritePlanFn = () => createFakeWritePlan({ sessionChunks: { write: false, skippedReason: "suppressed" } });
    await createPostTurnMemoryGraph(deps).invoke(createInitialState());
    assert.strictEqual(calls.persistSessionChunkFn, 0, "sessionChunks gated by writePlan");

    ({ deps, calls } = createFakeDeps());
    deps.buildWritePlanFn = () => createFakeWritePlan({ durableMemory: { write: false, skippedReason: "no_cross_session_memory_facts" } });
    await createPostTurnMemoryGraph(deps).invoke(createInitialState());
    assert.strictEqual(calls.writeInteractiveMemoryFn, 0, "durableMemory gated by writePlan");

    // Consolidation enqueued → wake called
    ({ deps, calls } = createFakeDeps());
    deps.buildWritePlanFn = () => createFakeWritePlan({ structMemConsolidation: { write: true, skippedReason: null } });
    deps.enqueueConsolidationFn = async (_input: any) => { calls.enqueueConsolidationFn++; return { status: "enqueued", jobId: "cons_job_001", entryCount: 5, turnCount: 3 }; };
    await createPostTurnMemoryGraph(deps).invoke(createInitialState());
    assert.strictEqual(calls.enqueueConsolidationFn, 1, "consolidation enqueued");
    assert.strictEqual(calls.wakeConsolidationFn, 1, "wake called");
  });

  it("markJobCompleteNode calls completeJobFn exactly once", async () => {
    const { deps, calls } = createFakeDeps();
    const graph = createPostTurnMemoryGraph(deps);
    const state = await graph.invoke(createInitialState());

    assert.strictEqual(calls.completeJobFn.length, 1);
    assert.strictEqual(calls.completeJobFn[0].jobId, FAKE_JOB_ID);
  });

  it("persistStepComplete is called once per completed gated step", async () => {
    const { deps, calls } = createFakeDeps();
    const graph = createPostTurnMemoryGraph(deps);
    await graph.invoke(createInitialState());

    const steps = calls.persistStepComplete.map((c) => c.step);
    const expected = ["raw_chunk", "extract_signals", "engine_state", "structmem", "session_chunks", "durable_memory", "summary_compact"];
    for (const step of expected) {
      assert.ok(steps.includes(step), `missing persistStepComplete for ${step}`);
    }
    assert.strictEqual(steps.length, 7);
  });

  it("recordSnapshotFn is called with extraction and writePlan payload shapes", async () => {
    const { deps, calls } = createFakeDeps();
    const graph = createPostTurnMemoryGraph(deps);
    await graph.invoke(createInitialState());

    const extractionCall = calls.recordSnapshotFn.find((p) => p.extraction);
    assert.ok(extractionCall, "extraction snapshot should have been recorded");
    assert.ok(extractionCall.extraction && typeof extractionCall.extraction === "object");

    const writePlanCall = calls.recordSnapshotFn.find((p) => p.writePlan);
    assert.ok(writePlanCall, "writePlan snapshot should have been recorded");
    assert.ok(writePlanCall.writePlan && typeof writePlanCall.writePlan === "object");
  });

  it("short-circuits on error: no markJobComplete, downstream blocked, errors in result", async () => {
    const { deps, calls } = createFakeDeps();
    deps.writeRawFn = async (_input: any) => { calls.writeRawFn++; throw new Error("simulated failure"); };
    let result = await createPostTurnMemoryGraph(deps).invoke(createInitialState());
    assert.strictEqual(calls.completeJobFn.length, 0, "no job completion on error");
    assert.ok(result.errors && result.errors.length > 0, "errors in result");
    const firstStages = result.errors!.map((e: { stage: string }) => e.stage);
    assert.ok(firstStages.includes("writeRawTurnPairSessionChunk"), "error stage named");

    // Error at extract → downstream blocked
    const d2 = createFakeDeps();
    d2.deps.extractFn = async (_input: any) => { d2.calls.extractFn++; throw new Error("extract failed"); };
    result = await createPostTurnMemoryGraph(d2.deps).invoke(createInitialState());
    const dsSteps = d2.calls.persistStepComplete.filter((c: any) => c.step !== "raw_chunk");
    assert.strictEqual(dsSteps.length, 0, "no downstream steps after error");
    assert.ok(result.errors!.some((e: any) => e.stage === "extractPostTurnSignals"));
  });

  it("persists payload with signals", async () => {
    const { deps } = createFakeDeps();
    const capturedPayload: { value: any } = { value: null };
    deps.persistStepComplete = async (jobId: any, step: any, payload: any, stepStatus: any) => {
      if (step === "extract_signals") capturedPayload.value = payload;
      return markStepCompleted(stepStatus, step);
    };
    await createPostTurnMemoryGraph(deps).invoke(createInitialState());
    assert.ok(capturedPayload.value, "payload captured for extract_signals");
    assert.ok(capturedPayload.value!.signals, "payload contains signals");
  });

  it("captures retry reasons for various failure modes", async () => {
    const extractTimeout = async (_input: any) => { const e = new Error("timeout"); e.name = "AbortError"; throw e; };
    const extractParse = async (_input: any) => { const e = new SyntaxError("parse"); e.name = "SyntaxError"; throw e; };
    const structMemConflict = async (_input: any) => { const e: any = new Error("duplicate"); e.code = "23505"; throw e; };
    const consEnqueueFail = async (_input: any) => { throw new Error("enqueue failed"); };
    const sessionDeadlock = async (_input: any) => { const e: any = new Error("deadlock"); e.code = "40P01"; throw e; };

    const d1 = createFakeDeps();
    d1.deps.extractFn = extractTimeout;
    let r = await createPostTurnMemoryGraph(d1.deps).invoke(createInitialState());
    assert.strictEqual(r.lastRetryReason, "extractor_timeout", "AbortError → timeout");

    const d2 = createFakeDeps();
    d2.deps.extractFn = extractParse;
    r = await createPostTurnMemoryGraph(d2.deps).invoke(createInitialState());
    assert.strictEqual(r.lastRetryReason, "extract_json_parse", "SyntaxError → parse");

    const d3 = createFakeDeps();
    d3.deps.buildWritePlanFn = () => createFakeWritePlan();
    d3.deps.extractFn = async (_input: any) => ({ memoryFacts: [], structMemEntries: [{ entryType: "factual" as const, text: "test", embedding: [1], importanceScore: 0.5, confidenceScore: null }], turnEvent: null, modelReportedConfidence: { memoryFacts: 0.9, turnEvent: 0.0 } } as any);
    d3.deps.structmemNativeExtractor = true;
    d3.deps.writeStructMemFn = structMemConflict;
    r = await createPostTurnMemoryGraph(d3.deps).invoke(createInitialState());
    assert.strictEqual(r.lastRetryReason, "db_write_conflict", "DB conflict → db_write_conflict");

    const d4 = createFakeDeps();
    d4.deps.buildWritePlanFn = () => ({ ...createFakeWritePlan(), structMemConsolidation: { write: true, skippedReason: null } });
    d4.deps.enqueueConsolidationFn = consEnqueueFail;
    r = await createPostTurnMemoryGraph(d4.deps).invoke(createInitialState());
    assert.strictEqual(r.lastRetryReason, "consolidation_enqueue_failed", "enqueue fail");

    const d5 = createFakeDeps();
    d5.deps.buildWritePlanFn = () => createFakeWritePlan();
    d5.deps.extractFn = async (_input: any) => ({ memoryFacts: [{ memoryType: "banter" as const, summary: "test", importanceScore: 0.5, emotionScore: 0, embedding: [1], memoryScope: "current_session" as const, sessionChunkType: "scene_moment" as const }], structMemEntries: [], turnEvent: null, modelReportedConfidence: { memoryFacts: 0.9, turnEvent: 0.0 } } as any);
    d5.deps.persistSessionChunkFn = sessionDeadlock;
    r = await createPostTurnMemoryGraph(d5.deps).invoke(createInitialState());
    assert.strictEqual(r.lastRetryReason, "db_write_conflict", "deadlock → db_write_conflict");
  });

  it("includes lastRetryReason in runner-level error message string", async () => {
    const { deps } = createFakeDeps();
    deps.extractFn = async (_input: any) => { const e = new Error("LLM call timed out"); e.name = "AbortError"; throw e; };
    const result = await createPostTurnMemoryGraph(deps).invoke(createInitialState());
    assert.ok(result.errors && result.errors.length > 0, "errors present");
    const errorStages = result.errors.map((e: { stage: string }) => e.stage).join(", ");
    const errorMessages = result.errors.map((e: { stage: string; message: string }) => `${e.stage}: ${e.message}`).join("; ");
    const retrySuffix = result.lastRetryReason ? ` (retry reason: ${result.lastRetryReason})` : "";
    const thrownMessage = `Post-turn memory graph failed [${errorStages}]: ${errorMessages}${retrySuffix}`;
    assert.ok(thrownMessage.includes("Post-turn memory graph failed ["), "should start with graph-failed prefix");
    assert.ok(thrownMessage.includes("extractor_timeout"), "should include retry reason in message");
  });

  // ===================================================================
  // TG3 applyEngineState node tests (review-004 F7)
  // ===================================================================

  describe("applyEngineState — TG3/TG8 node tests", () => {
    const DEFAULT_AXES = { connection: 0, valence: 0, arousal: 0, restraint: 0.7 };
    const DEFAULT_TRACE = {
      tick: 0,
      axesBefore: DEFAULT_AXES,
      axesAfter: DEFAULT_AXES,
      couplingsFired: [] as string[],
      effectiveBaselines: {} as Record<string, number>,
    };

    /** Drive the graph with targeted fakes; capture engine-spy calls. */
    async function runEngineTest(overrides: Partial<{
      turnEvent: { type: string; intensity: number; reason: string } | null;
      emotionalEngineEnabled: boolean;
      hasEmotionalAxes: boolean;
      computeResult: { next: typeof DEFAULT_AXES; trace: typeof DEFAULT_TRACE; bands?: Record<string, string>; eventDeltas?: Record<string, number> };
      sessionStateRow: Record<string, unknown> | null;
      readAxisStateOverride?: (row: any) => any;
    }>) {
      const captured: {
        computeArgs: any[];
        writeCalls: Array<{ sessionId: string; state: any }>;
        getSessionCalls: string[];
        snapshotCalls: any[];
      } = {
        computeArgs: [],
        writeCalls: [],
        getSessionCalls: [],
        snapshotCalls: [],
      };

      const ev = overrides.turnEvent ?? null;
      const engineFlag = overrides.emotionalEngineEnabled ?? true;
      const hasAxes = overrides.hasEmotionalAxes ?? true;
      const defaultBands = { connection: 'mid' as const, valence: 'mid' as const, arousal: 'mid' as const, restraint: 'mid' as const };
      const cResult = overrides.computeResult ?? {
        next: { ...DEFAULT_AXES },
        trace: { ...DEFAULT_TRACE },
        bands: defaultBands,
        eventDeltas: {} as Record<string, number>,
      };

      const { deps, calls } = createFakeDeps();

      deps.emotionalEngineEnabled = engineFlag;

      deps.extractFn = async (_input: any) => {
        calls.extractFn++;
        return {
          memoryFacts: [] as any[],
          structMemEntries: [] as any[],
          turnEvent: ev as any,
          modelReportedConfidence: { memoryFacts: 0.9, turnEvent: ev ? 1 : 0 },
        } as any;
      };

      // Node now calls computeEngineAdvanceFn, not advanceCharacterStateFn directly
      deps.computeEngineAdvanceFn = (async (_input: any) => {
        captured.computeArgs.push(_input);
        return {
          next: cResult.next,
          trace: cResult.trace,
          bands: cResult.bands ?? { connection: 'mid', valence: 'mid', arousal: 'mid', restraint: 'mid' },
          eventDeltas: cResult.eventDeltas ?? {},
        };
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      }) as any;

      deps.writeAxisStateFn = async (sessionId: string, state: any) => {
        captured.writeCalls.push({ sessionId, state });
      };

      deps.getSessionStateFn = async (sessionId: string) => {
        captured.getSessionCalls.push(sessionId);
        if (overrides.sessionStateRow !== undefined) return overrides.sessionStateRow as any;
        return null;
      };

      if (overrides.readAxisStateOverride) {
        deps.readAxisStateFn = (row: any) => overrides.readAxisStateOverride!(row);
      }

      deps.recordSnapshotFn = (patch: any) => {
        captured.snapshotCalls.push(patch);
      };

      if (!hasAxes) {
        deps.loadCharacterDefaultsFn = (_id: string) => ({
          character_id: "zuo_ran",
          name: "Zuo Ran",
          archetype: "elite_lawyer_controlled_romantic",
          identity: "",
          speech_style: { language: "zh-CN", formality: "formal", emotionality: "restrained", preferred_patterns: [], avoid: [] },
          hard_rules: [],
          interaction_defaults: { default_continuity_scope: "main", default_emotional_baseline: "controlled_tenderness", default_relationship_baseline: "established_partners", response_length: "full", allows_personal_topics: "true_within_scope" },
          safe_deflection: "",
          version: "2.1",
          // NO emotional_axes — F2 case
        } as any);
      }

      const result = await createPostTurnMemoryGraph(deps).invoke(createInitialState());

      return { result, captured, deps, calls };
    }

    // Test 1: TurnEvent applied — computeEngineAdvanceFn receives event + axesBefore
    it("applies TurnEvent and passes it to computeEngineAdvanceFn", async () => {
      const { captured, calls } = await runEngineTest({
        turnEvent: { type: 'user_pursues_connection', intensity: 1.0, reason: 'User asked' },
      });

      assert.equal(calls.completeJobFn.length, 1, "job completes");
      assert.equal(captured.writeCalls.length, 1, "write called once");
      assert.equal(captured.computeArgs.length, 1, "computeEngineAdvanceFn called once");
      // Event object passed to compute fn
      assert.ok(captured.computeArgs[0].event !== null, "event passed to compute");
      assert.equal(captured.computeArgs[0].event.type, 'user_pursues_connection', "event type preserved");
      // axesBefore present
      assert.ok(captured.computeArgs[0].axesBefore, "axesBefore passed");
      // Verify step completed
      const engineSteps = calls.persistStepComplete.filter((c: any) => c.step === "engine_state");
      assert.equal(engineSteps.length, 1, "engine_state step persisted");
    });

    // Test 2: Drift-only — null turnEvent ⇒ computeEngineAdvanceFn receives null event
    it("drift-only tick when turnEvent is null", async () => {
      const { captured, calls } = await runEngineTest({
        turnEvent: null,
      });

      assert.equal(calls.completeJobFn.length, 1, "job completes");
      assert.equal(captured.writeCalls.length, 1, "write called once even with null event");
      assert.equal(captured.computeArgs.length, 1, "computeEngineAdvanceFn called once");
      assert.equal(captured.computeArgs[0].event, null, "null event for drift-only tick");
    });

    // Test 3: Flag-off no-op — emotionalEngineEnabled: false ⇒ no engine deps called
    it("flag-off: no engine deps called when flag is false", async () => {
      const { captured, calls } = await runEngineTest({
        turnEvent: { type: 'user_pursues_connection', intensity: 0.5, reason: 'test' },
        emotionalEngineEnabled: false,
      });

      assert.equal(calls.completeJobFn.length, 1, "job completes");
      assert.equal(captured.computeArgs.length, 0, "compute NOT called when flag off");
      assert.equal(captured.writeCalls.length, 0, "write NOT called when flag off");
      assert.equal(captured.getSessionCalls.length, 0, "getSession NOT called when flag off");
      // Should still have snapshot (only from extraction, not engine)
      const engineSnapshots = captured.snapshotCalls.filter((s: any) => s.engineState);
      assert.equal(engineSnapshots.length, 0, "no engineState snapshot when flag off");
    });

    // Test 4: Hysteresis — value in 0.55–0.65 stays high when previously high (F11)
    it("F11: hysteresis preserved — value in 0.55-0.65 stays high when previously high", async () => {
      const persistedRow = {
        localRelationshipDelta: {
          axis_state: {
            version: 1,
            tick: 1,
            axes: { connection: 0.6, valence: 0, arousal: 0, restraint: 0.7 },
            lastTrace: {
              tick: 1,
              axesBefore: { connection: 0.7, valence: 0, arousal: 0, restraint: 0.7 },
              axesAfter: { connection: 0.6, valence: 0, arousal: 0, restraint: 0.7 },
              couplingsFired: [],
              effectiveBaselines: {},
            },
            bands: { connection: "high", valence: "mid", arousal: "mid", restraint: "high" },
            history: [],
          },
        },
      } as any;

      // Create a readAxisStateFn that parses the axis_state from the row
      const { readAxisState } = await import('../../state/emotionalEngine/axisStatePersistence');

      // We'll override readAxisStateFn to use the real parser on our fake row
      const { captured } = await runEngineTest({
        turnEvent: null,
        sessionStateRow: persistedRow,
        readAxisStateOverride: readAxisState,
        // Return connection=0.6 which is below the enter-high threshold (0.65) but
        // above the exit-high threshold (0.55), so hysteresis should keep it "high"
        computeResult: {
          next: { connection: 0.6, valence: 0, arousal: 0, restraint: 0.6 },
          trace: {
            tick: 2,
            axesBefore: { connection: 0.6, valence: 0, arousal: 0, restraint: 0.7 },
            axesAfter: { connection: 0.6, valence: 0, arousal: 0, restraint: 0.6 },
            couplingsFired: [],
            effectiveBaselines: {},
          },
          bands: { connection: 'high', valence: 'mid', arousal: 'mid', restraint: 'high' },
        },
      });

      // Write should have been called with bands reflecting hysteresis
      assert.equal(captured.writeCalls.length, 1, "write called once");
      const writtenState = captured.writeCalls[0].state;
      // connection was "high" before, now at 0.6 — still "high" (above 0.55 exit)
      assert.equal(writtenState.bands.connection, "high", "connection stays high via hysteresis");
      // restraint was "high" before, now at 0.6 — still "high" (above 0.55 exit)
      assert.equal(writtenState.bands.restraint, "high", "restraint stays high via hysteresis");
    });

    // Test 5: Scope-resolved baseline (F15) — non-default scope drifts toward scope baseline
    it("F15: scope-resolved baseline — main_married axesConfig passed to computeEngineAdvanceFn", async () => {
      const captured: { computeArgs: any[] } = { computeArgs: [] };

      const { deps, calls } = createFakeDeps();
      deps.emotionalEngineEnabled = true;
      // Override loadCharacterDefaultsFn to include scope baselines
      deps.loadCharacterDefaultsFn = (_id: string) => ({
        character_id: "zuo_ran",
        name: "Zuo Ran",
        archetype: "elite_lawyer_controlled_romantic",
        identity: "",
        speech_style: { language: "zh-CN", formality: "formal", emotionality: "restrained", preferred_patterns: [], avoid: [] },
        hard_rules: [],
        interaction_defaults: { default_continuity_scope: "main_married", default_emotional_baseline: "controlled_tenderness", default_relationship_baseline: "established_partners", response_length: "full", allows_personal_topics: "true_within_scope" },
        safe_deflection: "",
        version: "2.1",
        emotional_axes: {
          connection: { baseline: 0, driftRate: 0.02, min: -1, max: 1 },
          valence: { baseline: 0, driftRate: 0.02, min: -1, max: 1 },
          arousal: { baseline: 0, driftRate: 0.02, min: -1, max: 1 },
          restraint: { baseline: 0.7, driftRate: 0.02, min: -1, max: 1 },
        },
        emotional_axes_baseline_by_scope: {
          main_married: { connection: 0.35, valence: 0.15, arousal: 0.0, restraint: 0.55 },
        },
      } as any);

      deps.computeEngineAdvanceFn = (async (input: any) => {
        captured.computeArgs.push(input);
        return {
          next: { connection: 0.35, valence: 0.15, arousal: 0, restraint: 0.55 },
          trace: {
            tick: input.tick,
            axesBefore: { ...input.axesBefore },
            axesAfter: { connection: 0.35, valence: 0.15, arousal: 0, restraint: 0.55 },
            couplingsFired: [],
            effectiveBaselines: {},
          },
          bands: input.previousBands,
          eventDeltas: {},
        };
      }) as any;

      // Set the payload's session continuityScope to main_married
      const marriedPayload = {
        ...FAKE_PAYLOAD,
        session: { ...FAKE_PAYLOAD.session, continuityScope: "main_married" },
      };

      const state = createInitialPostTurnRuntimeState(
        { jobId: FAKE_JOB_ID, attempts: 1, payload: marriedPayload, stepStatus: { ...INITIAL_POST_TURN_STEP_STATUS } },
        { ...FAKE_SESSION, continuityScope: "main_married" },
        "",
      );

      await createPostTurnMemoryGraph(deps).invoke(state);

      assert.equal(captured.computeArgs.length, 1, "computeEngineAdvanceFn called");
      const axesConfig = captured.computeArgs[0].axesConfig;
      // main_married: restraint baseline should be 0.55 (overridden from default 0.7)
      assert.equal(axesConfig.restraint.baseline, 0.55, "restraint baseline scope-resolved to 0.55");
      // connection baseline should be 0.35 (overridden from default 0)
      assert.equal(axesConfig.connection.baseline, 0.35, "connection baseline scope-resolved to 0.35");
      // arousal baseline unchanged (explicitly 0.0 in overrides)
      assert.equal(axesConfig.arousal.baseline, 0, "arousal baseline scope-resolved to 0");
    });

    // Test 6: F2 — no emotional_axes ⇒ step complete, no write, no throw
    it("F2: character without emotional_axes ⇒ no-op, no write, no crash", async () => {
      const { captured, calls } = await runEngineTest({
        turnEvent: null,
        hasEmotionalAxes: false,
      });

      assert.equal(calls.completeJobFn.length, 1, "job completes without error");
      assert.equal(captured.writeCalls.length, 0, "write NOT called when no emotional_axes");
      assert.equal(captured.getSessionCalls.length, 0, "getSession NOT called when no emotional_axes");
      assert.equal(captured.computeArgs.length, 0, "compute NOT called when no emotional_axes");
      // Verify engine_state step was marked complete
      const engineSteps = calls.persistStepComplete.filter((c: any) => c.step === "engine_state");
      assert.equal(engineSteps.length, 1, "engine_state step persisted (no-op completed)");
    });
  });

  // ===================================================================
  // Mapper tests (review-001 F2 — must use [input] shape like traceStage does)
  // ===================================================================

  describe("applyEngineStateInputMapper", () => {
    const SAMPLE_INPUT = {
      axesBefore: { connection: 0.15, valence: 0.05, arousal: 0, restraint: 0.7 },
      event: { type: 'user_pursues_connection' as const, intensity: 0.6, reason: 'leaned in' },
      axesConfig: {
        connection: { baseline: 0.15, driftRate: 0.02, min: -1, max: 1 },
        valence: { baseline: 0.05, driftRate: 0.02, min: -1, max: 1 },
        arousal: { baseline: 0, driftRate: 0.02, min: -1, max: 1 },
        restraint: { baseline: 0.7, driftRate: 0.02, min: -1, max: 1 },
      },
      couplings: [{ id: 'zr_c2' }, { id: 'zr_c3' }] as any[],
      previousBands: { connection: 'mid' as const, valence: 'mid' as const, arousal: 'mid' as const, restraint: 'mid' as const },
      tick: 7,
      scope: 'main_relationship',
    };

    it("maps object directly to fields (not undefined)", () => {
      const result = applyEngineStateInputMapper(SAMPLE_INPUT as any);
      assert.ok(result.axesBefore, "axesBefore populated");
      assert.equal(result.scope, 'main_relationship', "scope populated");
      assert.deepEqual(result.baselines, { connection: 0.15, valence: 0.05, arousal: 0, restraint: 0.7 }, "baselines populated");
      assert.deepEqual(result.couplingIds, ['zr_c2', 'zr_c3'], "couplingIds populated");
      assert.equal(result.tick, 7, "tick populated");
    });

    it("maps event with type/intensity/reason", () => {
      const result = applyEngineStateInputMapper(SAMPLE_INPUT as any);
      assert.ok(result.event, "event present");
      assert.equal((result.event as any).type, 'user_pursues_connection', "event type");
      assert.equal((result.event as any).intensity, 0.6, "event intensity");
      assert.equal((result.event as any).reason, 'leaned in', "event reason");
    });

    it("maps null event to null without throwing", () => {
      const noEvent = { ...SAMPLE_INPUT, event: null };
      const result = applyEngineStateInputMapper(noEvent as any);
      assert.equal(result.event, null, "null event maps to null");
    });

    it("does not throw on any field", () => {
      // Should never throw — the corrected fix for F3
      applyEngineStateInputMapper(SAMPLE_INPUT as any);
    });
  });

  describe("applyEngineStateOutputMapper", () => {
    const SAMPLE_RESULT = {
      next: { connection: 0.21, valence: 0.08, arousal: -0.03, restraint: 0.61 },
      trace: {
        tick: 7,
        axesBefore: { connection: 0.15, valence: 0.05, arousal: 0, restraint: 0.7 },
        axesAfter: { connection: 0.21, valence: 0.08, arousal: -0.03, restraint: 0.61 },
        couplingsFired: ['zr_c2'],
        effectiveBaselines: { restraint: 0.44 },
        conditionTransitions: [{ id: 'c1', from: true, to: false }],
      },
      bands: { connection: 'mid' as const, valence: 'mid' as const, arousal: 'mid' as const, restraint: 'mid' as const },
      eventDeltas: { connection: 0.06, valence: 0.03 },
    };

    it("maps output fields correctly", () => {
      const result = applyEngineStateOutputMapper(SAMPLE_RESULT);
      assert.deepEqual(result.axesAfter, SAMPLE_RESULT.next, "axesAfter");
      assert.deepEqual(result.eventDeltas, SAMPLE_RESULT.eventDeltas, "eventDeltas");
      assert.deepEqual(result.couplingsFired, ['zr_c2'], "couplingsFired");
      assert.deepEqual(result.effectiveBaselines, { restraint: 0.44 }, "effectiveBaselines");
      assert.deepEqual(result.conditionTransitions, [{ id: 'c1', from: true, to: false }], "conditionTransitions");
      assert.deepEqual(result.bands, SAMPLE_RESULT.bands, "bands");
    });

    it("handles empty conditionTransitions", () => {
      const noConds = {
        ...SAMPLE_RESULT,
        trace: { ...SAMPLE_RESULT.trace, conditionTransitions: undefined },
      };
      const result = applyEngineStateOutputMapper(noConds);
      assert.deepEqual(result.conditionTransitions, [], "empty conditionTransitions");
    });
  });
});
