/**
 * Unit tests for LangSmith dataset push helpers.
 *
 * Tests the pure `buildExampleMetadata` function with no live LangSmith client.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

// Set a dummy API key so the module-level main() guard doesn't fail on import
process.env.LANGSMITH_API_KEY = "test-dummy-key";

import { buildExampleMetadata } from "./pushLangSmithDataset";
import type { Scenario } from "./evalTypes";

describe("buildExampleMetadata", () => {
  it("includes group and expected_behavior for a probe scenario", () => {
    const probe: Scenario = {
      id: "probe_test",
      description: "P99: Test probe",
      group: "probes",
      eval_mode: "agent_turn",
      session: {
        mode: "canonical_live",
        continuity_scope: "main_relationship",
        continuity_family: "main_world",
        writeback_policy: "no_writeback",
      },
      messages: [],
      assertions: [],
      expected_behavior: "应纠正虚假前提而非浪漫化",
    };

    const meta = buildExampleMetadata(probe, "2");
    assert.equal(meta.group, "probes");
    assert.equal(meta.description, "P99: Test probe");
    assert.equal(meta.expected_behavior, "应纠正虚假前提而非浪漫化");
    assert.deepEqual(meta.assertions, []);
    assert.equal(meta.scenarios_file_version, "2");
  });

  it("omits expected_behavior for a non-probe scenario", () => {
    const normal: Scenario = {
      id: "regression_test",
      description: "Normal regression test",
      session: {
        mode: "canonical_live",
        continuity_scope: "main_relationship",
        continuity_family: "main_world",
      },
      messages: [],
      assertions: [{ type: "no_self_analysis", description: "No self-analysis" }],
    };

    const meta = buildExampleMetadata(normal, "1");
    assert.equal(meta.expected_behavior, undefined);
    assert.equal(meta.group, undefined);
    assert.ok(Array.isArray(meta.assertions));
    assert.equal((meta.assertions as unknown[]).length, 1);
  });

  it("includes rerank metadata when present", () => {
    const rerank: Scenario = {
      id: "rerank_test",
      description: "Rerank test",
      session: {
        mode: "canonical_live",
        continuity_scope: "main_relationship",
        continuity_family: "main_world",
      },
      messages: [],
      assertions: [],
      expected_selected_ids: ["mem1", "mem2"],
      expected_rejected_ids: ["mem3"],
      expected_final_context_mode: "selected_memory",
    };

    const meta = buildExampleMetadata(rerank, "1");
    assert.deepEqual(meta.expected_selected_ids, ["mem1", "mem2"]);
    assert.deepEqual(meta.expected_rejected_ids, ["mem3"]);
    assert.equal(meta.expected_final_context_mode, "selected_memory");
  });
});
