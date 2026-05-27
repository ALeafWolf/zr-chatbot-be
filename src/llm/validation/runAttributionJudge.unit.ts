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

test("attribution judge schema accepts Fenghe unsupported-elaboration shape", () => {
  // The Fenghe failure shape: draft has both a supported correction and
  // an unsupported first-trip/service-area/first-letter elaboration.
  // The judge should select the unsupported claim.
  const r = JudgeSchema.safeParse({
    has_attribution_claim: true,
    claim: { subject: "左然", predicate: "写了第一封信", object: "在服务区" },
    supported_by_canon: false,
    supported_by_transcript: false,
    fail_reason: "Canon only supports the second visit's suitcase letter; first-trip service-area letter is unsupported.",
  });
  assert.equal(r.success, true);
});

test("attribution judge schema rejects invalid claim object", () => {
  const r = JudgeSchema.safeParse({
    has_attribution_claim: true,
    claim: { subject: 42, predicate: "test", object: "test" },
    supported_by_canon: true,
    supported_by_transcript: true,
  });
  assert.equal(r.success, false);
});
