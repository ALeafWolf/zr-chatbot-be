import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { formatMemoryCorrections, retrieveActiveCorrections } from "./memoryCorrections";
import type { SessionSummary } from "../../db/schema/memory";

function summary(summaryJson: unknown): SessionSummary { return { id: "sum1", sessionId: "s1", characterId: "c1", playerId: "p1", lastSummarizedTurnIndex: 10, summaryJson, summaryText: "", createdAt: new Date(), updatedAt: new Date() }; }

describe("memory corrections", () => {
  it("extracts corrections from session summary JSON and formats for prompt injection", () => {
    const corrections = retrieveActiveCorrections(summary({ currentSituation: "", establishedFacts: [], relationshipState: { emotionalTone: "" }, userPreferences: [], openThreads: [], decisionsAndCommitments: [], contradictionsOrCorrections: [{ oldClaim: "old", correctedClaim: "new", sourceTurnIndex: 4 }] }));
    assert.deepEqual(corrections, [{ oldClaim: "old", correctedClaim: "new", sourceTurnIndex: 4 }], "extracted");

    const text = formatMemoryCorrections(corrections);
    assert.match(text, /MEMORY|explicit corrections|Replace/, "formatted");
    assert.match(text, /old/, "contains old claim");
    assert.match(text, /new/, "contains new claim");
  });
});
