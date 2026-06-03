import { describe, it } from "node:test";
import assert from "node:assert";
import { createPostTurnMemoryGraph, type PostTurnMemoryGraphDeps } from "./postTurnMemoryGraph";
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
      return { memoryFacts: [], structMemEntries: [], emotionalDelta: null, modelReportedConfidence: { memoryFacts: 0.9, emotionalDelta: 0.0 } };
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
  it("runs all 9 nodes in order on a fresh job and reaches markJobComplete", async () => {
    const { deps, calls } = createFakeDeps();
    const graph = createPostTurnMemoryGraph(deps);
    await graph.invoke(createInitialState());

    assert.strictEqual(calls.persistStepComplete.length, 6);
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
    const payload: PostTurnJobPayloadV1 = { ...FAKE_PAYLOAD, signals: { memoryFacts: [], structMemEntries: [], emotionalDelta: null, modelReportedConfidence: { memoryFacts: 0.9, emotionalDelta: 0.0 } } };
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
    const expected = ["raw_chunk", "extract_signals", "structmem", "session_chunks", "durable_memory", "summary_compact"];
    for (const step of expected) {
      assert.ok(steps.includes(step), `missing persistStepComplete for ${step}`);
    }
    assert.strictEqual(steps.length, 6);
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
    d3.deps.extractFn = async (_input: any) => ({ memoryFacts: [], structMemEntries: [{ entryType: "factual" as const, text: "test", embedding: [1], importanceScore: 0.5, confidenceScore: null }], emotionalDelta: null, modelReportedConfidence: { memoryFacts: 0.9, emotionalDelta: 0.0 } });
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
    d5.deps.extractFn = async (_input: any) => ({ memoryFacts: [{ memoryType: "banter" as const, summary: "test", importanceScore: 0.5, emotionScore: 0, embedding: [1], memoryScope: "current_session" as const, sessionChunkType: "scene_moment" as const }], structMemEntries: [], emotionalDelta: null, modelReportedConfidence: { memoryFacts: 0.9, emotionalDelta: 0.0 } });
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
});
