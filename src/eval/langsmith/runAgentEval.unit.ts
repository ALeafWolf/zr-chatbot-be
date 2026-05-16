import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { normalizeAgentEvalInput } from "./runAgentEval";

describe("normalizeAgentEvalInput", () => {
  it("builds full-turn input from legacy scenario-shaped fields", () => {
    const input = normalizeAgentEvalInput({
      scenario_id: "agent_case",
      eval_mode: "agent_turn",
      session: {
        mode: "canonical_live",
        continuity_scope: "main_relationship",
        continuity_family: "main_world",
        writeback_policy: "full_writeback",
      },
      messages: [
        { role: "user", content: "earlier", turn_index: 0 },
        { role: "assistant", content: "reply", turn_index: 1 },
        { role: "user", content: "current", turn_index: 2 },
      ],
      primed_memories: [{ summary: "seed memory" }],
    });

    assert.equal(input.scenarioId, "agent_case");
    assert.equal(input.userMessage, "current");
    assert.equal(input.recentMessages?.length, 2);
    assert.equal(input.sessionSeed.continuityScope, "main_relationship");
    assert.equal(input.sessionSeed.writebackPolicy, "full_writeback");
    assert.equal(input.durableMemories?.length, 1);
  });

  it("requires a user message and session seed", () => {
    assert.throws(
      () =>
        normalizeAgentEvalInput({
          scenario_id: "bad_case",
          session: { mode: "canonical_live", continuity_scope: "main" },
        }),
      /missing userMessage/,
    );
    assert.throws(
      () =>
        normalizeAgentEvalInput({
          scenario_id: "bad_case",
          userMessage: "hello",
          session: { mode: "canonical_live" },
        }),
      /missing session mode\/continuity scope/,
    );
  });
});
