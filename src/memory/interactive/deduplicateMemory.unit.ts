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
  it("handles high/low/ambiguous/ambiguous-distinct similarity thresholds", async () => {
    // high similarity → deduplicate without judge
    {
      let called = false;
      const result = await decideMemoryDedupAction({
        newMemorySummary: "new",
        candidates: [{ id: "near", summary: "old", cosineDistance: 0.05 }],
        judge: async () => { called = true; return distinctJudge(); },
      });
      assert.deepEqual(result, { kind: "deduplicate", existingId: "near", usedJudge: false }, "high");
      assert.equal(called, false, "high — judge not called");
    }
    // low similarity → insert without judge
    {
      let called = false;
      const result = await decideMemoryDedupAction({
        newMemorySummary: "new",
        candidates: [{ id: "far", summary: "old", cosineDistance: 0.3 }],
        judge: async () => { called = true; return sameJudge(); },
      });
      assert.deepEqual(result, { kind: "insert", usedJudge: false }, "low");
      assert.equal(called, false, "low — judge not called");
    }
    // ambiguous → invokes judge, deduplicates when judge says same
    {
      let called = false;
      const result = await decideMemoryDedupAction({
        newMemorySummary: "new",
        candidates: [{ id: "ambiguous", summary: "old", cosineDistance: 0.15 }],
        judge: async () => { called = true; return sameJudge(); },
      });
      assert.equal(called, true, "ambiguous — judge called");
      assert.deepEqual(result, { kind: "deduplicate", existingId: "ambiguous", usedJudge: true }, "ambiguous");
    }
    // ambiguous judge says distinct → insert
    {
      const result = await decideMemoryDedupAction({
        newMemorySummary: "new",
        candidates: [{ id: "ambiguous", summary: "old", cosineDistance: 0.15 }],
        judge: distinctJudge,
      });
      assert.deepEqual(result, { kind: "insert", usedJudge: true }, "ambiguous-distinct");
    }
  });
});
