import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  selectPromptMemoryContext,
  type PromptMemorySelectionDiagnostics,
} from "./promptMemoryContextSelector";
import type { RetrievalPlan } from "./retrievalPlan";
import type { ConversationTurn } from "../retrieval/conversation/getRecentConversationWindow";
import type { RetrievedMemory } from "../retrieval/memory/retrieveInteractiveMemories";
import type { RetrievedOpenThread } from "../retrieval/memory/retrieveOpenThreads";
import type { RetrievedSessionMemoryChunk } from "../retrieval/memory/retrieveSessionMemoryChunks";
import type { RetrievedStructMemEntry } from "../retrieval/memory/retrieveStructMemEntries";
import type { RetrievedStructMemConsolidation } from "../retrieval/memory/retrieveStructMemConsolidations";

const retrievalPlan: RetrievalPlan = {
  intent: "general",
  broadFailOpen: false,
  canonMode: "full",
  forceOpenThreads: false,
  durableMemoryTopK: 2,
  sessionRecallTopK: 2,
  structMemEntryTopK: 2,
  structMemConsolidationTopK: 2,
  openThreadTopK: 2,
};

function select(input: {
  memories?: RetrievedMemory[];
  sessionRecall?: RetrievedSessionMemoryChunk[];
  structMemEntries?: RetrievedStructMemEntry[];
  structMemConsolidations?: RetrievedStructMemConsolidation[];
  openThreads?: RetrievedOpenThread[];
  recentTurns?: ConversationTurn[];
  plan?: RetrievalPlan;
  memoryCorrections?: Array<{
    oldClaim: string;
    correctedClaim: string;
    sourceTurnIndex: number;
  }>;
}): PromptMemorySelectionDiagnostics {
  return selectPromptMemoryContext({
    memories: input.memories ?? [],
    sessionRecall: input.sessionRecall ?? [],
    structMemEntries: input.structMemEntries ?? [],
    structMemConsolidations: input.structMemConsolidations ?? [],
    openThreads: input.openThreads ?? [],
    recentTurns: input.recentTurns ?? [],
    retrievalPlan: input.plan ?? retrievalPlan,
    memoryCorrections: input.memoryCorrections,
  }).diagnostics;
}

function chunk(id: string, turnStart: number, turnEnd: number, score: number) {
  return {
    id,
    turnStart,
    turnEnd,
    chunkText: `chunk ${id}`,
    chunkType: "scene_moment",
    cosineSimilarity: score,
    finalScore: score,
  } satisfies RetrievedSessionMemoryChunk;
}

function entry(id: string, turnIndex: number, score: number) {
  return {
    id,
    eventId: `event-${id}`,
    turnIndex,
    entryType: "factual",
    text: `entry ${id}`,
    importanceScore: score,
    confidenceScore: score,
    cosineSimilarity: score,
    finalScore: score,
  } satisfies RetrievedStructMemEntry;
}

describe("selectPromptMemoryContext", () => {
  it("applies source caps while preserving result shapes", () => {
    const result = selectPromptMemoryContext({
      memories: [],
      sessionRecall: [chunk("c1", 1, 1, 0.9), chunk("c2", 2, 2, 0.8), chunk("c3", 3, 3, 0.7)],
      structMemEntries: [],
      structMemConsolidations: [],
      openThreads: [],
      recentTurns: [],
      retrievalPlan: { ...retrievalPlan, sessionRecallTopK: 2 },
    });
    assert.deepEqual(result.sessionRecall.map((c) => c.id), ["c1", "c2"]);
    assert.equal(result.diagnostics.injectedCounts.session_chunk, 2);
  });

  it("drops low-score candidates", () => {
    const diagnostics = select({
      sessionRecall: [chunk("low", 1, 1, 0.1)],
    });
    assert.equal(diagnostics.injectedCounts.session_chunk, 0);
    assert.equal(diagnostics.droppedLowScoreCount, 1);
  });

  it("drops older recall fully covered by recent chat", () => {
    const diagnostics = select({
      sessionRecall: [chunk("covered", 10, 11, 0.9)],
      recentTurns: [
        { turnIndex: 10, role: "user", content: "u" },
        { turnIndex: 11, role: "assistant", content: "a" },
      ],
    });
    assert.equal(diagnostics.injectedCounts.session_chunk, 0);
    assert.equal(diagnostics.droppedDuplicateCount, 1);
  });

  it("prefers StructMem entries over overlapping session chunks", () => {
    const result = selectPromptMemoryContext({
      memories: [],
      sessionRecall: [chunk("chunk", 3, 3, 0.95)],
      structMemEntries: [entry("entry", 3, 0.8)],
      structMemConsolidations: [],
      openThreads: [],
      recentTurns: [],
      retrievalPlan,
    });
    assert.deepEqual(result.structMemEntries.map((e) => e.id), ["entry"]);
    assert.deepEqual(result.sessionRecall.map((c) => c.id), []);
    assert.equal(result.diagnostics.droppedDuplicateCount, 1);
  });

  it("keeps open threads ahead of same-turn entries", () => {
    const result = selectPromptMemoryContext({
      memories: [],
      sessionRecall: [],
      structMemEntries: [entry("entry", 5, 0.95)],
      structMemConsolidations: [],
      openThreads: [
        {
          id: "thread",
          source: "session_summary",
          text: "pending answer",
          status: "open",
          sourceTurnIndex: 5,
          score: 0.5,
        },
      ],
      recentTurns: [],
      retrievalPlan,
    });
    assert.deepEqual(result.openThreads.map((t) => t.id), ["thread"]);
    assert.deepEqual(result.structMemEntries.map((e) => e.id), []);
  });

  it("reports top sources and average injected score", () => {
    const diagnostics = select({
      memories: [
        {
          id: "m1",
          memoryType: "promise",
          summary: "memory",
          importanceScore: 1,
          emotionScore: 1,
          reuseCount: 0,
          cosineSimilarity: 0.8,
        },
      ],
    });
    assert.deepEqual(diagnostics.topSources, ["interactive_memory"]);
    assert.equal(typeof diagnostics.averageInjectedScore, "number");
  });

  it("drops durable and StructMem candidates that conflict with corrections", () => {
    const diagnostics = select({
      memories: [
        {
          id: "m1",
          memoryType: "promise",
          summary: "The meeting is tomorrow.",
          importanceScore: 1,
          emotionScore: 1,
          reuseCount: 0,
          cosineSimilarity: 0.8,
        },
      ],
      structMemEntries: [entry("entry", 1, 0.9)],
      memoryCorrections: [
        {
          oldClaim: "the meeting is tomorrow",
          correctedClaim: "the meeting is Friday",
          sourceTurnIndex: 10,
        },
        {
          oldClaim: "entry entry",
          correctedClaim: "corrected entry",
          sourceTurnIndex: 11,
        },
      ],
    });

    assert.equal(diagnostics.injectedCounts.interactive_memory, 0);
    assert.equal(diagnostics.injectedCounts.structmem_entry, 0);
    assert.equal(diagnostics.droppedCorrectionCount, 2);
  });
});
