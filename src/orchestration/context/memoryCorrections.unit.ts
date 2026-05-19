import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  formatMemoryCorrections,
  retrieveActiveCorrections,
} from "./memoryCorrections";
import type { SessionSummary } from "../../db/schema/memory";

function summary(summaryJson: unknown): SessionSummary {
  return {
    id: "sum1",
    sessionId: "s1",
    characterId: "c1",
    playerId: "p1",
    lastSummarizedTurnIndex: 10,
    summaryJson,
    summaryText: "",
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

describe("memory corrections", () => {
  it("extracts corrections from structured session summary JSON", () => {
    const corrections = retrieveActiveCorrections(
      summary({
        currentSituation: "",
        establishedFacts: [],
        relationshipState: { emotionalTone: "" },
        userPreferences: [],
        openThreads: [],
        decisionsAndCommitments: [],
        contradictionsOrCorrections: [
          {
            oldClaim: "old",
            correctedClaim: "new",
            sourceTurnIndex: 4,
          },
        ],
      }),
    );

    assert.deepEqual(corrections, [
      {
        oldClaim: "old",
        correctedClaim: "new",
        sourceTurnIndex: 4,
      },
    ]);
  });

  it("formats corrections for prompt injection", () => {
    const text = formatMemoryCorrections([
      {
        oldClaim: "old",
        correctedClaim: "new",
        sourceTurnIndex: 4,
      },
    ]);

    assert.match(text, /MEMORY|explicit corrections|Replace/);
    assert.match(text, /old/);
    assert.match(text, /new/);
  });
});
