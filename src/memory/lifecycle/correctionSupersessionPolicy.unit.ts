import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildCorrectionSupersessionPlan } from "./correctionSupersessionPolicy";

describe("buildCorrectionSupersessionPlan", () => {
  it("marks only candidates containing the corrected old claim and ignores very short old claims", () => {
    // Marks only the candidate that explicitly contains the corrected old claim
    const matched = buildCorrectionSupersessionPlan({
      corrections: [
        { oldClaim: "the meeting is tomorrow", correctedClaim: "the meeting is Friday", sourceTurnIndex: 12 },
      ],
      candidates: [
        { id: "m1", source: "interactive_memory", text: "The meeting is tomorrow and should be remembered." },
        { id: "s1", source: "structmem_entry", text: "They discussed dinner." },
      ],
    });
    assert.deepEqual(
      matched,
      [
        {
          candidateId: "m1",
          source: "interactive_memory",
          oldClaim: "the meeting is tomorrow",
          correctedClaim: "the meeting is Friday",
          sourceTurnIndex: 12,
        },
      ],
      "matches only m1 (contains old claim)",
    );

    // Very short old claims are ignored to avoid broad supersession
    const shortClaim = buildCorrectionSupersessionPlan({
      corrections: [{ oldClaim: "soon", correctedClaim: "Friday", sourceTurnIndex: 12 }],
      candidates: [{ id: "m1", source: "interactive_memory", text: "soon" }],
    });
    assert.deepEqual(shortClaim, [], "short old claim — no supersession");
  });
});
