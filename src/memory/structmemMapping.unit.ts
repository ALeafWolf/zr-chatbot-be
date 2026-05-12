import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  collectMappedStructMemCandidates,
  mapMemoryCandidateToStructMemEntryType,
} from "./structmemMapping";
import type { MemoryCandidate } from "./writeInteractiveMemory";

function baseCandidate(
  overrides: Partial<MemoryCandidate> = {},
): MemoryCandidate {
  return {
    memoryType: "banter",
    summary: "test",
    importanceScore: 0.6,
    emotionScore: 0,
    embedding: [0.1],
    ...overrides,
  };
}

describe("structmemMapping", () => {
  it("maps current_session with explicit sessionChunkType", () => {
    assert.equal(
      mapMemoryCandidateToStructMemEntryType(
        baseCandidate({
          memoryScope: "current_session",
          sessionChunkType: "decision",
        }),
      ),
      "decision",
    );
  });

  it("defaults missing sessionChunkType to scene_moment for current_session", () => {
    assert.equal(
      mapMemoryCandidateToStructMemEntryType(
        baseCandidate({ memoryScope: "current_session" }),
      ),
      "scene_moment",
    );
  });

  it("returns null for cross_session", () => {
    assert.equal(
      mapMemoryCandidateToStructMemEntryType(
        baseCandidate({ memoryScope: "cross_session", sessionChunkType: "scene_moment" }),
      ),
      null,
    );
  });

  it("defaults omitted memoryScope to cross_session mapping => null StructMem entry", () => {
    assert.equal(
      mapMemoryCandidateToStructMemEntryType(baseCandidate({})),
      null,
    );
  });

  it("collectMappedStructMemCandidates filters to current_session only", () => {
    const facts: MemoryCandidate[] = [
      baseCandidate({
        memoryScope: "current_session",
        sessionChunkType: "open_thread",
        summary: "a",
      }),
      baseCandidate({
        memoryScope: "cross_session",
        summary: "b",
      }),
    ];
    const mapped = collectMappedStructMemCandidates(facts);
    assert.equal(mapped.length, 1);
    assert.equal(mapped[0]!.entryType, "open_thread");
    assert.equal(mapped[0]!.candidate.summary, "a");
  });
});
