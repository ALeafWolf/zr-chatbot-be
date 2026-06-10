import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildRerankAssertionContext } from "./evalAssertions";

describe("buildRerankAssertionContext", () => {
  it("returns undefined for null/undefined rerank, maps selectedIds/sources/finalContextMode/fallbackUsed, handles empty/omitted", () => {
    assert.equal(buildRerankAssertionContext(null), undefined, "null → undefined");
    assert.equal(buildRerankAssertionContext(undefined), undefined, "undefined → undefined");

    let r = buildRerankAssertionContext({ selected: [{ id: "mem_1", source: "interactive_memory" }, { id: "mem_2", source: "session_chunk" }], finalContextMode: "selected_memory", fallbackUsed: false } as any);
    assert.deepEqual(r?.rerank.selectedIds, ["mem_1", "mem_2"], "selectedIds");
    assert.deepEqual(r?.rerank.selectedSources, ["interactive_memory", "session_chunk"], "selectedSources");
    assert.equal(r?.rerank.finalContextMode, "selected_memory", "finalContextMode");
    assert.equal(r?.rerank.fallbackUsed, false, "fallbackUsed");

    r = buildRerankAssertionContext({ selected: [], finalContextMode: "recent_only", fallbackUsed: true } as any);
    assert.deepEqual(r?.rerank.selectedIds, [], "empty selectedIds");
    assert.deepEqual(r?.rerank.selectedSources, [], "empty selectedSources");
    assert.equal(r?.rerank.finalContextMode, "recent_only", "finalContextMode with empty");
    assert.equal(r?.rerank.fallbackUsed, true, "fallbackUsed with empty");

    r = buildRerankAssertionContext({ selected: [{ id: "mem_1", source: "interactive_memory" }] } as any);
    assert.deepEqual(r?.rerank.selectedIds, ["mem_1"], "selectedIds without extra fields");
    assert.equal(r?.rerank.finalContextMode, undefined, "finalContextMode omitted when absent");
    assert.equal(r?.rerank.fallbackUsed, undefined, "fallbackUsed omitted when absent");
  });
});
