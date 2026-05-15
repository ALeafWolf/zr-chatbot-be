import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildRetrievalPlan } from "./retrievalPlan";
import type { QueryRewriteResult } from "../retrieval/query/rewriteQuery";

function rewrite(overrides: Partial<QueryRewriteResult> = {}): QueryRewriteResult {
  return {
    segments: [{ lane: "user_speech", text: "hello" }],
    combined_for_embedding: "hello",
    entities: [],
    intent: "general",
    confidence: 0.9,
    structuralParseOk: true,
    labelOk: true,
    parseOk: true,
    ...overrides,
  };
}

function plan(q: QueryRewriteResult, userMessage = "hello") {
  return buildRetrievalPlan({
    queryRewrite: q,
    userMessage,
    annotationFallback: false,
    confidenceThreshold: 0.6,
    structMemEntryDefaultTopK: 6,
    structMemConsolidationDefaultTopK: 4,
  });
}

describe("buildRetrievalPlan", () => {
  it("routes attribution turns to full canon and compact memory", () => {
    const result = plan(
      rewrite({ intent: "attribution", entities: ["chapter one"] }),
      "who proposed the plan?",
    );
    assert.equal(result.intent, "canon_fact");
    assert.equal(result.canonMode, "full");
    assert.ok(result.durableMemoryTopK < 5);
  });

  it("routes scene continuation to compact canon", () => {
    const result = plan(
      rewrite({
        segments: [{ lane: "reply_direction", text: "[continue the scene]" }],
      }),
      "continue",
    );
    assert.equal(result.intent, "scene_continuation");
    assert.equal(result.canonMode, "compact");
  });

  it("routes personal recall to higher memory budgets", () => {
    const result = plan(rewrite({ intent: "recall" }), "do you remember before?");
    assert.equal(result.intent, "personal_recall");
    assert.ok(result.sessionRecallTopK > 4);
  });

  it("forces open thread retrieval for plans and promises", () => {
    const result = plan(rewrite(), "remember our promise for next time");
    assert.equal(result.intent, "plan_or_promise");
    assert.equal(result.forceOpenThreads, true);
    assert.ok(result.openThreadTopK > 5);
  });

  it("fails open to the broad plan when confidence is low", () => {
    const result = plan(rewrite({ confidence: 0.2 }), "who proposed it?");
    assert.equal(result.intent, "general");
    assert.equal(result.broadFailOpen, true);
    assert.equal(result.canonMode, "full");
  });
});
