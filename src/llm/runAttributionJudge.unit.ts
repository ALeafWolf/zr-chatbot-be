import test from "node:test";
import assert from "node:assert/strict";
import { z } from "zod";

/** Mirrors {@link runAttributionJudge} output schema — parse failures → fail-open in production. */
const JudgeSchema = z.object({
  has_attribution_claim: z.boolean(),
  claim: z
    .object({
      subject: z.string(),
      predicate: z.string(),
      object: z.string(),
    })
    .optional(),
  supported_by_canon: z.boolean(),
  supported_by_transcript: z.boolean(),
  fail_reason: z.string().optional(),
});

test("attribution judge schema rejects non-boolean has_attribution_claim", () => {
  const r = JudgeSchema.safeParse({
    has_attribution_claim: "true",
    supported_by_canon: true,
    supported_by_transcript: true,
  });
  assert.equal(r.success, false);
});

test("attribution judge schema accepts minimal valid payload", () => {
  const r = JudgeSchema.safeParse({
    has_attribution_claim: false,
    supported_by_canon: true,
    supported_by_transcript: true,
  });
  assert.equal(r.success, true);
});
