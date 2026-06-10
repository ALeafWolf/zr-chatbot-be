import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { collectPhase1StructMemPersistRows, mapMemoryCandidateToStructMemEntryType } from "./structmemMapping";
import type { MemoryCandidate } from "../interactive/writeInteractiveMemory";

function baseCandidate(overrides: Partial<MemoryCandidate> = {}): MemoryCandidate { return { memoryType: "banter", summary: "test", importanceScore: 0.6, emotionScore: 0, embedding: [0.1], ...overrides }; }

describe("structmemMapping", () => {
  it("maps entry types: explicit sessionChunkType, default scene_moment, null for cross_session", () => {
    assert.equal(mapMemoryCandidateToStructMemEntryType(baseCandidate({ memoryScope: "current_session", sessionChunkType: "decision" })), "decision", "explicit decision");
    assert.equal(mapMemoryCandidateToStructMemEntryType(baseCandidate({ memoryScope: "current_session" })), "scene_moment", "default scene_moment");
    assert.equal(mapMemoryCandidateToStructMemEntryType(baseCandidate({ memoryScope: "cross_session", sessionChunkType: "scene_moment" })), null, "cross_session → null");
    assert.equal(mapMemoryCandidateToStructMemEntryType(baseCandidate({})), "scene_moment", "omitted memoryScope → scene_moment");
  });

  it("collectPhase1StructMemPersistRows filters to current_session only", () => {
    const facts: MemoryCandidate[] = [baseCandidate({ memoryScope: "current_session", sessionChunkType: "open_thread", summary: "a" }), baseCandidate({ memoryScope: "cross_session", summary: "b" })];
    const rows = collectPhase1StructMemPersistRows(facts);
    assert.equal(rows.length, 1, "count");
    assert.equal(rows[0]!.entryType, "open_thread", "entryType");
    assert.equal(rows[0]!.text, "a", "text");
    assert.equal(rows[0]!.metadata?.memoryType, "banter", "memoryType");
  });
});
