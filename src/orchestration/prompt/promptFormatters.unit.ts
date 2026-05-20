import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { formatStructMemEntriesForPrompt } from "./promptFormatters";
import type { RetrievedStructMemEntry } from "../../retrieval/memory/retrieveStructMemEntries";

const entry: RetrievedStructMemEntry = {
  id: "entry-1",
  eventId: "event-1",
  turnIndex: 4,
  entryType: "decision",
  text: "They agreed to revisit the question later.",
  importanceScore: 0.8,
  confidenceScore: 0.8,
  cosineSimilarity: 0.8,
  finalScore: 0.8,
};

describe("formatStructMemEntriesForPrompt", () => {
  it("renders compact context expansion when present", () => {
    const text = formatStructMemEntriesForPrompt([entry], [
      {
        entryId: "entry-1",
        eventId: "event-1",
        messages: [
          { turnIndex: 3, role: "user", content: "Can we talk later?" },
          { turnIndex: 4, role: "assistant", content: "Yes, we will." },
        ],
      },
    ]);

    assert.match(text, /Context:/);
    assert.match(text, /turn 3 user: Can we talk later\?/);
    assert.match(text, /turn 4 assistant: Yes, we will\./);
  });

  it("does not render context for unexpanded entries", () => {
    const text = formatStructMemEntriesForPrompt([entry], []);
    assert.equal(text.includes("Context:"), false);
  });
});
