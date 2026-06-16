import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildPostTurnWritePlan, shouldSuppressExtractorSessionChunks } from "./postTurnPolicies";
import type { MemoryCandidate } from "../memory/interactive/writeInteractiveMemory";

function candidate(memoryScope: MemoryCandidate["memoryScope"]): MemoryCandidate {
  return { memoryType: "banter", summary: `${memoryScope} memory`, importanceScore: 0.5, emotionScore: 0.2, embedding: [0.1, 0.2], memoryScope };
}

describe("postTurnPolicies", () => {
  it("shouldSuppressExtractorSessionChunks returns correct boolean per combination", () => {
    const cases = [
      { name: "no suppress when StructMem disabled", input: { structMemEnabled: false, suppressExtractorSessionChunks: true, nativeStructMemExtractor: true }, expected: false },
      { name: "suppress on Phase 1 flag", input: { structMemEnabled: true, suppressExtractorSessionChunks: true, nativeStructMemExtractor: false }, expected: true },
      { name: "suppress on Phase 2 native path", input: { structMemEnabled: true, suppressExtractorSessionChunks: false, nativeStructMemExtractor: true }, expected: true },
      { name: "keep legacy when both off", input: { structMemEnabled: true, suppressExtractorSessionChunks: false, nativeStructMemExtractor: false }, expected: false },
    ];
    for (const c of cases) {
      assert.equal(shouldSuppressExtractorSessionChunks(c.input), c.expected, c.name);
    }
  });

  it("buildPostTurnWritePlan handles normal, sandbox, and structmem suppression scenarios", () => {

    // Normal plan
    let plan = buildPostTurnWritePlan({ mode: "story", writebackPolicy: "default" }, { STRUCTMEM_ENABLED: true, STRUCTMEM_CONSOLIDATION_ENABLED: true, STRUCTMEM_SUPPRESS_EXTRACTOR_SESSION_CHUNKS: false, STRUCTMEM_NATIVE_EXTRACTOR: false }, { memoryFacts: [candidate("cross_session"), candidate("current_session")], structMemEntries: [], shouldWriteMemory: true });
    assert.equal(plan.rawChunk.write, true, "normal — rawChunk");
    assert.equal(plan.structMem.write, true, "normal — structMem");
    assert.equal(plan.structMemConsolidation.write, true, "normal — structMemConsol");
    assert.equal(plan.sessionChunks.write, true, "normal — sessionChunks");
    assert.equal(plan.durableMemory.write, true, "normal — durable");
    assert.equal(plan.summaryCompact.write, true, "normal — summary");
    assert.deepEqual(plan.skippedReasons, {}, "normal — no skips");
    assert.deepEqual(plan.signalCounts, { memoryFacts: 2, crossSessionMemoryFacts: 1, currentSessionMemoryFacts: 1, nativeStructMemEntries: 0 }, "normal — counts");

    // Sandbox / writeback-disabled
    plan = buildPostTurnWritePlan({ mode: "sandbox", writebackPolicy: "no_writeback" }, { STRUCTMEM_ENABLED: true, STRUCTMEM_CONSOLIDATION_ENABLED: true, STRUCTMEM_SUPPRESS_EXTRACTOR_SESSION_CHUNKS: false, STRUCTMEM_NATIVE_EXTRACTOR: false }, { memoryFacts: [candidate("cross_session")], structMemEntries: [], shouldWriteMemory: false });
    assert.equal(plan.rawChunk.write, true, "sandbox — rawChunk");
    assert.equal(plan.structMem.write, false, "sandbox — structMem");
    assert.equal(plan.structMemConsolidation.write, false, "sandbox — structMemConsol");
    assert.equal(plan.sessionChunks.write, false, "sandbox — sessionChunks");
    assert.equal(plan.durableMemory.write, false, "sandbox — durable");
    assert.equal(plan.summaryCompact.write, false, "sandbox — summary");
    assert.deepEqual(plan.skippedReasons, { structMem: "sandbox_session", structMemConsolidation: "sandbox_session", sessionChunks: "sandbox_session", durableMemory: "writeback_disabled", summaryCompact: "sandbox_session" }, "sandbox — skips");

    // StructMem suppression
    plan = buildPostTurnWritePlan({ mode: "story", writebackPolicy: "default" }, { STRUCTMEM_ENABLED: true, STRUCTMEM_CONSOLIDATION_ENABLED: false, STRUCTMEM_SUPPRESS_EXTRACTOR_SESSION_CHUNKS: true, STRUCTMEM_NATIVE_EXTRACTOR: false }, { memoryFacts: [candidate("current_session")], structMemEntries: [], shouldWriteMemory: true });
    assert.equal(plan.sessionChunks.write, false, "structmem_supp — sessionChunks");
    assert.equal(plan.skippedReasons.sessionChunks, "suppressed_by_structmem_policy", "structmem_supp — reason");
    assert.equal(plan.durableMemory.write, false, "structmem_supp — durable");
    assert.equal(plan.skippedReasons.durableMemory, "no_cross_session_memory_facts", "structmem_supp — durable reason");
  });
});
