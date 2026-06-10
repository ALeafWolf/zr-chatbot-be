import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { z } from "zod";

const MemoryDedupJudgeSchema = z.object({
  decision: z.enum(["same", "superseding_update", "distinct"]),
  matchingCandidateId: z.string().optional(),
});

describe("memory dedup judge schema", () => {
  it("accepts valid decisions and rejects unknown ones", () => {
    const cases = [
      { name: "accepts distinct", payload: { decision: "distinct" }, expected: true },
      { name: "rejects unknown", payload: { decision: "maybe" }, expected: false },
    ];
    for (const c of cases) {
      const result = MemoryDedupJudgeSchema.safeParse(c.payload);
      assert.equal(result.success, c.expected, c.name);
    }
  });
});
