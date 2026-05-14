import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  consolidationEligibility,
  selectBufferEntries,
  selectSeedEntriesByEvent,
  type ConsolidationCandidateEntry,
} from "./structmemConsolidationSelection";

function entry(
  id: string,
  eventId: string,
  turnIndex: number,
): ConsolidationCandidateEntry {
  return {
    id,
    eventId,
    turnIndex,
    entryType: "factual",
    text: id,
  };
}

describe("structmemConsolidationSelection", () => {
  it("gates consolidation by flag, sandbox mode, and thresholds", () => {
    assert.equal(
      consolidationEligibility({
        enabled: false,
        sessionMode: "canonical_live",
        unconsolidatedTurnCount: 8,
        unconsolidatedEntryCount: 12,
        minTurns: 8,
        minEntries: 12,
      }),
      "disabled",
    );
    assert.equal(
      consolidationEligibility({
        enabled: true,
        sessionMode: "sandbox",
        unconsolidatedTurnCount: 8,
        unconsolidatedEntryCount: 12,
        minTurns: 8,
        minEntries: 12,
      }),
      "sandbox",
    );
    assert.equal(
      consolidationEligibility({
        enabled: true,
        sessionMode: "canonical_live",
        unconsolidatedTurnCount: 7,
        unconsolidatedEntryCount: 12,
        minTurns: 8,
        minEntries: 12,
      }),
      "below_threshold",
    );
    assert.equal(
      consolidationEligibility({
        enabled: true,
        sessionMode: "canonical_live",
        unconsolidatedTurnCount: 8,
        unconsolidatedEntryCount: 12,
        minTurns: 8,
        minEntries: 12,
      }),
      "eligible",
    );
  });

  it("selects the oldest bounded buffer entries", () => {
    const selected = selectBufferEntries(
      [entry("b", "e2", 4), entry("a", "e1", 2), entry("c", "e3", 3)],
      2,
    );
    assert.deepEqual(
      selected.map((x) => x.id),
      ["a", "c"],
    );
  });

  it("caps semantic seed entries by event and excludes buffer ids", () => {
    const selected = selectSeedEntriesByEvent(
      [
        entry("buffer", "e0", 1),
        entry("a1", "e1", 2),
        entry("a2", "e1", 2),
        entry("a3", "e1", 2),
        entry("b1", "e2", 3),
        entry("c1", "e3", 4),
      ],
      {
        bufferEntryIds: new Set(["buffer"]),
        maxSeedEvents: 2,
        maxEntriesPerEvent: 2,
      },
    );
    assert.deepEqual(
      selected.map((x) => x.id),
      ["a1", "a2", "b1"],
    );
  });
});

