import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { hybridScoreSelect } from "./hybridScoreRerank";
import type { ContextCandidate } from "./contextCandidates";

describe("hybridScoreSelect", () => {
  const makeCandidate = (
    id: string,
    source: ContextCandidate["source"],
    score: number | null = 0.5,
  ): ContextCandidate => ({
    id,
    source,
    text: `text for ${id}`,
    score,
  });

  it("returns empty selection for empty candidates", () => {
    const { selected } = hybridScoreSelect([], "scene_continuation");
    assert.equal(selected.length, 0);
  });

  it("selects candidates sorted by source priority when scores are equal", () => {
    const candidates = [
      makeCandidate("canon_1", "canon_chunk", 0.8),
      makeCandidate("mem_1", "interactive_memory", 0.8),
      makeCandidate("sc_1", "session_chunk", 0.8),
    ];
    const { selected } = hybridScoreSelect(candidates, "scene_continuation");
    // session_chunk (priority 7) should come before interactive_memory (8) and canon_chunk (9)
    const indices = selected.map((c) => c.id);
    assert.equal(indices[0], "sc_1");
    assert.equal(indices[1], "mem_1");
    assert.equal(indices[2], "canon_1");
  });

  it("prefers higher score within same source priority", () => {
    const candidates = [
      makeCandidate("mem_low", "interactive_memory", 0.3),
      makeCandidate("mem_high", "interactive_memory", 0.9),
    ];
    const { selected } = hybridScoreSelect(candidates, "scene_continuation");
    assert.ok(selected.length >= 1);
    // Higher-scored item should appear first
    const highIdx = selected.findIndex((c) => c.id === "mem_high");
    const lowIdx = selected.findIndex((c) => c.id === "mem_low");
    assert.ok(highIdx < lowIdx, "higher-scored item should be selected before lower-scored item");
  });

  it("includes intent-required sources for explicit_recall", () => {
    const candidates = [
      makeCandidate("canon_1", "canon_chunk", 0.9),
      makeCandidate("mem_1", "interactive_memory", 0.5),
      makeCandidate("sc_1", "session_chunk", 0.5),
      makeCandidate("struct_1", "structmem_entry", 0.5),
    ];
    const { selected } = hybridScoreSelect(candidates, "explicit_recall");
    const selectedIds = selected.map((c) => c.id);
    // interactive_memory and structmem_entry should be selected (intent-required)
    assert.ok(selectedIds.includes("mem_1"), "interactive_memory should be selected for explicit_recall");
    assert.ok(selectedIds.includes("struct_1"), "structmem_entry should be selected for explicit_recall");
  });

  it("includes canon for canon_question intent", () => {
    const candidates = [
      makeCandidate("canon_1", "canon_chunk", 0.5),
      makeCandidate("mem_1", "interactive_memory", 0.9), // high score but not canon
    ];
    const { selected } = hybridScoreSelect(candidates, "canon_question");
    const selectedIds = selected.map((c) => c.id);
    assert.ok(selectedIds.includes("canon_1"), "canon should be selected for canon_question");
  });

  it("applies per-source caps", () => {
    const candidates = Array.from({ length: 10 }, (_, i) =>
      makeCandidate(`struct_${i}`, "structmem_entry", 0.8),
    );
    const { selected } = hybridScoreSelect(candidates, "explicit_recall");
    // Cap for structmem_entry is 3
    const structCount = selected.filter((c) => c.source === "structmem_entry").length;
    assert.equal(structCount, 3);
  });

  it("applies total cap of 12", () => {
    const candidates = Array.from({ length: 20 }, (_, i) =>
      makeCandidate(`sc_${i}`, "session_chunk", 0.8),
    );
    const { selected } = hybridScoreSelect(candidates, "scene_continuation");
    assert.ok(selected.length <= 12);
  });

  it("selects canon chunk for canon_question intent", () => {
    const candidates = [
      makeCandidate("canon_1", "canon_chunk", 0.8),
    ];
    const { selected } = hybridScoreSelect(candidates, "canon_question");
    assert.ok(selected.some((c) => c.source === "canon_chunk"));
  });

  it("selects canon_fact for canon_question intent", () => {
    const candidates = [
      makeCandidate("fact_1", "canon_fact", 0.8),
      makeCandidate("mem_1", "interactive_memory", 0.9),
    ];
    const { selected } = hybridScoreSelect(candidates, "canon_question");
    const factSelected = selected.some((c) => c.source === "canon_fact");
    assert.ok(factSelected, "canon_fact should be selected for canon_question");
  });
});
