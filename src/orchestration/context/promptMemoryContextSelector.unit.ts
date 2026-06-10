import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { selectPromptMemoryContext } from "./promptMemoryContextSelector";
import type { RetrievalPlan } from "../retrieval/retrievalPlan";

const retrievalPlan: RetrievalPlan = { intent: "general", broadFailOpen: false, canonMode: "full", forceOpenThreads: false, durableMemoryTopK: 2, sessionRecallTopK: 2, structMemEntryTopK: 2, structMemConsolidationTopK: 2, openThreadTopK: 2, contextNeed: { needsRecentTurns: true, needsOlderSessionRecall: false, needsDurableMemory: true, needsStructMem: false, needsStructMemConsolidation: false, needsCanon: false, needsWeb: false, injectionMode: "full", reason: "unit_test_fixture" } };

function chunk(id: string, turnStart: number, turnEnd: number, score: number) { return { id, turnStart, turnEnd, chunkText: `chunk ${id}`, chunkType: "scene_moment", cosineSimilarity: score, finalScore: score } as const; }
function entry(id: string, turnIndex: number, score: number) { return { id, eventId: `event-${id}`, turnIndex, entryType: "factual", text: `entry ${id}`, importanceScore: score, confidenceScore: score, cosineSimilarity: score, finalScore: score } as const; }

describe("selectPromptMemoryContext", () => {
  it("applies source caps, drops low-score/duplicate/correction-conflicting, prefers structmem, keeps open threads, reports diagnostics", () => {
    // source caps
    let r = selectPromptMemoryContext({ memories: [], sessionRecall: [chunk("c1", 1, 1, 0.9), chunk("c2", 2, 2, 0.8), chunk("c3", 3, 3, 0.7)], structMemEntries: [], structMemConsolidations: [], openThreads: [], recentTurns: [], retrievalPlan: { ...retrievalPlan, sessionRecallTopK: 2 } });
    assert.deepEqual(r.sessionRecall.map((c) => c.id), ["c1", "c2"], "capped to 2");
    assert.equal(r.diagnostics.injectedCounts.session_chunk, 2, "injected count");

    // low score drop
    r = selectPromptMemoryContext({ memories: [], sessionRecall: [chunk("low", 1, 1, 0.1)], structMemEntries: [], structMemConsolidations: [], openThreads: [], recentTurns: [], retrievalPlan });
    assert.equal(r.diagnostics.injectedCounts.session_chunk, 0, "low score dropped");
    assert.equal(r.diagnostics.droppedLowScoreCount, 1, "drop counted");

    // duplicate drop (older recall covered by recent turns)
    r = selectPromptMemoryContext({ memories: [], sessionRecall: [chunk("covered", 10, 11, 0.9)], structMemEntries: [], structMemConsolidations: [], openThreads: [], recentTurns: [{ turnIndex: 10, role: "user", content: "u" }, { turnIndex: 11, role: "assistant", content: "a" }], retrievalPlan });
    assert.equal(r.diagnostics.injectedCounts.session_chunk, 0, "duplicate dropped");
    assert.equal(r.diagnostics.droppedDuplicateCount, 1, "drop counted");

    // structmem preferred over overlapping session chunks
    r = selectPromptMemoryContext({ memories: [], sessionRecall: [chunk("chunk", 3, 3, 0.95)], structMemEntries: [entry("entry", 3, 0.8)], structMemConsolidations: [], openThreads: [], recentTurns: [], retrievalPlan });
    assert.deepEqual(r.structMemEntries.map((e) => e.id), ["entry"], "structmem wins");
    assert.deepEqual(r.sessionRecall.map((c) => c.id), [], "chunk dropped");
    assert.equal(r.diagnostics.droppedDuplicateCount, 1, "drop counted");

    // open thread kept ahead of same-turn entry
    r = selectPromptMemoryContext({ memories: [], sessionRecall: [], structMemEntries: [entry("entry", 5, 0.95)], structMemConsolidations: [], openThreads: [{ id: "thread", source: "session_summary", text: "pending answer", status: "open", sourceTurnIndex: 5, score: 0.5 }], recentTurns: [], retrievalPlan });
    assert.deepEqual(r.openThreads.map((t) => t.id), ["thread"], "open thread kept");
    assert.deepEqual(r.structMemEntries.map((e) => e.id), [], "entry dropped");

    // reports top sources and average injected score
    r = selectPromptMemoryContext({ memories: [{ id: "m1", memoryType: "promise", summary: "memory", importanceScore: 1, emotionScore: 1, reuseCount: 0, cosineSimilarity: 0.8 }], sessionRecall: [], structMemEntries: [], structMemConsolidations: [], openThreads: [], recentTurns: [], retrievalPlan });
    assert.deepEqual(r.diagnostics.topSources, ["interactive_memory"], "top sources");
    assert.equal(typeof r.diagnostics.averageInjectedScore, "number", "avg score");

    // correction conflicts
    r = selectPromptMemoryContext({ memories: [{ id: "m1", memoryType: "promise", summary: "The meeting is tomorrow.", importanceScore: 1, emotionScore: 1, reuseCount: 0, cosineSimilarity: 0.8 }], sessionRecall: [], structMemEntries: [entry("entry", 1, 0.9)], structMemConsolidations: [], openThreads: [], recentTurns: [], retrievalPlan, memoryCorrections: [{ oldClaim: "the meeting is tomorrow", correctedClaim: "the meeting is Friday", sourceTurnIndex: 10 }, { oldClaim: "entry entry", correctedClaim: "corrected entry", sourceTurnIndex: 11 }] });
    assert.equal(r.diagnostics.injectedCounts.interactive_memory, 0, "memory dropped by correction");
    assert.equal(r.diagnostics.injectedCounts.structmem_entry, 0, "entry dropped by correction");
    assert.equal(r.diagnostics.droppedCorrectionCount, 2, "correction count");
  });
});
