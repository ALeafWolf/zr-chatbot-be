import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  loadScenariosBySet,
  loadRerankScenarios,
} from "./loadEvalScenarios";
import type { Scenario } from "./evalTypes";

describe("loadEvalScenarios", () => {
  describe("loadScenariosBySet", () => {
    it("default set loads scenarios from scenarios.json", () => {
      const { version, scenarios } = loadScenariosBySet("default");
      assert.equal(typeof version, "string");
      assert.ok(version.length > 0);
      assert.ok(Array.isArray(scenarios));
      assert.ok(scenarios.length > 0);
      // All default scenarios should have required fields
      for (const s of scenarios) {
        assert.ok(typeof s.id === "string");
        assert.ok(typeof s.description === "string");
        assert.ok(Array.isArray(s.assertions));
      }
    });
  });

  describe("loadRerankScenarios", () => {
    it("loads rerank scenarios from the rerank scenario library", () => {
      const scenarios = loadRerankScenarios();
      assert.ok(Array.isArray(scenarios));
      assert.ok(scenarios.length > 0);
      // All rerank scenarios should have rerank in their id
      for (const s of scenarios) {
        assert.ok(s.id.startsWith("rerank_"), `Expected rerank_ prefix in ${s.id}`);
        assert.equal(s.group, "rerank");
        assert.equal(typeof s.description, "string");
      }
    });

    it("all rerank scenarios have eval_mode: agent_turn so they execute through the agent_turn path", () => {
      const scenarios = loadRerankScenarios();
      for (const s of scenarios) {
        assert.equal(
          s.eval_mode,
          "agent_turn",
          `Scenario ${s.id} must have eval_mode "agent_turn" to be executable; got "${s.eval_mode}"`,
        );
      }
    });

    it("all rerank scenarios have valid assertion types", () => {
      const scenarios = loadRerankScenarios();
      const validTypes = [
        "rerank_selected_ids",
        "rerank_rejected_ids",
        "rerank_context_mode",
        "rerank_no_fallback",
        "max_irrelevant_selected",
      ];
      for (const s of scenarios) {
        for (const a of s.assertions) {
          assert.ok(
            validTypes.includes(a.type),
            `Scenario ${s.id}: unknown assertion type "${a.type}"`,
          );
        }
      }
    });
  });

  describe("loadScenariosBySet with rerank", () => {
    it("rerank set loads only rerank scenarios", () => {
      const { scenarios } = loadScenariosBySet("rerank");
      assert.ok(scenarios.length > 0);
      for (const s of scenarios) {
        assert.ok(s.id.startsWith("rerank_"));
      }
    });

    it("all set loads both default and rerank scenarios", () => {
      const { scenarios } = loadScenariosBySet("all");
      const rerankCount = scenarios.filter((s) =>
        s.id.startsWith("rerank_"),
      ).length;
      const defaultCount = scenarios.filter(
        (s) => !s.id.startsWith("rerank_"),
      ).length;
      assert.ok(defaultCount > 0, "Should include default scenarios");
      assert.ok(rerankCount > 0, "Should include rerank scenarios");
    });
  });
});
