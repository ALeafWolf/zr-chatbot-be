import { describe, it } from "node:test";
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

describe("attribution judge schema", () => {
  it("rejects invalid payloads and accepts valid/minimal/Fenghe shapes", () => {
    const cases = [
      {
        name: "rejects non-boolean has_attribution_claim",
        payload: { has_attribution_claim: "true", supported_by_canon: true, supported_by_transcript: true },
        expected: false as const,
      },
      {
        name: "accepts minimal valid payload",
        payload: { has_attribution_claim: false, supported_by_canon: true, supported_by_transcript: true },
        expected: true,
      },
      {
        name: "accepts Fenghe unsupported-elaboration shape",
        payload: {
          has_attribution_claim: true,
          claim: { subject: "左然", predicate: "写了第一封信", object: "在服务区" },
          supported_by_canon: false,
          supported_by_transcript: false,
          fail_reason: "Canon only supports the second visit's suitcase letter; first-trip service-area letter is unsupported.",
        },
        expected: true,
      },
      {
        name: "rejects invalid claim object (non-string subject)",
        payload: { has_attribution_claim: true, claim: { subject: 42, predicate: "test", object: "test" }, supported_by_canon: true, supported_by_transcript: true },
        expected: false,
      },
    ];

    for (const c of cases) {
      const r = JudgeSchema.safeParse(c.payload);
      assert.equal(r.success, c.expected, c.name);
    }
  });
});
