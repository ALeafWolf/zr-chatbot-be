import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { z } from "zod";

const MemoryDedupJudgeSchema = z.object({
  decision: z.enum(["same", "superseding_update", "distinct"]),
  matchingCandidateId: z.string().optional(),
});

describe("memory dedup judge schema", () => {
  it("accepts valid distinct decisions", () => {
    const result = MemoryDedupJudgeSchema.safeParse({
      decision: "distinct",
    });
    assert.equal(result.success, true);
  });

  it("rejects unknown decisions", () => {
    const result = MemoryDedupJudgeSchema.safeParse({
      decision: "maybe",
    });
    assert.equal(result.success, false);
  });
});
