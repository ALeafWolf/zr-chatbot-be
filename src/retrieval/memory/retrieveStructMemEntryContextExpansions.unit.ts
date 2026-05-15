import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  isStructMemEntryExpansionEligible,
  selectStructMemEntriesForExpansion,
} from "./retrieveStructMemEntryContextExpansions";
import type { RetrievedStructMemEntry } from "./retrieveStructMemEntries";

function entry(
  id: string,
  entryType: string,
  text: string,
): RetrievedStructMemEntry {
  return {
    id,
    eventId: `event-${id}`,
    turnIndex: 1,
    entryType,
    text,
    importanceScore: 0.9,
    confidenceScore: 0.9,
    cosineSimilarity: 0.9,
    finalScore: 0.9,
  };
}

describe("StructMem entry context expansion selection", () => {
  it("selects open threads decisions emotional shifts and short entries", () => {
    assert.equal(
      isStructMemEntryExpansionEligible(entry("o", "open_thread", "long text")),
      true,
    );
    assert.equal(
      isStructMemEntryExpansionEligible(entry("d", "decision", "long text")),
      true,
    );
    assert.equal(
      isStructMemEntryExpansionEligible(
        entry("e", "emotional_shift", "long text"),
      ),
      true,
    );
    assert.equal(
      isStructMemEntryExpansionEligible(entry("s", "factual", "short")),
      true,
    );
    assert.equal(
      isStructMemEntryExpansionEligible(
        entry("l", "factual", "x".repeat(300)),
      ),
      false,
    );
  });

  it("caps selected entries and reports dropped budget", () => {
    const result = selectStructMemEntriesForExpansion(
      [
        entry("1", "decision", "one"),
        entry("2", "decision", "two"),
        entry("3", "decision", "three"),
        entry("4", "decision", "four"),
      ],
      3,
    );

    assert.deepEqual(result.selected.map((item) => item.id), [
      "1",
      "2",
      "3",
    ]);
    assert.deepEqual(result.diagnostics, {
      eligibleCount: 4,
      expandedCount: 3,
      droppedByBudgetCount: 1,
    });
  });
});
