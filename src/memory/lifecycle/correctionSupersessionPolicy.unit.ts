import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildCorrectionSupersessionPlan } from "./correctionSupersessionPolicy";

describe("buildCorrectionSupersessionPlan", () => {
  it("marks only candidates explicitly containing the corrected old claim", () => {
    const decisions = buildCorrectionSupersessionPlan({
      corrections: [
        {
          oldClaim: "the meeting is tomorrow",
          correctedClaim: "the meeting is Friday",
          sourceTurnIndex: 12,
        },
      ],
      candidates: [
        {
          id: "m1",
          source: "interactive_memory",
          text: "The meeting is tomorrow and should be remembered.",
        },
        {
          id: "s1",
          source: "structmem_entry",
          text: "They discussed dinner.",
        },
      ],
    });

    assert.deepEqual(decisions, [
      {
        candidateId: "m1",
        source: "interactive_memory",
        oldClaim: "the meeting is tomorrow",
        correctedClaim: "the meeting is Friday",
        sourceTurnIndex: 12,
      },
    ]);
  });

  it("ignores very short old claims to avoid broad supersession", () => {
    const decisions = buildCorrectionSupersessionPlan({
      corrections: [
        {
          oldClaim: "soon",
          correctedClaim: "Friday",
          sourceTurnIndex: 12,
        },
      ],
      candidates: [
        {
          id: "m1",
          source: "interactive_memory",
          text: "soon",
        },
      ],
    });

    assert.deepEqual(decisions, []);
  });
});
