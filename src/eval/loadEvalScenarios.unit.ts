import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { loadScenariosBySet, loadRerankScenarios, scenarioToEvalInputs } from "./loadEvalScenarios";
import type { Scenario } from "./evalTypes";

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

  it("F1: scenarioToEvalInputs includes seedAxisState when present on scenario", () => {
    const scenario: Scenario = {
      id: "test_seed_axis",
      description: "seed axis test",
      session: { mode: "test", continuity_scope: "main", continuity_family: "main_world" },
      assertions: [],
      seedAxisState: {
        version: 1,
        tick: 3,
        axes: { connection: 0.25, valence: -0.1, arousal: 0.05, restraint: 0.6 },
        lastTrace: {
          tick: 3,
          axesBefore: { connection: 0.2, valence: 0, arousal: 0, restraint: 0.7 },
          axesAfter: { connection: 0.25, valence: -0.1, arousal: 0.05, restraint: 0.6 },
          couplingsFired: ["zr_c1"],
          effectiveBaselines: {},
        },
        bands: { connection: "mid", valence: "mid", arousal: "mid", restraint: "high" },
        history: [],
      },
    };
    const inputs = scenarioToEvalInputs(scenario);
    assert.ok(inputs.seedAxisState, "seedAxisState is present in output");
    assert.deepEqual(inputs.seedAxisState, scenario.seedAxisState);
  });

  it("F1: scenarioToEvalInputs omits seedAxisState when not on scenario", () => {
    const scenario: Scenario = {
      id: "test_no_seed",
      description: "no seed",
      session: { mode: "test", continuity_scope: "main", continuity_family: "main_world" },
      assertions: [],
    };
    const inputs = scenarioToEvalInputs(scenario);
    assert.equal(inputs.seedAxisState, undefined);
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
