import { describe, it } from "node:test";
import assert from "node:assert";
import { createStructMemConsolidationGraph, type StructMemConsolidationGraphDeps } from "./structMemConsolidationGraph";
import type { StructMemConsolidationJob } from "../../db/schema/structmem";
import type { ChatSession } from "../../db/schema/chat";
import type { ConsolidationCandidateEntry } from "../../memory/structmem/structmemConsolidationSelection";
import type { StructMemConsolidationSynthesisResult } from "../../memory/structmem/structmemConsolidationSynthesis";

// ---------------------------------------------------------------------------
// Fakes
// ---------------------------------------------------------------------------

const FAKE_JOB: StructMemConsolidationJob = {
  id: "job_001",
  sessionId: "sess_001",
  characterId: "char_001",
  playerId: "player_001",
  memoryNamespace: "test_ns",
  status: "running",
  turnStart: 10,
  turnEnd: 20,
  attemptCount: 1,
  maxAttempts: 3,
  lastAttemptedAt: null,
  lockedAt: new Date(),
  lockedBy: "worker_1",
  errorMessage: null,
  createdAt: new Date(),
  completedAt: null,
};

const FAKE_SESSION: ChatSession = {
  sessionId: "sess_001",
  characterId: "char_001",
  playerId: "player_001",
  mode: "canonical_live",
  continuityScope: "main",
  continuityFamily: "main_world",
  memoryNamespace: "test_ns",
  writebackPolicy: "normal",
  personaOverlayId: null,
  pinnedTime: null,
  pinnedLocation: null,
  sessionSummary: null,
  displayTitle: null,
  thinking: false,
  temperature: 0.7,
  deletedAt: null,
  createdAt: new Date(),
  updatedAt: new Date(),
};

interface FakeEntryRow extends ConsolidationCandidateEntry {
  importanceScore: number | null;
  confidenceScore: number | null;
}

const FAKE_BUFFER_ENTRIES: FakeEntryRow[] = [
  { id: "e1", eventId: "evt1", turnIndex: 10, entryType: "factual", text: "test entry", importanceScore: 0.5, confidenceScore: null },
];

const FAKE_SEMANTIC_SEED_ENTRIES: FakeEntryRow[] = [
  { id: "s1", eventId: "evt0", turnIndex: 5, entryType: "factual", text: "seed entry", importanceScore: 0.6, confidenceScore: null },
];

const FAKE_SYNTHESIS: StructMemConsolidationSynthesisResult = {
  summary_text: "Consolidated summary of events.",
  summary_json: { key: "value" },
  confidence_score: 0.8,
  telemetry: { model: "test", provider: "test", inputTokens: 100, outputTokens: 50 },
};

