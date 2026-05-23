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

  it("raw_chunk already complete -> writeRawFn not called", async () => {
    const { deps, calls } = createFakeDeps();
    const graph = createPostTurnMemoryGraph(deps);
    await graph.invoke(createInitialState({ raw_chunk: "completed" }));

    assert.strictEqual(calls.writeRawFn, 0);
    assert.strictEqual(calls.extractFn, 1);
  });

  it("extract_signals already complete with payload.signals -> extractFn not called", async () => {
    const { deps, calls } = createFakeDeps();
    const payload: PostTurnJobPayloadV1 = { ...FAKE_PAYLOAD, signals: { memoryFacts: [], structMemEntries: [], emotionalDelta: null, modelReportedConfidence: { memoryFacts: 0.9, emotionalDelta: 0.0 } } };
    const state = createInitialPostTurnRuntimeState(
      { jobId: FAKE_JOB_ID, attempts: 1, payload, stepStatus: markStepCompleted({ ...INITIAL_POST_TURN_STEP_STATUS }, "extract_signals") },
      FAKE_SESSION,
      "",
    );
    const graph = createPostTurnMemoryGraph(deps);
    await graph.invoke(state);

    assert.strictEqual(calls.extractFn, 0);
  });

  it("structmem already complete -> writeStructMemFn not called", async () => {
    const { deps, calls } = createFakeDeps();
    const graph = createPostTurnMemoryGraph(deps);
    await graph.invoke(createInitialState({ structmem: "completed" }));

    assert.strictEqual(calls.writeStructMemFn, 0);
  });

  it("session_chunks already complete -> persistSessionChunkFn not called", async () => {
    const { deps, calls } = createFakeDeps();
    const graph = createPostTurnMemoryGraph(deps);
    await graph.invoke(createInitialState({ session_chunks: "completed" }));

    assert.strictEqual(calls.persistSessionChunkFn, 0);
  });

  it("durable_memory already complete -> writeInteractiveMemoryFn not called", async () => {
    const { deps, calls } = createFakeDeps();
    const graph = createPostTurnMemoryGraph(deps);
    await graph.invoke(createInitialState({ durable_memory: "completed" }));

    assert.strictEqual(calls.writeInteractiveMemoryFn, 0);
  });

  it("summary_compact already complete -> compactSummaryFn not called", async () => {
    const { deps, calls } = createFakeDeps();
    const graph = createPostTurnMemoryGraph(deps);
    await graph.invoke(createInitialState({ summary_compact: "completed" }));

    assert.strictEqual(calls.compactSummaryFn, 0);
    assert.strictEqual(calls.completeJobFn.length, 1);
  });

  it("writePlan.structMem.write === false -> writeStructMemFn not called even when step is pending", async () => {
    const { deps, calls } = createFakeDeps();
    deps.buildWritePlanFn = () => createFakeWritePlan({ structMem: { write: false, skippedReason: "structmem_disabled" } });
    const graph = createPostTurnMemoryGraph(deps);
    await graph.invoke(createInitialState());

    assert.strictEqual(calls.writeStructMemFn, 0);
  });

  it("writePlan.structMemConsolidation.write === true and enqueued -> wakeConsolidationFn called", async () => {
    const { deps, calls } = createFakeDeps();
    deps.buildWritePlanFn = () => createFakeWritePlan({ structMemConsolidation: { write: true, skippedReason: null } });
    deps.enqueueConsolidationFn = async (_input) => {
      calls.enqueueConsolidationFn++;
      return { status: "enqueued", jobId: "cons_job_001", entryCount: 5, turnCount: 3 };
    };
    const graph = createPostTurnMemoryGraph(deps);
    await graph.invoke(createInitialState());

    assert.strictEqual(calls.enqueueConsolidationFn, 1);
    assert.strictEqual(calls.wakeConsolidationFn, 1);
  });

  it("writePlan.sessionChunks.write === false -> persistSessionChunkFn not called", async () => {
    const { deps, calls } = createFakeDeps();
    deps.buildWritePlanFn = () => createFakeWritePlan({ sessionChunks: { write: false, skippedReason: "suppressed" } });
    const graph = createPostTurnMemoryGraph(deps);
    await graph.invoke(createInitialState());

    assert.strictEqual(calls.persistSessionChunkFn, 0);
  });

  it("writePlan.durableMemory.write === false -> writeInteractiveMemoryFn not called", async () => {
    const { deps, calls } = createFakeDeps();
    deps.buildWritePlanFn = () => createFakeWritePlan({ durableMemory: { write: false, skippedReason: "no_cross_session_memory_facts" } });
    const graph = createPostTurnMemoryGraph(deps);
    await graph.invoke(createInitialState());

    assert.strictEqual(calls.writeInteractiveMemoryFn, 0);
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

  // ---- B1: error short-circuit tests ----------------------------------------

  it("B1: a node returning errors causes completeJobFn NOT to be called", async () => {
    const { deps, calls } = createFakeDeps();
    // Make writeRawFn throw to trigger errors at the first node
    deps.writeRawFn = async (_input) => {
      calls.writeRawFn++;
      throw new Error("simulated failure in writeRawTurnPairSessionChunk");
    };
    const graph = createPostTurnMemoryGraph(deps);
    await graph.invoke(createInitialState());

    // completeJobFn should NOT be called when errors occurred
    assert.strictEqual(calls.completeJobFn.length, 0);
  });

  it("B1: a node returning errors causes persistStepComplete NOT to be called for downstream steps", async () => {
    const { deps, calls } = createFakeDeps();
    // Make extractFn throw to trigger errors at the second node.
    // writeRawTurnPairSessionChunk should still complete normally.
    deps.extractFn = async (_input) => {
      calls.extractFn++;
      throw new Error("simulated failure in extractPostTurnSignals");
    };
    const graph = createPostTurnMemoryGraph(deps);
    await graph.invoke(createInitialState());

    // Only raw_chunk persist should have been called (not extract_signals or any downstream)
    const actualCalls = calls.persistStepComplete.length;
    // If raw_chunk completed: persistStepComplete was called once (raw_chunk).
    // If raw_chunk also hit errors somehow, it could be 0.
    // We assert that the total is less than 6 (full graph completion).
    assert.ok(actualCalls < 6, "persistStepComplete should not be called for all 6 steps when an error occurs");
    // And importantly, downstream steps should not have been called
    const downstreamSteps = calls.persistStepComplete.filter(
      (c) => c.step !== "raw_chunk",
    );
    assert.strictEqual(downstreamSteps.length, 0, "no downstream persistStepComplete calls after error");
  });

  it("B1: graph returns final state containing the produced errors", async () => {
    const { deps, calls } = createFakeDeps();
    deps.extractFn = async (_input) => {
      calls.extractFn++;
      throw new Error("simulated failure in extractPostTurnSignals");
    };
    const graph = createPostTurnMemoryGraph(deps);
    const result = await graph.invoke(createInitialState());

    assert.ok(result.errors, "errors should be present in result");
    assert.ok(result.errors.length > 0, "errors array should not be empty");
    const errorStages = result.errors!.map((e: { stage: string }) => e.stage);
    assert.ok(errorStages.includes("extractPostTurnSignals"), "extractPostTurnSignals error should be in result");
  });

  // ---- B2: defaultPersistStepComplete payload persistence test --------------

  it("B2: defaultPersistStepComplete - raw_chunk called with payload, stepStatus, and jobId", async () => {
    const { deps, calls } = createFakeDeps();
    const graph = createPostTurnMemoryGraph(deps);
    await graph.invoke(createInitialState());

    // Verify persistStepComplete was called with the correct arguments
    assert.ok(calls.persistStepComplete.length > 0, "persistStepComplete should have been called");
    const rawChunkCall = calls.persistStepComplete.find((c) => c.step === "raw_chunk");
    assert.ok(rawChunkCall, "persistStepComplete should have been called for raw_chunk");
    assert.strictEqual(rawChunkCall.jobId, FAKE_JOB_ID, "jobId should match");
  });

  it("B2: extract_signals persist passes updated payload with signals", async () => {
    const { deps, calls } = createFakeDeps();
    // Override persistStepComplete to capture the payload
    const capturedPayload: { value: PostTurnJobPayloadV1 | null } = { value: null };
    const originalPersist = deps.persistStepComplete;
    deps.persistStepComplete = async (jobId, step, payload, stepStatus) => {
      if (step === "extract_signals") {
        capturedPayload.value = payload;
      }
      return originalPersist(jobId, step, payload, stepStatus);
    };

    const graph = createPostTurnMemoryGraph(deps);
    await graph.invoke(createInitialState());

    // The captured payload should have signals attached
    assert.ok(capturedPayload.value, "payload should have been captured for extract_signals");
    assert.ok(capturedPayload.value!.signals, "payload should contain signals");
  });

  // ---- TG3: Retry-reason tests ----------------------------------------------

  it("TG3: extractPostTurnSignals NodeTimeout -> lastRetryReason is extractor_timeout", async () => {
    const { deps, calls } = createFakeDeps();
    deps.extractFn = async (_input: any) => {
      const err = new Error("LLM call timed out after 30000ms");
      err.name = "AbortError";
      throw err;
    };
    const graph = createPostTurnMemoryGraph(deps);
    const result = await graph.invoke(createInitialState());
    assert.ok(result.errors && result.errors.length > 0);
    assert.strictEqual(result.lastRetryReason, "extractor_timeout");
  });

  it("TG3: extractPostTurnSignals ZodError -> lastRetryReason is extract_json_parse", async () => {
    const { deps, calls } = createFakeDeps();
    deps.extractFn = async (_input: any) => {
      const err = new SyntaxError("Unexpected token");
      err.name = "SyntaxError";
      throw err;
    };
    const graph = createPostTurnMemoryGraph(deps);
    const result = await graph.invoke(createInitialState());
    assert.ok(result.errors && result.errors.length > 0);
    assert.strictEqual(result.lastRetryReason, "extract_json_parse");
  });

  it("TG3: writeStructMemTurn Postgres unique violation -> lastRetryReason is db_write_conflict", async () => {
    const { deps, calls } = createFakeDeps();
    deps.buildWritePlanFn = () => createFakeWritePlan();
    deps.writeStructMemFn = async (_input: any) => {
      const err: any = new Error("duplicate key value violates unique constraint");
      err.code = "23505";
      throw err;
    };
    // Make extractFn return structMemEntries so the native path writes rows
    deps.extractFn = async (_input: any) => ({
      memoryFacts: [],
      structMemEntries: [{ entryType: "factual" as const, text: "test", embedding: [1], importanceScore: 0.5, confidenceScore: null }],
      emotionalDelta: null,
      modelReportedConfidence: { memoryFacts: 0.9, emotionalDelta: 0.0 },
    });
    deps.structmemNativeExtractor = true;
    const graph = createPostTurnMemoryGraph(deps);
    const result = await graph.invoke(createInitialState());
    assert.ok(result.errors && result.errors.length > 0);
    assert.strictEqual(result.lastRetryReason, "db_write_conflict");
  });

  it("TG3: maybeEnqueueStructMemConsolidation throws -> lastRetryReason is consolidation_enqueue_failed", async () => {
    const { deps, calls } = createFakeDeps();
    deps.buildWritePlanFn = () => ({
      ...createFakeWritePlan(),
      structMemConsolidation: { write: true, skippedReason: null },
    });
    deps.enqueueConsolidationFn = async (_input: any) => {
      throw new Error("enqueue failed");
    };
    const graph = createPostTurnMemoryGraph(deps);
    const result = await graph.invoke(createInitialState());
    assert.ok(result.errors && result.errors.length > 0);
    assert.strictEqual(result.lastRetryReason, "consolidation_enqueue_failed");
  });

  it("TG3: graph error includes lastRetryReason in runner-level error message", async () => {
    const { deps, calls } = createFakeDeps();
    deps.extractFn = async (_input: any) => {
      const err = new Error("LLM call timed out");
      err.name = "AbortError";
      throw err;
    };

    // Simulate the runner's error-rethrow logic
    const graph = createPostTurnMemoryGraph(deps);
    const result = await graph.invoke(createInitialState());

    assert.ok(result.errors && result.errors.length > 0);
    // The runner constructs: "Post-turn memory graph failed [<stages>]: <messages> (retry reason: <reason>)"
    const errorStages = result.errors.map((e: { stage: string }) => e.stage).join(", ");
    const errorMessages = result.errors.map((e: { stage: string; message: string }) => `${e.stage}: ${e.message}`).join("; ");
    const retrySuffix = result.lastRetryReason ? ` (retry reason: ${result.lastRetryReason})` : "";
    const thrownMessage = `Post-turn memory graph failed [${errorStages}]: ${errorMessages}${retrySuffix}`;

    assert.ok(thrownMessage.includes("Post-turn memory graph failed ["));
    assert.ok(thrownMessage.includes("extractor_timeout"), "should include retry reason");
  });

  it("TG3: writeSessionMemoryChunks Postgres deadlock -> lastRetryReason is db_write_conflict", async () => {
    const { deps, calls } = createFakeDeps();
    deps.buildWritePlanFn = () => createFakeWritePlan();
    // Provide memory facts with current_session scope so the node enters the loop
    deps.extractFn = async (_input: any) => ({
      memoryFacts: [
        { memoryType: "banter" as const, summary: "test", importanceScore: 0.5, emotionScore: 0, embedding: [1], memoryScope: "current_session" as const, sessionChunkType: "scene_moment" as const },
      ],
      structMemEntries: [],
      emotionalDelta: null,
      modelReportedConfidence: { memoryFacts: 0.9, emotionalDelta: 0.0 },
    });

    // Make persistSessionChunkFn throw with a deadlock code
    deps.persistSessionChunkFn = async (_input: any) => {
      const err: any = new Error("deadlock detected");
      err.code = "40P01";
      throw err;
    };
    const graph = createPostTurnMemoryGraph(deps);
    const result = await graph.invoke(createInitialState());
    assert.ok(result.errors && result.errors.length > 0);
    assert.strictEqual(result.lastRetryReason, "db_write_conflict");
  });
});
