import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseLaneLabelModelOutputForTesting } from "./rewriteQuery";

describe("query rewrite model output parsing", () => {
  it("normalizes extractor spans/id aliases into labels/spanId", () => {
    const parsed = parseLaneLabelModelOutputForTesting({
      spans: [
        { id: "s0", lane: "user_action" },
        { id: "s1", lane: "user_speech" },
      ],
      entities: ["Zuo Ran"],
      intent: "general",
      confidence: 0.95,
    });

    assert.deepEqual(parsed.labels, [
      { spanId: "s0", lane: "user_action" },
      { spanId: "s1", lane: "user_speech" },
    ]);
    assert.deepEqual(parsed.entities, ["Zuo Ran"]);
    assert.equal(parsed.intent, "general");
    assert.equal(parsed.confidence, 0.95);
  });

  it("keeps the canonical labels/spanId shape unchanged", () => {
    const parsed = parseLaneLabelModelOutputForTesting({
      labels: [{ spanId: "s0", lane: "user_thought" }],
      entities: [],
      intent: "recall",
    });

    assert.deepEqual(parsed.labels, [
      { spanId: "s0", lane: "user_thought" },
    ]);
    assert.equal(parsed.intent, "recall");
  });
});
