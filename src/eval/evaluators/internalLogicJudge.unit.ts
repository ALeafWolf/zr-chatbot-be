import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildInternalLogicJudgePrompt, mapJudgeResultToEvaluationResults, internalLogicJudgeEvaluator, internalLogicJudgeRunEvaluator, makeInternalLogicJudgeRunEvaluator, JUDGE_DIMENSIONS, JUDGE_DIMENSION_LABELS } from "./internalLogicJudge";
import type { JudgeOutput } from "./internalLogicJudge";

const VALID_OUTPUT: JudgeOutput = { dimensions: { traceability: { score: 4, rationale: "回复可追溯到核心动机" }, state_fit: { score: 5, rationale: "完全匹配压力状态" }, transition_friction: { score: 3, rationale: "转折略显突兀" }, style_stability: { score: 4, rationale: "风格一致" }, canon_caution: { score: 2, rationale: "接受了一个虚假前提" }, anti_self_analysis: { score: 5, rationale: "没有自我分析" } } };

describe("buildInternalLogicJudgePrompt", () => {
  it("includes all 6 dimensions, scale, JSON shape, category/userTurn/reply, expectedBehavior handling, message order", () => {
    const msgs = buildInternalLogicJudgePrompt({ category: "pressure", lastUserTurn: "你今天看起来不太对劲。", reply: "我没事。" });
    const sys = msgs.find((m) => m.role === "system")?.content ?? "";
    const usr = msgs.find((m) => m.role === "user")?.content ?? "";
    for (const dim of JUDGE_DIMENSIONS) { assert.ok(sys.includes(JUDGE_DIMENSION_LABELS[dim]), `label ${dim}`); assert.ok(sys.includes(dim), `key ${dim}`); }
    assert.ok(sys.includes("5"), "score 5"); assert.ok(sys.includes("1"), "score 1"); assert.ok(sys.includes("显著改进")); assert.ok(sys.includes("严重偏离"));
    assert.ok(sys.includes('"dimensions"'), "dimensions key"); assert.ok(sys.includes('"score"'), "score key"); assert.ok(sys.includes('"rationale"'), "rationale key");
    assert.ok(usr.includes("pressure"), "category"); assert.ok(usr.includes("你今天看起来不太对劲。"), "user turn"); assert.ok(usr.includes("我没事。"), "reply");

    // expectedBehavior
    const withEb = buildInternalLogicJudgePrompt({ category: "canon", lastUserTurn: "我们以前是不是见过？", reply: "我想我们没有见过。", expectedBehavior: "应纠正虚假前提而非浪漫化" });
    assert.ok(withEb.find((m) => m.role === "user")?.content?.includes("应纠正虚假前提而非浪漫化"), "expectedBehavior included");
    const withoutEb = buildInternalLogicJudgePrompt({ category: "normal", lastUserTurn: "你好", reply: "你好。" });
    assert.ok(!withoutEb.find((m) => m.role === "user")?.content?.includes("预期行为"), "expectedBehavior omitted when not provided");

    // message order
    assert.equal(msgs.length, 2, "2 messages"); assert.equal(msgs[0]!.role, "system", "first = system"); assert.equal(msgs[1]!.role, "user", "second = user");
  });
});

describe("mapJudgeResultToEvaluationResults", () => {
  it("returns 7 results with correct keys/scores for valid output, null for null/invalid, never throws", () => {
    let r = mapJudgeResultToEvaluationResults(VALID_OUTPUT);
    assert.equal(r.length, 7, "7 results");
    const keys = ["judge_traceability", "judge_state_fit", "judge_transition_friction", "judge_style_stability", "judge_canon_caution", "judge_anti_self_analysis", "judge_composite"];
    for (const k of keys) assert.ok(r.some((x) => x.key === k), `key ${k}`);
    assert.equal(r.find((x) => x.key === "judge_traceability")?.score, 4, "traceability score");
    assert.equal(r.find((x) => x.key === "judge_traceability")?.comment, "回复可追溯到核心动机", "traceability comment");
    assert.equal(r.find((x) => x.key === "judge_canon_caution")?.score, 2, "canon_caution score");
    assert.equal(r.find((x) => x.key === "judge_composite")?.score, 23 / 6, "composite = mean");

    for (const input of [null, {} as JudgeOutput, { dimensions: null } as unknown as JudgeOutput]) {
      r = mapJudgeResultToEvaluationResults(input);
      assert.equal(r.length, 7, `null/invalid → 7 results`);
      for (const x of r) assert.equal(x.score, null, `null/invalid → null scores`);
      assert.doesNotThrow(() => mapJudgeResultToEvaluationResults(input), `null/invalid → no throw`);
    }
  });
});

