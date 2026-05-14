import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  retrieveSummaryOpenThreads,
  scoreStructMemOpenThread,
  sortOpenThreads,
  type RetrievedOpenThread,
} from "./retrieveOpenThreads";

describe("open-thread retrieval helpers", () => {
  it("keeps open and paused summary threads but excludes resolved", () => {
    const threads = retrieveSummaryOpenThreads({
      id: "summary-1",
      sessionId: "s1",
      characterId: "c1",
      playerId: "p1",
      lastSummarizedTurnIndex: 10,
      summaryJson: {
        currentSituation: "",
        establishedFacts: [],
        relationshipState: { emotionalTone: "" },
        userPreferences: [],
        openThreads: [
          { thread: "answer the question", status: "open", sourceTurnIndex: 2 },
          { thread: "wait for later", status: "paused", sourceTurnIndex: 4 },
          { thread: "done", status: "resolved", sourceTurnIndex: 6 },
        ],
        decisionsAndCommitments: [],
        contradictionsOrCorrections: [],
      },
      summaryText: "",
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    assert.deepEqual(
      threads.map((thread) => thread.text),
      ["answer the question", "wait for later"],
    );
  });

  it("sorts StructMem-style open threads by score and then recency", () => {
    const low: RetrievedOpenThread = {
      id: "low",
      source: "structmem_entry",
      text: "low",
      status: "open",
      sourceTurnIndex: 8,
      score: scoreStructMemOpenThread({
        turnIndex: 8,
        latestFrontierTurnIndex: 20,
        importanceScore: 0.2,
        confidenceScore: 0.2,
      }),
    };
    const high: RetrievedOpenThread = {
      id: "high",
      source: "structmem_entry",
      text: "high",
      status: "open",
      sourceTurnIndex: 2,
      score: scoreStructMemOpenThread({
        turnIndex: 2,
        latestFrontierTurnIndex: 20,
        importanceScore: 0.9,
        confidenceScore: 0.8,
      }),
    };

    assert.deepEqual(
      sortOpenThreads([low, high]).map((thread) => thread.id),
      ["high", "low"],
    );
  });
});