function createFakeDeps(): {
  deps: StructMemConsolidationGraphDeps;
  calls: Record<string, number>;
} {
  const calls: Record<string, number> = {
    loadJobFn: 0,
    selectBufferFn: 0,
    synthesizeFn: 0,
    embedFn: 0,
    persistCurrentSessionFn: 0,
    loadSessionFn: 0,
    writeCrossSessionFn: 0,
    markJobFn: 0,
  };

  const deps: StructMemConsolidationGraphDeps = {
    loadJobFn: async (_jobId) => {
      calls.loadJobFn++;
      return FAKE_JOB;
    },
    selectBufferFn: async (_input: any): Promise<any> => {
      calls.selectBufferFn++;
      return {
        bufferEntries: FAKE_BUFFER_ENTRIES,
        semanticSeedEntries: FAKE_SEMANTIC_SEED_ENTRIES,
        bufferCount: 1,
        semanticSeedCount: 1,
        turnStart: 10,
        turnEnd: 20,
      };
    },
    synthesizeFn: async (_input) => {
      calls.synthesizeFn++;
      return FAKE_SYNTHESIS;
    },
    embedFn: async (_text) => {
      calls.embedFn++;
      return [0.1, 0.2, 0.3];
    },
    persistCurrentSessionFn: async (_input) => {
      calls.persistCurrentSessionFn++;
      return { consolidationId: "cons_001", sourceEntryCount: 2, sourceLinkCount: 2 };
    },
    loadSessionFn: async (_sessionId) => {
      calls.loadSessionFn++;
      return FAKE_SESSION;
    },
    writeCrossSessionFn: async (_input) => {
      calls.writeCrossSessionFn++;
      return { status: "disabled", crossSessionIds: [] };
    },
    markJobFn: async (_jobId, _status) => {
      calls.markJobFn++;
    },
    maxSynthesisInputTokens: 8000,
  };

  return { deps, calls };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("structMemConsolidationGraph", () => {
  it("empty buffer marks skipped and does not call synthesize/embed/persist", async () => {
    const { deps, calls } = createFakeDeps();
    deps.selectBufferFn = async (_input: any): Promise<any> => ({
      bufferEntries: [],
      semanticSeedEntries: [],
      bufferCount: 0,
      semanticSeedCount: 0,
      turnStart: null,
      turnEnd: null,
      skippedReason: "empty_buffer",
    });

    const graph = createStructMemConsolidationGraph(deps);
    const result = await graph.invoke({ jobId: "job_001" });

    assert.strictEqual(result.finalStatus, "skipped");
    assert.strictEqual(result.skippedReason, "empty_buffer");
    assert.strictEqual(calls.synthesizeFn, 0);
    assert.strictEqual(calls.embedFn, 0);
    assert.strictEqual(calls.persistCurrentSessionFn, 0);
    assert.strictEqual(calls.markJobFn, 1);
    assert.ok(!result.errors || result.errors.length === 0);
  });

  it("non-empty buffer calls synthesize, embed, persist, cross-session, and mark complete", async () => {
    const { deps, calls } = createFakeDeps();
    const graph = createStructMemConsolidationGraph(deps);
    const result = await graph.invoke({ jobId: "job_001" });

    assert.strictEqual(calls.loadJobFn, 1);
    assert.strictEqual(calls.selectBufferFn, 1);
    assert.strictEqual(calls.synthesizeFn, 1);
    assert.strictEqual(calls.embedFn, 1);
    assert.strictEqual(calls.persistCurrentSessionFn, 1);
    assert.strictEqual(calls.loadSessionFn, 1);
    assert.strictEqual(calls.writeCrossSessionFn, 1);
    assert.strictEqual(calls.markJobFn, 1);
    assert.strictEqual(result.finalStatus, "completed");
    assert.strictEqual(result.currentConsolidationId, "cons_001");
    assert.ok(result.embedding);
    assert.strictEqual(result.bufferCount, 1);
    assert.strictEqual(result.semanticSeedCount, 1);
    assert.ok(!result.errors || result.errors.length === 0);
  });

  it("semantic seed entries are passed to synthesis/persistence", async () => {
    const { deps, calls } = createFakeDeps();
    let capturedSynthesisInput: any = null;
    deps.synthesizeFn = async (input) => {
      capturedSynthesisInput = input;
      calls.synthesizeFn++;
      return FAKE_SYNTHESIS;
    };

    const graph = createStructMemConsolidationGraph(deps);
    await graph.invoke({ jobId: "job_001" });

    assert.ok(capturedSynthesisInput);
    assert.strictEqual(capturedSynthesisInput.bufferEntries.length, 1);
    assert.strictEqual(capturedSynthesisInput.semanticSeedEntries.length, 1);
    assert.strictEqual(capturedSynthesisInput.bufferEntries[0].id, "e1");
    assert.strictEqual(capturedSynthesisInput.semanticSeedEntries[0].id, "s1");
  });

  it("synthesis failure stops before embed/persist and records synthesis_failed", async () => {
    const { deps, calls } = createFakeDeps();
    deps.synthesizeFn = async (_input) => {
      calls.synthesizeFn++;
      throw new Error("LLM call failed");
    };

    const graph = createStructMemConsolidationGraph(deps);
    const result = await graph.invoke({ jobId: "job_001" });

    assert.ok(result.errors && result.errors.length > 0);
    assert.strictEqual(result.failureReason, "synthesis_failed");
    assert.strictEqual(calls.synthesizeFn, 1);
    assert.strictEqual(calls.embedFn, 0);
    assert.strictEqual(calls.persistCurrentSessionFn, 0);
    assert.strictEqual(calls.markJobFn, 0);
  });

  it("embedding failure stops before persist and records embedding_failed", async () => {
    const { deps, calls } = createFakeDeps();
    deps.embedFn = async (_text) => {
      calls.embedFn++;
      throw new Error("embedding failed");
    };

    const graph = createStructMemConsolidationGraph(deps);
    const result = await graph.invoke({ jobId: "job_001" });

    assert.ok(result.errors && result.errors.length > 0);
    assert.strictEqual(result.failureReason, "embedding_failed");
    assert.strictEqual(calls.embedFn, 1);
    assert.strictEqual(calls.persistCurrentSessionFn, 0);
    assert.strictEqual(calls.markJobFn, 0);
  });

  it("current-session DB persist failure records db_write_failed", async () => {
    const { deps, calls } = createFakeDeps();
    deps.persistCurrentSessionFn = async (_input) => {
      calls.persistCurrentSessionFn++;
      throw new Error("DB insert failed");
    };

    const graph = createStructMemConsolidationGraph(deps);
    const result = await graph.invoke({ jobId: "job_001" });

    assert.ok(result.errors && result.errors.length > 0);
    assert.strictEqual(result.failureReason, "db_write_failed");
    assert.strictEqual(calls.markJobFn, 0);
  });

  it("cross-session write failure records cross_session_write_failed", async () => {
    const { deps, calls } = createFakeDeps();
    deps.writeCrossSessionFn = async (_input) => {
      calls.writeCrossSessionFn++;
      throw new Error("cross-session write failed");
    };

    const graph = createStructMemConsolidationGraph(deps);
    const result = await graph.invoke({ jobId: "job_001" });

    assert.ok(result.errors && result.errors.length > 0);
    assert.strictEqual(result.failureReason, "cross_session_write_failed");
    // markJob should not be called — error before completion
    assert.strictEqual(calls.markJobFn, 0);
  });

  it("passes configured maxSynthesisInputTokens to synthesizeFn", async () => {
    const { deps, calls } = createFakeDeps();
    let capturedMaxTokens: number | null = null;
    deps.synthesizeFn = async (input: any) => {
      capturedMaxTokens = input.maxInputTokens;
      calls.synthesizeFn++;
      return FAKE_SYNTHESIS;
    };
    // Override default tokens to a specific test value
    deps.maxSynthesisInputTokens = 12345;

    const graph = createStructMemConsolidationGraph(deps);
    await graph.invoke({ jobId: "job_001" });

    assert.strictEqual(capturedMaxTokens, 12345, "synthesizeFn should receive configured maxSynthesisInputTokens");
  });

  it("missing job records job_not_found", async () => {
    const { deps, calls } = createFakeDeps();
    deps.loadJobFn = async (_jobId) => {
      calls.loadJobFn++;
      return null;
    };

    const graph = createStructMemConsolidationGraph(deps);
    const result = await graph.invoke({ jobId: "nonexistent" });

    assert.ok(result.errors && result.errors.length > 0);
    assert.strictEqual(result.failureReason, "job_not_found");
    assert.strictEqual(calls.selectBufferFn, 0);
    assert.strictEqual(calls.markJobFn, 0);
  });

  it("empty buffer records sourceEventCount and selectedEntryCount as 0", async () => {
    const { deps } = createFakeDeps();
    deps.selectBufferFn = async (_input: any): Promise<any> => ({
      bufferEntries: [],
      semanticSeedEntries: [],
      bufferCount: 0,
      semanticSeedCount: 0,
      turnStart: null,
      turnEnd: null,
      skippedReason: "empty_buffer",
    });

    const graph = createStructMemConsolidationGraph(deps);
    const result = await graph.invoke({ jobId: "job_001" });

    assert.strictEqual(result.sourceEventCount, 0);
    assert.strictEqual(result.selectedEntryCount, 0);
    assert.strictEqual(result.finalStatus, "skipped");
  });

  it("non-running job records job_not_running", async () => {
    const { deps, calls } = createFakeDeps();
    deps.loadJobFn = async (_jobId) => {
      calls.loadJobFn++;
      return { ...FAKE_JOB, status: "completed" };
    };

    const graph = createStructMemConsolidationGraph(deps);
    const result = await graph.invoke({ jobId: "job_001" });

    assert.ok(result.errors && result.errors.length > 0);
    assert.strictEqual(result.failureReason, "job_not_running");
    assert.strictEqual(calls.selectBufferFn, 0);
  });

  it("select buffer failure records insufficient_candidates", async () => {
    const { deps, calls } = createFakeDeps();
    deps.selectBufferFn = async (_input) => {
      calls.selectBufferFn++;
      throw new Error("buffer selection query failed");
    };

    const graph = createStructMemConsolidationGraph(deps);
    const result = await graph.invoke({ jobId: "job_001" });

    assert.ok(result.errors && result.errors.length > 0);
    assert.strictEqual(result.failureReason, "insufficient_candidates");
    assert.strictEqual(calls.synthesizeFn, 0);
  });

  it("full success path records all expected metadata fields", async () => {
    const { deps } = createFakeDeps();
    const graph = createStructMemConsolidationGraph(deps);
    const result = await graph.invoke({ jobId: "job_001" });

    assert.strictEqual(result.finalStatus, "completed");
    assert.strictEqual(result.currentConsolidationId, "cons_001");
    // Selection fields
    assert.strictEqual(result.bufferCount, 1);
    assert.strictEqual(result.semanticSeedCount, 1);
    assert.strictEqual(result.sourceEventCount, 2); // 2 unique eventIds: evt1, evt0
    assert.strictEqual(result.selectedEntryCount, 2); // 1 buffer + 1 seed
    assert.strictEqual(result.turnStart, 10);
    assert.strictEqual(result.turnEnd, 20);
    // Embedding
    assert.ok(result.embedding);
    // Persistence
    assert.strictEqual(result.sourceEntryCount, 2);
    assert.strictEqual(result.sourceLinkCount, 2);
    // Synthesis
    assert.strictEqual(result.synthesisTokenCount, 150);
    // Cross-session
    assert.strictEqual(result.crossSessionStatus, "disabled");
    assert.strictEqual(result.crossSessionIds?.length, 0);
    assert.strictEqual(result.continuityFamily, "main_world");
  });
});
