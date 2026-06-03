import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { loadScenariosBySet, loadRerankScenarios } from "./loadEvalScenarios";

describe("loadEvalScenarios", () => {
  it("loadScenariosBySet default: returns version string and scenarios with required fields", () => {
    const { version, scenarios } = loadScenariosBySet("default");
    assert.equal(typeof version, "string", "version type");
    assert.ok(version.length > 0, "version non-empty");
    assert.ok(Array.isArray(scenarios), "scenarios is array");
    assert.ok(scenarios.length > 0, "scenarios non-empty");
    for (const s of scenarios) {
      assert.ok(typeof s.id === "string", `${s.id} — id type`);
      assert.ok(typeof s.description === "string", `${s.id} — description type`);
      assert.ok(Array.isArray(s.assertions), `${s.id} — assertions array`);
    }
  });

  it("loadRerankScenarios: returns rerank-prefixed scenarios with valid assertions, agent_turn", () => {
    const scenarios = loadRerankScenarios();
    assert.ok(Array.isArray(scenarios), "returns array");
    assert.ok(scenarios.length > 0, "non-empty");
    const validTypes = ["rerank_selected_ids", "rerank_rejected_ids", "rerank_context_mode", "rerank_no_fallback", "max_irrelevant_selected"];
    for (const s of scenarios) {
      assert.ok(s.id.startsWith("rerank_"), `${s.id} — rerank_ prefix`);
      assert.equal(s.group, "rerank", `${s.id} — group rerank`);
      assert.equal(typeof s.description, "string", `${s.id} — description type`);
      assert.equal(s.eval_mode, "agent_turn", `${s.id} — eval_mode agent_turn`);
      for (const a of s.assertions) {
        assert.ok(validTypes.includes(a.type), `${s.id} — valid assertion type "${a.type}"`);
      }
    }
  });

  it("loadScenariosBySet with rerank: rerank set filters; all set includes both", () => {
    const rerankOnly = loadScenariosBySet("rerank");
    assert.ok(rerankOnly.scenarios.length > 0, "rerank set non-empty");
    for (const s of rerankOnly.scenarios) {
      assert.ok(s.id.startsWith("rerank_"), `${s.id} — rerank only`);
    }
    const allScenarios = loadScenariosBySet("all");
    const rerankCount = allScenarios.scenarios.filter((s) => s.id.startsWith("rerank_")).length;
    const defaultCount = allScenarios.scenarios.filter((s) => !s.id.startsWith("rerank_")).length;
    assert.ok(defaultCount > 0, "default scenarios in all set");
    assert.ok(rerankCount > 0, "rerank scenarios in all set");
  });
});
