import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { normalizeAgentEvalInput } from "./runAgentEval";

describe("normalizeAgentEvalInput", () => {
  it("builds full-turn input from legacy scenario-shaped fields", () => {
    const input = normalizeAgentEvalInput({
      scenario_id: "agent_case",
      eval_mode: "agent_turn",
      session: { mode: "canonical_live", continuity_scope: "main_relationship", continuity_family: "main_world", writeback_policy: "full_writeback" },
      messages: [{ role: "user", content: "earlier", turn_index: 0 }, { role: "assistant", content: "reply", turn_index: 1 }, { role: "user", content: "current", turn_index: 2 }],
      primed_memories: [{ summary: "seed memory" }],
    });
    assert.equal(input.scenarioId, "agent_case", "scenarioId");
    assert.equal(input.userMessage, "current", "last user message");
    assert.equal(input.recentMessages?.length, 2, "recent messages count");
    assert.equal(input.sessionSeed.continuityScope, "main_relationship", "continuityScope");
    assert.equal(input.sessionSeed.writebackPolicy, "full_writeback", "writebackPolicy");
    assert.equal(input.durableMemories?.length, 1, "durableMemories from primed_memories");
  });

  it("requires a user message and session seed", () => {
    assert.throws(() => normalizeAgentEvalInput({ scenario_id: "bad_case", session: { mode: "canonical_live", continuity_scope: "main" } }), /missing userMessage/, "missing user message");
    assert.throws(() => normalizeAgentEvalInput({ scenario_id: "bad_case", userMessage: "hello", session: { mode: "canonical_live" } }), /missing session mode\/continuity scope/, "missing session scope");
  });
});