describe("internalLogicJudgeEvaluator", () => {
  it("gates on group/reply/mode, calls judgeFn for valid probe rows, propagates expectedBehavior, handles throw/null", async () => {
    // Gating: non-probe, missing reply, non-agent-turn
    assert.equal((await internalLogicJudgeEvaluator({ inputs: { group: "regression" }, outputs: { reply: "x", mode: "agent_turn" } })).results.length, 0, "non-probe → empty");
    assert.equal((await internalLogicJudgeEvaluator({ inputs: { group: "probes" }, outputs: { mode: "agent_turn", reply: "" } })).results.length, 0, "missing reply → empty");
    assert.equal((await internalLogicJudgeEvaluator({ inputs: { group: "probes" }, outputs: { mode: "other", reply: "x" } })).results.length, 0, "non-agent-turn → empty");

    // Calls judge and returns 7 results
    let called = false;
    let r = await internalLogicJudgeEvaluator({ inputs: { group: "probes", description: "pressure", messages: [{ role: "user", content: "test" }] }, outputs: { reply: "x", mode: "agent_turn" }, judgeFn: async () => { called = true; return VALID_OUTPUT; } });
    assert.equal(called, true, "judge called"); assert.equal(r.results.length, 7, "7 results");

    // Does not call judge for non-probe
    called = false;
    await internalLogicJudgeEvaluator({ inputs: { group: "regression" }, outputs: { reply: "x", mode: "agent_turn" }, judgeFn: async () => { called = true; return VALID_OUTPUT; } });
    assert.equal(called, false, "judge not called for non-probe");

    // Passes expectedBehavior
    let captured: Array<{ role: string; content: string }> = [];
    await internalLogicJudgeEvaluator({ inputs: { group: "probes", description: "canon", messages: [{ role: "user", content: "测试" }] }, outputs: { reply: "回复", mode: "agent_turn" }, metadata: { expected_behavior: "应纠正虚假前提" }, judgeFn: async (msgs) => { captured = msgs; return VALID_OUTPUT; } });
    assert.ok(captured.find((m) => m.role === "user")?.content?.includes("应纠正虚假前提"), "expectedBehavior in prompt");

    // Judge throws → null-score results
    r = await internalLogicJudgeEvaluator({ inputs: { group: "probes", description: "pressure", messages: [{ role: "user", content: "测试" }] }, outputs: { reply: "回复", mode: "agent_turn" }, judgeFn: async () => { throw new Error("crashed"); } });
    assert.equal(r.results.length, 7, "throw → 7 results"); for (const x of r.results) assert.equal(x.score, null, "throw → null scores");

    // Judge returns null → null-score results
    r = await internalLogicJudgeEvaluator({ inputs: { group: "probes", description: "pressure", messages: [{ role: "user", content: "测试" }] }, outputs: { reply: "回复", mode: "agent_turn" }, judgeFn: async () => null });
    assert.equal(r.results.length, 7, "null → 7 results"); for (const x of r.results) assert.equal(x.score, null, "null → null scores");

    // Extracts last user message
    captured = [];
    await internalLogicJudgeEvaluator({ inputs: { group: "probes", description: "normal", messages: [{ role: "system", content: "S" }, { role: "user", content: "第一条" }, { role: "assistant", content: "回复一" }, { role: "user", content: "第二条" }] }, outputs: { reply: "回复二", mode: "agent_turn" }, judgeFn: async (msgs) => { captured = msgs; return VALID_OUTPUT; } });
    const userMsg = captured.find((m) => m.role === "user")?.content ?? "";
    assert.ok(userMsg.includes("第二条"), "last user message used"); assert.ok(!userMsg.includes("第一条"), "earlier user messages excluded");
  });
});

describe("internalLogicJudgeRunEvaluator", () => {
  it("is a RunEvaluator object, delegates to factory with fake judge, handles gating", async () => {
    assert.equal(typeof internalLogicJudgeRunEvaluator, "object"); assert.equal(typeof internalLogicJudgeRunEvaluator.evaluateRun, "function");

    let called = false;
    const ev = makeInternalLogicJudgeRunEvaluator({ judgeFn: async () => { called = true; return VALID_OUTPUT; } });
    let r = await ev.evaluateRun({ id: "r", outputs: { reply: "x", mode: "agent_turn" } } as any, { inputs: { group: "probes", description: "p", messages: [{ role: "user", content: "test" }] } } as any);
    assert.equal(called, true, "judge called"); let results = "results" in r ? r.results : [r]; assert.equal(results.length, 7, "7 results");
    assert.equal(results.find((x: any) => x.key === "judge_composite")?.score, 23 / 6, "composite");

    for (const scenario of [
      { outputs: { reply: "x", mode: "agent_turn" }, example: { inputs: { group: "regression" } }, note: "non-probe" },
      { outputs: { reply: "", mode: "agent_turn" }, example: { inputs: { group: "probes" } }, note: "missing reply" },
      { outputs: { reply: "x", mode: "validator_only" }, example: { inputs: { group: "probes" } }, note: "non-agent-turn" },
      { outputs: {} as Record<string, unknown>, example: undefined, note: "missing example" },
    ] as any) {
      r = await internalLogicJudgeRunEvaluator.evaluateRun({ id: "r", outputs: scenario.outputs } as any, scenario.example);
      results = "results" in r ? r.results : [r];
      assert.equal(results.length, 0, `${scenario.note} → empty`);
    }
  });
});
