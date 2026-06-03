import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseLaneLabelModelOutputForTesting } from "./rewriteQuery";

describe("query rewrite model output parsing", () => {
  it("parseLaneLabelModelOutputForTesting normalizes span/id aliases and keeps canonical shape", () => {
    // Alias shape: spans + id → labels + spanId
    const aliased = parseLaneLabelModelOutputForTesting({
      spans: [
        { id: "s0", lane: "user_action" },
        { id: "s1", lane: "user_speech" },
      ],
      entities: ["Zuo Ran"],
      intent: "general",
      confidence: 0.95,
    });
    assert.deepEqual(
      aliased.labels,
      [
        { spanId: "s0", lane: "user_action" },
        { spanId: "s1", lane: "user_speech" },
      ],
      "alias — labels normalized",
    );
    assert.deepEqual(aliased.entities, ["Zuo Ran"], "alias — entities");
    assert.equal(aliased.intent, "general", "alias — intent");
    assert.equal(aliased.confidence, 0.95, "alias — confidence");

    // Canonical shape: labels/spanId unchanged
    const canonical = parseLaneLabelModelOutputForTesting({
      labels: [{ spanId: "s0", lane: "user_thought" }],
      entities: [],
      intent: "recall",
    });
    assert.deepEqual(canonical.labels, [{ spanId: "s0", lane: "user_thought" }], "canonical — labels unchanged");
    assert.equal(canonical.intent, "recall", "canonical — intent");
  });
});
