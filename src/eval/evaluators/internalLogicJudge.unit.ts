/**
 * Unit tests for the internal-logic probe judge (TG1).
 *
 * Tests pure functions with no live LLM:
 * - Prompt builder contains all 6 dimensions, scale, category, reply, expectedBehavior
 * - Result mapping: valid judge output → 7 EvaluationResults with correct keys/scores
 * - Invalid/null judge output → 7 null-score results, no throw
 * - Gating: non-probe rows return empty results, judge fn not called
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildInternalLogicJudgePrompt,
  mapJudgeResultToEvaluationResults,
  internalLogicJudgeEvaluator,
  internalLogicJudgeRunEvaluator,
  makeInternalLogicJudgeRunEvaluator,
  JUDGE_DIMENSIONS,
  JUDGE_DIMENSION_LABELS,
} from "./internalLogicJudge";
import type { JudgeOutput } from "./internalLogicJudge";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const VALID_JUDGE_OUTPUT: JudgeOutput = {
  dimensions: {
    traceability: { score: 4, rationale: "回复可追溯到核心动机" },
    state_fit: { score: 5, rationale: "完全匹配压力状态" },
    transition_friction: { score: 3, rationale: "转折略显突兀" },
    style_stability: { score: 4, rationale: "风格一致" },
    canon_caution: { score: 2, rationale: "接受了一个虚假前提" },
    anti_self_analysis: { score: 5, rationale: "没有自我分析" },
  },
};

// ---------------------------------------------------------------------------
// buildInternalLogicJudgePrompt
// ---------------------------------------------------------------------------

describe("buildInternalLogicJudgePrompt", () => {
  it("includes all 6 dimension names (Chinese labels)", () => {
    const messages = buildInternalLogicJudgePrompt({
      category: "pressure",
      lastUserTurn: "你今天看起来不太对劲。",
      reply: "我没事。只是有些工作上的事情需要处理。",
    });

    const systemMsg = messages.find((m) => m.role === "system")?.content ?? "";

    for (const dim of JUDGE_DIMENSIONS) {
      const label = JUDGE_DIMENSION_LABELS[dim];
      assert.ok(systemMsg.includes(label), `System prompt should include dimension "${label}"`);
      assert.ok(systemMsg.includes(dim), `System prompt should include key "${dim}"`);
    }
  });

  it("includes the 1–5 scale descriptions", () => {
    const messages = buildInternalLogicJudgePrompt({
      category: "normal",
      lastUserTurn: "你好吗？",
      reply: "我很好，谢谢。",
    });

    const systemMsg = messages.find((m) => m.role === "system")?.content ?? "";
    assert.ok(systemMsg.includes("5"), "Should include score 5 description");
    assert.ok(systemMsg.includes("1"), "Should include score 1 description");
    assert.ok(systemMsg.includes("显著改进"));
    assert.ok(systemMsg.includes("严重偏离"));
  });

  it("contains the explicit JSON output shape with all 6 snake_case keys under dimensions", () => {
    const messages = buildInternalLogicJudgePrompt({
      category: "normal",
      lastUserTurn: "测试",
      reply: "回复",
    });

    const systemMsg = messages.find((m) => m.role === "system")?.content ?? "";
    // Must contain the "dimensions" wrapper
    assert.ok(systemMsg.includes('"dimensions"'), "System prompt must contain dimensions key");
    // Must contain all 6 snake_case dimension keys
    const expectedKeys = [
      "traceability",
      "state_fit",
      "transition_friction",
      "style_stability",
      "canon_caution",
      "anti_self_analysis",
    ];
    for (const key of expectedKeys) {
      assert.ok(systemMsg.includes(key), `System prompt must contain "${key}" in the JSON template`);
    }
    // Must contain the "score" and "rationale" field names
    assert.ok(systemMsg.includes('"score"'));
    assert.ok(systemMsg.includes('"rationale"'));
  });

  it("includes the probe category, last user turn, and reply in the user message", () => {
    const messages = buildInternalLogicJudgePrompt({
      category: "pressure_test",
      lastUserTurn: "你是不是在回避我？",
      reply: "……让我想一下。",
    });

    const userMsg = messages.find((m) => m.role === "user")?.content ?? "";
    assert.ok(userMsg.includes("pressure_test"));
    assert.ok(userMsg.includes("你是不是在回避我？"));
    assert.ok(userMsg.includes("……让我想一下。"));
  });

  it("includes expectedBehavior when provided", () => {
    const messages = buildInternalLogicJudgePrompt({
      category: "canon",
      lastUserTurn: "我们以前是不是见过？",
      reply: "我想我们没有见过。",
      expectedBehavior: "应纠正虚假前提而非浪漫化",
    });

    const userMsg = messages.find((m) => m.role === "user")?.content ?? "";
    assert.ok(userMsg.includes("应纠正虚假前提而非浪漫化"));
  });

  it("omits expectedBehavior section when not provided", () => {
    const messages = buildInternalLogicJudgePrompt({
      category: "normal",
      lastUserTurn: "你好",
      reply: "你好。",
    });

    const userMsg = messages.find((m) => m.role === "user")?.content ?? "";
    assert.ok(!userMsg.includes("预期行为"));
  });

  it("returns system + user messages in correct order", () => {
    const messages = buildInternalLogicJudgePrompt({
      category: "normal",
      lastUserTurn: "测试",
      reply: "回复",
    });

    assert.equal(messages.length, 2);
    assert.equal(messages[0]!.role, "system");
    assert.equal(messages[1]!.role, "user");
  });
});

// ---------------------------------------------------------------------------
// mapJudgeResultToEvaluationResults
// ---------------------------------------------------------------------------

describe("mapJudgeResultToEvaluationResults", () => {
  it("returns 7 EvaluationResults for valid output", () => {
    const results = mapJudgeResultToEvaluationResults(VALID_JUDGE_OUTPUT);
    assert.equal(results.length, 7);
  });

  it("returns correct dimension keys", () => {
    const results = mapJudgeResultToEvaluationResults(VALID_JUDGE_OUTPUT);
    const expectedKeys = [
      "judge_traceability",
      "judge_state_fit",
      "judge_transition_friction",
      "judge_style_stability",
      "judge_canon_caution",
      "judge_anti_self_analysis",
      "judge_composite",
    ];
    for (const key of expectedKeys) {
      assert.ok(results.some((r) => r.key === key), `Should have key "${key}"`);
    }
  });

  it("preserves dimension scores from judge output", () => {
    const results = mapJudgeResultToEvaluationResults(VALID_JUDGE_OUTPUT);
    const traceability = results.find((r) => r.key === "judge_traceability");
    assert.equal(traceability?.score, 4);
    assert.equal(traceability?.comment, "回复可追溯到核心动机");

    const canonCaution = results.find((r) => r.key === "judge_canon_caution");
    assert.equal(canonCaution?.score, 2);
    assert.equal(canonCaution?.comment, "接受了一个虚假前提");
  });

  it("computes composite as mean of the 6 dimensions", () => {
    const results = mapJudgeResultToEvaluationResults(VALID_JUDGE_OUTPUT);
    const composite = results.find((r) => r.key === "judge_composite");
    // Sum = 4+5+3+4+2+5 = 23, mean = 23/6 ≈ 3.833...
    assert.ok(composite !== undefined);
    assert.equal(typeof composite!.score, "number");
    // 23/6 = 3.8333...
    assert.equal(composite!.score, 23 / 6);
  });

  it("returns 7 null-score results for null input", () => {
    const results = mapJudgeResultToEvaluationResults(null);
    assert.equal(results.length, 7);
    for (const r of results) {
      assert.equal(r.score, null);
    }
  });

  it("returns 7 null-score results for invalid output (missing dimensions)", () => {
    const results = mapJudgeResultToEvaluationResults({} as JudgeOutput);
    assert.equal(results.length, 7);
    for (const r of results) {
      assert.equal(r.score, null);
    }
  });

  it("never throws for invalid input", () => {
    assert.doesNotThrow(() => mapJudgeResultToEvaluationResults(null));
    assert.doesNotThrow(() => mapJudgeResultToEvaluationResults({} as JudgeOutput));
    assert.doesNotThrow(() => mapJudgeResultToEvaluationResults({ dimensions: null } as unknown as JudgeOutput));
  });
});

// ---------------------------------------------------------------------------
// internalLogicJudgeEvaluator (gating + integration)
// ---------------------------------------------------------------------------

describe("internalLogicJudgeEvaluator", () => {
  it("returns empty results for non-probe rows", async () => {
    const result = await internalLogicJudgeEvaluator({
      inputs: { group: "regression" },
      outputs: { reply: "Some reply", mode: "agent_turn" },
    });
    assert.equal(result.results.length, 0);
  });

  it("returns empty results for missing reply", async () => {
    const result = await internalLogicJudgeEvaluator({
      inputs: { group: "probes" },
      outputs: { mode: "agent_turn", reply: "" },
    });
    assert.equal(result.results.length, 0);
  });

  it("returns empty results for non-agent-turn mode", async () => {
    const result = await internalLogicJudgeEvaluator({
      inputs: { group: "probes" },
      outputs: { mode: "other", reply: "Some reply" },
    });
    assert.equal(result.results.length, 0);
  });

  it("calls injected judgeFn and returns 7 results for valid probe row", async () => {
    let judgeCalled = false;
    const fakeJudge = async () => {
      judgeCalled = true;
      return VALID_JUDGE_OUTPUT;
    };

    const result = await internalLogicJudgeEvaluator({
      inputs: {
        group: "probes",
        description: "pressure",
        messages: [
          { role: "user", content: "你今天看起来不太对劲。" },
        ],
      },
      outputs: { reply: "我没事。", mode: "agent_turn" },
      judgeFn: fakeJudge,
    });

    assert.equal(judgeCalled, true);
    assert.equal(result.results.length, 7);
  });

  it("does not call judgeFn for non-probe rows", async () => {
    let judgeCalled = false;
    const fakeJudge = async () => {
      judgeCalled = true;
      return VALID_JUDGE_OUTPUT;
    };

    const result = await internalLogicJudgeEvaluator({
      inputs: { group: "regression" },
      outputs: { reply: "Some reply", mode: "agent_turn" },
      judgeFn: fakeJudge,
    });

    assert.equal(judgeCalled, false);
    assert.equal(result.results.length, 0);
  });

  it("passes expectedBehavior from metadata to prompt", async () => {
    let capturedMessages: Array<{ role: string; content: string }> = [];
    const capturingJudge = async (
      msgs: Array<{ role: string; content: string }>,
    ) => {
      capturedMessages = msgs;
      return VALID_JUDGE_OUTPUT;
    };

    await internalLogicJudgeEvaluator({
      inputs: {
        group: "probes",
        description: "canon",
        messages: [{ role: "user", content: "测试" }],
      },
      outputs: { reply: "回复", mode: "agent_turn" },
      metadata: { expected_behavior: "应纠正虚假前提" },
      judgeFn: capturingJudge,
    });

    const userMsg = capturedMessages.find((m) => m.role === "user")?.content ?? "";
    assert.ok(userMsg.includes("应纠正虚假前提"), "expectedBehavior should appear in prompt");
  });

  it("handles judgeFn throwing by returning null-score results", async () => {
    const throwingJudge = async () => {
      throw new Error("Judge crashed");
    };

    const result = await internalLogicJudgeEvaluator({
      inputs: {
        group: "probes",
        description: "pressure",
        messages: [{ role: "user", content: "测试" }],
      },
      outputs: { reply: "回复", mode: "agent_turn" },
      judgeFn: throwingJudge,
    });

    assert.equal(result.results.length, 7);
    for (const r of result.results) {
      assert.equal(r.score, null);
    }
  });

  it("handles judgeFn returning null by returning null-score results", async () => {
    const nullJudge = async () => null;

    const result = await internalLogicJudgeEvaluator({
      inputs: {
        group: "probes",
        description: "pressure",
        messages: [{ role: "user", content: "测试" }],
      },
      outputs: { reply: "回复", mode: "agent_turn" },
      judgeFn: nullJudge,
    });

    assert.equal(result.results.length, 7);
    for (const r of result.results) {
      assert.equal(r.score, null);
    }
  });

  it("extracts last user message for lastUserTurn", async () => {
    let capturedMessages: Array<{ role: string; content: string }> = [];
    const capturingJudge = async (
      msgs: Array<{ role: string; content: string }>,
    ) => {
      capturedMessages = msgs;
      return VALID_JUDGE_OUTPUT;
    };

    await internalLogicJudgeEvaluator({
      inputs: {
        group: "probes",
        description: "normal",
        messages: [
          { role: "system", content: "System" },
          { role: "user", content: "第一条消息" },
          { role: "assistant", content: "回复一" },
          { role: "user", content: "第二条消息" },
        ],
      },
      outputs: { reply: "回复二", mode: "agent_turn" },
      judgeFn: capturingJudge,
    });

    const userMsg = capturedMessages.find((m) => m.role === "user")?.content ?? "";
    assert.ok(userMsg.includes("第二条消息"), "Should use the LAST user message");
    assert.ok(!userMsg.includes("第一条消息"), "Should NOT include earlier user messages");
  });
});

// ---------------------------------------------------------------------------
// internalLogicJudgeRunEvaluator (RunEvaluator object, no traceable wrapping)
// ---------------------------------------------------------------------------

describe("internalLogicJudgeRunEvaluator", () => {
  it("is an object with evaluateRun method", () => {
    assert.equal(typeof internalLogicJudgeRunEvaluator, "object");
    assert.equal(typeof internalLogicJudgeRunEvaluator.evaluateRun, "function");
  });

  it("returns 7 judge_* results for a valid probe row via evaluateRun with fake judge", async () => {
    let judgeCalled = false;
    const fakeJudge = async () => {
      judgeCalled = true;
      return VALID_JUDGE_OUTPUT;
    };

    const evaluator = makeInternalLogicJudgeRunEvaluator({ judgeFn: fakeJudge });
    const result = await evaluator.evaluateRun(
      {
        id: "test-run-id",
        outputs: { reply: "I'm fine.", mode: "agent_turn" },
      } as unknown as import("langsmith/schemas").Run,
      {
        inputs: {
          group: "probes",
          description: "pressure",
          messages: [{ role: "user", content: "你今天看起来不太对劲。" }],
        },
      } as unknown as import("langsmith/schemas").Example,
    );

    assert.equal(judgeCalled, true);
    const results = "results" in result ? result.results : [result];
    assert.equal(results.length, 7);
    for (const r of results) {
      assert.ok(r.key.startsWith("judge_"), `Key should start with judge_: ${r.key}`);
    }
    const composite = results.find((r) => r.key === "judge_composite");
    assert.equal(composite?.score, 23 / 6);
  });

  it("returns empty results for non-probe rows via evaluateRun", async () => {
    const result = await internalLogicJudgeRunEvaluator.evaluateRun(
      {
        id: "test-run-id",
        outputs: { reply: "Some reply", mode: "agent_turn" },
      } as unknown as import("langsmith/schemas").Run,
      {
        inputs: { group: "regression" },
      } as unknown as import("langsmith/schemas").Example,
    );

    const results = "results" in result ? result.results : [result];
    assert.equal(results.length, 0);
  });

  it("returns empty results for missing reply via evaluateRun", async () => {
    const result = await internalLogicJudgeRunEvaluator.evaluateRun(
      {
        id: "test-run-id",
        outputs: { reply: "", mode: "agent_turn" },
      } as unknown as import("langsmith/schemas").Run,
      {
        inputs: { group: "probes" },
      } as unknown as import("langsmith/schemas").Example,
    );

    const results = "results" in result ? result.results : [result];
    assert.equal(results.length, 0);
  });

  it("returns empty results for non-agent-turn mode via evaluateRun", async () => {
    const result = await internalLogicJudgeRunEvaluator.evaluateRun(
      {
        id: "test-run-id",
        outputs: { reply: "Some reply", mode: "validator_only" },
      } as unknown as import("langsmith/schemas").Run,
      {
        inputs: { group: "probes" },
      } as unknown as import("langsmith/schemas").Example,
    );

    const results = "results" in result ? result.results : [result];
    assert.equal(results.length, 0);
  });

  it("handles missing example gracefully (empty inputs)", async () => {
    const result = await internalLogicJudgeRunEvaluator.evaluateRun(
      {
        id: "test-run-id",
        outputs: {} as Record<string, unknown>,
      } as unknown as import("langsmith/schemas").Run,
      undefined,
    );

    const results = "results" in result ? result.results : [result];
    // Missing group === "probes" → empty results
    assert.equal(results.length, 0);
  });
});
