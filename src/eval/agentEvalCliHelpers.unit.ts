import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { resolveScenarioSet, findScenarioForAgentEval, validateCliArgs } from "./agentEvalCliHelpers";

describe("agentEvalCliHelpers", () => {
  it("resolveScenarioSet: returns correct value for env settings (unset, unknown, rerank, all, case)", () => {
    for (const [env, expected] of [[undefined, "default"], ["bogus", "default"], ["rerank", "rerank"], ["all", "all"], ["RERANK", "rerank"]] as Array<[string | undefined, string]>) {
      const prev = process.env.EVAL_SCENARIO_SET;
      if (env === undefined) delete process.env.EVAL_SCENARIO_SET; else process.env.EVAL_SCENARIO_SET = env;
      assert.equal(resolveScenarioSet(), expected, `EVAL_SCENARIO_SET=${env ?? "unset"}`);
      if (prev === undefined) delete process.env.EVAL_SCENARIO_SET; else process.env.EVAL_SCENARIO_SET = prev;
    }
  });

  it("findScenarioForAgentEval: finds scenarios by ID across sets, returns null for unknown, preserves eval_mode", () => {
    assert.equal(findScenarioForAgentEval("nonexistent_scenario", "default"), null, "unknown → null");
    const d = findScenarioForAgentEval("no_ai_claim", "default")!;
    assert.ok(d, "found default scenario"); assert.equal(d.eval_mode, undefined, "preserves undefined eval_mode");
    assert.ok(findScenarioForAgentEval("no_ai_claim", "all"), "found in all set");
    assert.ok(findScenarioForAgentEval("rerank_001_immediate_action_no_memory", "rerank"), "found rerank in rerank set");
    assert.ok(findScenarioForAgentEval("rerank_001_immediate_action_no_memory", "all"), "found rerank in all set");
    assert.equal(findScenarioForAgentEval("no_ai_claim", "rerank"), null, "default not in rerank set");
    const rerank = findScenarioForAgentEval("rerank_001_immediate_action_no_memory", "rerank")!;
    assert.ok(rerank, "rerank found"); assert.equal(rerank.eval_mode, "agent_turn", "rerank has agent_turn");
  });

  it("validateCliArgs: rejects missing/unknown/validator-only/retrieval, accepts valid rerank", () => {
    let r = validateCliArgs(undefined as any, "default");
    assert.equal(r.ok, false); if (!r.ok) { assert.ok(r.error.includes("--scenario"), "missing — error msg"); assert.equal(r.exitCode, 1, "missing — exitCode"); }

    r = validateCliArgs("nonexistent", "default");
    assert.equal(r.ok, false); if (!r.ok) { assert.ok(r.error.includes("not found"), "unknown — error msg"); assert.equal(r.exitCode, 1, "unknown — exitCode"); }

    r = validateCliArgs("no_ai_claim", "default");
    assert.equal(r.ok, false); if (!r.ok) { assert.ok(r.error.includes("(omitted)"), "no eval_mode — error msg"); assert.ok(r.error.includes('"agent_turn"'), "no eval_mode — agent_turn req"); assert.equal(r.exitCode, 1, "no eval_mode — exitCode"); }

    r = validateCliArgs("canon_attribution_fenghe_first_visit", "default");
    assert.equal(r.ok, false); if (!r.ok) { assert.ok(r.error.includes('"retrieval"'), "retrieval — error msg"); assert.equal(r.exitCode, 1, "retrieval — exitCode"); }

    r = validateCliArgs("rerank_001_immediate_action_no_memory", "rerank");
    assert.equal(r.ok, true); if (r.ok) { assert.equal(r.scenarioId, "rerank_001_immediate_action_no_memory", "valid — scenarioId"); assert.equal(r.input.eval_mode, "agent_turn", "valid — eval_mode"); }
  });
});
