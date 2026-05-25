import assert from "node:assert/strict";
import { describe, it } from "node:test";

// Import only pure helpers — no live agent eval, models, or LangSmith.
import {
  resolveScenarioSet,
  findScenarioForAgentEval,
  validateCliArgs,
} from "./agentEvalCliHelpers";

describe("agentEvalCliHelpers", () => {
  // -----------------------------------------------------------------------
  // resolveScenarioSet
  // -----------------------------------------------------------------------

  describe("resolveScenarioSet", () => {
    it('returns "default" when EVAL_SCENARIO_SET is unset', () => {
      const restore = clearEnv();
      assert.equal(resolveScenarioSet(), "default");
      restore();
    });

    it('returns "default" for unknown values', () => {
      const restore = setEnv("EVAL_SCENARIO_SET", "bogus");
      assert.equal(resolveScenarioSet(), "default");
      restore();
    });

    it('returns "rerank" for EVAL_SCENARIO_SET=rerank', () => {
      const restore = setEnv("EVAL_SCENARIO_SET", "rerank");
      assert.equal(resolveScenarioSet(), "rerank");
      restore();
    });

    it('returns "all" for EVAL_SCENARIO_SET=all', () => {
      const restore = setEnv("EVAL_SCENARIO_SET", "all");
      assert.equal(resolveScenarioSet(), "all");
      restore();
    });

    it("handles case-insensitive values", () => {
      const restore = setEnv("EVAL_SCENARIO_SET", "RERANK");
      assert.equal(resolveScenarioSet(), "rerank");
      restore();
    });
  });

  // -----------------------------------------------------------------------
  // findScenarioForAgentEval
  // -----------------------------------------------------------------------

  describe("findScenarioForAgentEval", () => {
    it("returns null for unknown scenario id", () => {
      const result = findScenarioForAgentEval("nonexistent_scenario", "default");
      assert.equal(result, null);
    });

    it("finds a scenario from scenarios.json in default set", () => {
      const result = findScenarioForAgentEval("no_ai_claim", "default");
      assert.ok(result !== null);
      assert.equal(result.scenario_id, "no_ai_claim");
      assert.equal(result.eval_mode, undefined);
    });

    it("finds a default scenario in all set", () => {
      const result = findScenarioForAgentEval("no_ai_claim", "all");
      assert.ok(result !== null);
    });

    it("finds a rerank scenario in rerank set", () => {
      const result = findScenarioForAgentEval(
        "rerank_001_immediate_action_no_memory",
        "rerank",
      );
      assert.ok(result !== null);
    });

    it("finds a rerank scenario in all set", () => {
      const result = findScenarioForAgentEval(
        "rerank_001_immediate_action_no_memory",
        "all",
      );
      assert.ok(result !== null);
    });

    it("does NOT find a default scenario in rerank set", () => {
      const result = findScenarioForAgentEval("no_ai_claim", "rerank");
      assert.equal(result, null);
    });

    it("preserves the scenario's actual eval_mode without defaulting", () => {
      const result = findScenarioForAgentEval("no_ai_claim", "default");
      assert.ok(result !== null);
      assert.equal(result.eval_mode, undefined);
    });

    it("rerank scenarios have eval_mode agent_turn", () => {
      const result = findScenarioForAgentEval(
        "rerank_001_immediate_action_no_memory",
        "rerank",
      );
      assert.ok(result !== null);
      assert.equal(result.eval_mode, "agent_turn");
    });
  });

  // -----------------------------------------------------------------------
  // validateCliArgs — CLI boundary validation (no live imports)
  // -----------------------------------------------------------------------

  describe("validateCliArgs", () => {
    it("rejects missing --scenario with error message and exitCode 1", () => {
      const result = validateCliArgs(undefined, "default");
      assert.equal(result.ok, false);
      if (!result.ok) {
        assert.ok(result.error.includes("--scenario"));
        assert.equal(result.exitCode, 1);
      }
    });

    it("rejects unknown scenario id with error and exitCode 1", () => {
      const result = validateCliArgs("nonexistent", "default");
      assert.equal(result.ok, false);
      if (!result.ok) {
        assert.ok(result.error.includes("not found"));
        assert.equal(result.exitCode, 1);
      }
    });

    it("rejects scenario without eval_mode (validator-only) with error and exitCode 1", () => {
      const result = validateCliArgs("no_ai_claim", "default");
      assert.equal(result.ok, false);
      if (!result.ok) {
        assert.ok(result.error.includes('(omitted)'));
        assert.ok(result.error.includes('"agent_turn"'));
        assert.equal(result.exitCode, 1);
      }
    });

    it("rejects retrieval scenario with error and exitCode 1", () => {
      const result = validateCliArgs("canon_attribution_fenghe_first_visit", "default");
      assert.equal(result.ok, false);
      if (!result.ok) {
        assert.ok(result.error.includes('"retrieval"'));
        assert.equal(result.exitCode, 1);
      }
    });

    it("accepts a valid rerank scenario with agent_turn eval_mode", () => {
      const result = validateCliArgs(
        "rerank_001_immediate_action_no_memory",
        "rerank",
      );
      assert.equal(result.ok, true);
      if (result.ok) {
        assert.equal(result.scenarioId, "rerank_001_immediate_action_no_memory");
        assert.equal(result.input.eval_mode, "agent_turn");
      }
    });
  });
});

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

function setEnv(key: string, value: string): () => void {
  const previous = process.env[key];
  process.env[key] = value;
  return () => {
    if (previous === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = previous;
    }
  };
}

function clearEnv(): () => void {
  const keys = ["EVAL_SCENARIO_SET"];
  const previous = {} as Record<string, string | undefined>;
  for (const key of keys) {
    previous[key] = process.env[key];
    delete process.env[key];
  }
  return () => {
    for (const key of keys) {
      if (previous[key] === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = previous[key];
      }
    }
  };
}
