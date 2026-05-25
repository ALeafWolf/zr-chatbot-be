import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildRerankAssertionContext } from "./evalAssertions";

describe("buildRerankAssertionContext", () => {
  it("returns undefined when rerank is null", () => {
    assert.equal(buildRerankAssertionContext(null), undefined);
  });

  it("returns undefined when rerank is undefined", () => {
    assert.equal(buildRerankAssertionContext(undefined), undefined);
  });

  it("maps selected items to selectedIds and selectedSources", () => {
    const result = buildRerankAssertionContext({
      selected: [
        { id: "mem_1", source: "interactive_memory" },
        { id: "mem_2", source: "session_chunk" },
      ],
      finalContextMode: "selected_memory",
      fallbackUsed: false,
    });

    assert.deepEqual(result?.rerank.selectedIds, ["mem_1", "mem_2"]);
    assert.deepEqual(result?.rerank.selectedSources, [
      "interactive_memory",
      "session_chunk",
    ]);
  });

  it("maps finalContextMode and fallbackUsed", () => {
    const result = buildRerankAssertionContext({
      selected: [],
      finalContextMode: "recent_only",
      fallbackUsed: true,
    });

    assert.equal(result?.rerank.finalContextMode, "recent_only");
    assert.equal(result?.rerank.fallbackUsed, true);
  });

  it("handles empty selected array", () => {
    const result = buildRerankAssertionContext({
      selected: [],
      finalContextMode: "selected_memory",
      fallbackUsed: false,
    });

    assert.deepEqual(result?.rerank.selectedIds, []);
    assert.deepEqual(result?.rerank.selectedSources, []);
  });

  it("omits fields not present on the snapshot", () => {
    const result = buildRerankAssertionContext({
      selected: [{ id: "mem_1", source: "interactive_memory" }],
    });

    assert.deepEqual(result?.rerank.selectedIds, ["mem_1"]);
    assert.equal(result?.rerank.finalContextMode, undefined);
    assert.equal(result?.rerank.fallbackUsed, undefined);
  });
});
