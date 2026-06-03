import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildRetrievalPlan } from "./retrievalPlan";
import type { QueryRewriteResult } from "../../retrieval/query/rewriteQuery";

function rewrite(overrides: Partial<QueryRewriteResult> = {}): QueryRewriteResult {
  return {
    segments: [{ lane: "user_speech", text: "hello" }],
    combined_for_embedding: "hello", entities: [],
    intent: "general", confidence: 0.9,
    structuralParseOk: true, labelOk: true, parseOk: true,
    ...overrides,
  };
}

function plan(q: QueryRewriteResult, userMessage = "hello") {
  return buildRetrievalPlan({
    queryRewrite: q, userMessage, annotationFallback: false, confidenceThreshold: 0.6,
    structMemEntryDefaultTopK: 6, structMemConsolidationDefaultTopK: 4,
  });
}

describe("buildRetrievalPlan", () => {
  it("routes intents to correct canon modes, memory budgets, and open thread flags", () => {
    const cases = [
      { name: "attribution → canon_fact, full canon, compact memory", q: rewrite({ intent: "attribution", entities: ["chapter one"] }), msg: "who proposed the plan?", check: (r: ReturnType<typeof plan>) => { assert.equal(r.intent, "canon_fact", "intent"); assert.equal(r.canonMode, "full", "canonMode"); assert.ok(r.durableMemoryTopK < 5, "durableMemoryTopK < 5"); } },
      { name: "scene continuation → compact canon", q: rewrite({ segments: [{ lane: "reply_direction", text: "[continue the scene]" }] }), msg: "continue", check: (r: ReturnType<typeof plan>) => { assert.equal(r.intent, "scene_continuation", "intent"); assert.equal(r.canonMode, "compact", "canonMode"); } },
      { name: "personal recall → higher memory budgets", q: rewrite({ intent: "recall" }), msg: "do you remember before?", check: (r: ReturnType<typeof plan>) => { assert.equal(r.intent, "personal_recall", "intent"); assert.ok(r.sessionRecallTopK > 4, "sessionRecallTopK > 4"); } },
      { name: "plan_or_promise forces open threads", q: rewrite(), msg: "remember our promise for next time", check: (r: ReturnType<typeof plan>) => { assert.equal(r.intent, "plan_or_promise", "intent"); assert.equal(r.forceOpenThreads, true, "forceOpenThreads"); assert.ok(r.openThreadTopK > 5, "openThreadTopK > 5"); } },
      { name: "low confidence fails open to broad plan", q: rewrite({ confidence: 0.2 }), msg: "who proposed it?", check: (r: ReturnType<typeof plan>) => { assert.equal(r.intent, "general", "intent"); assert.equal(r.broadFailOpen, true, "broadFailOpen"); assert.equal(r.canonMode, "full", "canonMode"); } },
    ];
    for (const c of cases) {
      const result = plan(c.q, c.msg);
      c.check(result);
    }
  });
});
