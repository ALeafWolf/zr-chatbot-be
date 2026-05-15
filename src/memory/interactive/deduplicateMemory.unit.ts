import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { decideMemoryDedupAction } from "./deduplicateMemory";
import type { MemoryDedupJudgeResult } from "../../llm/validation/runMemoryDedupJudge";

const sameJudge = async (): Promise<MemoryDedupJudgeResult> => ({
  decision: "same",
  matchingCandidateId: "ambiguous",
  usedFailOpen: false,
});

const distinctJudge = async (): Promise<MemoryDedupJudgeResult> => ({
  decision: "distinct",
  usedFailOpen: false,
});

describe("decideMemoryDedupAction", () => {
  it("deduplicates high-similarity candidates without the judge", async () => {
    let called = false;
    const result = await decideMemoryDedupAction({
      newMemorySummary: "new",
      candidates: [{ id: "near", summary: "old", cosineDistance: 0.05 }],
      judge: async () => {
        called = true;
        return distinctJudge();
      },
    });
    assert.deepEqual(result, {
      kind: "deduplicate",
      existingId: "near",
      usedJudge: false,
    });
    assert.equal(called, false);
  });

  it("inserts low-similarity candidates without the judge", async () => {
    let called = false;
    const result = await decideMemoryDedupAction({
      newMemorySummary: "new",
      candidates: [{ id: "far", summary: "old", cosineDistance: 0.3 }],
      judge: async () => {
        called = true;
        return sameJudge();
      },
    });
    assert.deepEqual(result, { kind: "insert", usedJudge: false });
    assert.equal(called, false);
  });

  it("invokes the judge for ambiguous candidates", async () => {
    let called = false;
    const result = await decideMemoryDedupAction({
      newMemorySummary: "new",
      candidates: [
        { id: "ambiguous", summary: "old", cosineDistance: 0.15 },
      ],
      judge: async () => {
        called = true;
        return sameJudge();
      },
    });
    assert.equal(called, true);
    assert.deepEqual(result, {
      kind: "deduplicate",
      existingId: "ambiguous",
      usedJudge: true,
    });
  });

  it("inserts when the ambiguous judge says distinct", async () => {
    const result = await decideMemoryDedupAction({
      newMemorySummary: "new",
      candidates: [
        { id: "ambiguous", summary: "old", cosineDistance: 0.15 },
      ],
      judge: distinctJudge,
    });
    assert.deepEqual(result, { kind: "insert", usedJudge: true });
  });
});
