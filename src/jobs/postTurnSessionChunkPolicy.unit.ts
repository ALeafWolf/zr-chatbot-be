import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildPostTurnWritePlan,
  shouldSuppressExtractorSessionChunks,
} from "./postTurnPolicies";
import type { MemoryCandidate } from "../memory/interactive/writeInteractiveMemory";

describe("postTurnPolicies", () => {
  it("does not suppress extractor chunks when StructMem is disabled", () => {
    assert.equal(
      shouldSuppressExtractorSessionChunks({
        structMemEnabled: false,
        suppressExtractorSessionChunks: true,
        nativeStructMemExtractor: true,
      }),
      false,
    );
  });

  it("suppresses extractor chunks when the Phase 1 suppression flag is enabled", () => {
    assert.equal(
      shouldSuppressExtractorSessionChunks({
        structMemEnabled: true,
        suppressExtractorSessionChunks: true,
        nativeStructMemExtractor: false,
      }),
      true,
    );
  });

  it("suppresses extractor chunks on the Phase 2 native StructMem path", () => {
    assert.equal(
      shouldSuppressExtractorSessionChunks({
        structMemEnabled: true,
        suppressExtractorSessionChunks: false,
        nativeStructMemExtractor: true,
      }),
      true,
    );
  });

  it("keeps legacy extractor chunks when StructMem is on but both suppression paths are off", () => {
    assert.equal(
      shouldSuppressExtractorSessionChunks({
        structMemEnabled: true,
        suppressExtractorSessionChunks: false,
        nativeStructMemExtractor: false,
      }),
      false,
    );
  });

  it("keeps the current non-sandbox write policy in one plan", () => {
    const plan = buildPostTurnWritePlan(
      { mode: "story", writebackPolicy: "default" },
      {
        STRUCTMEM_ENABLED: true,
        STRUCTMEM_CONSOLIDATION_ENABLED: true,
        STRUCTMEM_SUPPRESS_EXTRACTOR_SESSION_CHUNKS: false,
        STRUCTMEM_NATIVE_EXTRACTOR: false,
      },
      {
        memoryFacts: [
          candidate("cross_session"),
          candidate("current_session"),
        ],
        structMemEntries: [],
        shouldWriteMemory: true,
      },
    );

    assert.equal(plan.rawChunk.write, true);
    assert.equal(plan.structMem.write, true);
    assert.equal(plan.structMemConsolidation.write, true);
    assert.equal(plan.sessionChunks.write, true);
    assert.equal(plan.durableMemory.write, true);
    assert.equal(plan.summaryCompact.write, true);
    assert.deepEqual(plan.skippedReasons, {});
    assert.deepEqual(plan.signalCounts, {
      memoryFacts: 2,
      crossSessionMemoryFacts: 1,
      currentSessionMemoryFacts: 1,
      nativeStructMemEntries: 0,
    });
  });

  it("centralizes skipped reasons for sandbox and writeback-disabled turns", () => {
    const plan = buildPostTurnWritePlan(
      { mode: "sandbox", writebackPolicy: "no_writeback" },
      {
        STRUCTMEM_ENABLED: true,
        STRUCTMEM_CONSOLIDATION_ENABLED: true,
        STRUCTMEM_SUPPRESS_EXTRACTOR_SESSION_CHUNKS: false,
        STRUCTMEM_NATIVE_EXTRACTOR: false,
      },
      {
        memoryFacts: [candidate("cross_session")],
        structMemEntries: [],
        shouldWriteMemory: false,
      },
    );

    assert.equal(plan.rawChunk.write, true);
    assert.equal(plan.structMem.write, false);
    assert.equal(plan.structMemConsolidation.write, false);
    assert.equal(plan.sessionChunks.write, false);
    assert.equal(plan.durableMemory.write, false);
    assert.equal(plan.summaryCompact.write, true);
    assert.deepEqual(plan.skippedReasons, {
      structMem: "sandbox_session",
      structMemConsolidation: "sandbox_session",
      sessionChunks: "sandbox_session",
      durableMemory: "writeback_disabled",
    });
  });

  it("records StructMem suppression as the session chunk skip reason", () => {
    const plan = buildPostTurnWritePlan(
      { mode: "story", writebackPolicy: "default" },
      {
        STRUCTMEM_ENABLED: true,
        STRUCTMEM_CONSOLIDATION_ENABLED: false,
        STRUCTMEM_SUPPRESS_EXTRACTOR_SESSION_CHUNKS: true,
        STRUCTMEM_NATIVE_EXTRACTOR: false,
      },
      {
        memoryFacts: [candidate("current_session")],
        structMemEntries: [],
        shouldWriteMemory: true,
      },
    );

    assert.equal(plan.sessionChunks.write, false);
    assert.equal(
      plan.skippedReasons.sessionChunks,
      "suppressed_by_structmem_policy",
    );
    assert.equal(plan.durableMemory.write, false);
    assert.equal(
      plan.skippedReasons.durableMemory,
      "no_cross_session_memory_facts",
    );
  });
});

function candidate(memoryScope: MemoryCandidate["memoryScope"]): MemoryCandidate {
  return {
    memoryType: "banter",
    summary: `${memoryScope} memory`,
    importanceScore: 0.5,
    emotionScore: 0.2,
    embedding: [0.1, 0.2],
    memoryScope,
  };
}
