import assert from "node:assert/strict";
import { describe, it } from "node:test";
process.env.LANGSMITH_API_KEY = "test-dummy-key";
import { buildExampleMetadata } from "./pushLangSmithDataset";
import type { Scenario } from "./evalTypes";

describe("buildExampleMetadata", () => {
  it("includes group/expected_behavior for probes, omits for normal, includes rerank metadata", () => {
    const probe: Scenario = { id: "probe_test", description: "P99: Test probe", group: "probes", eval_mode: "agent_turn", session: { mode: "canonical_live", continuity_scope: "main_relationship", continuity_family: "main_world", writeback_policy: "no_writeback" }, messages: [], assertions: [], expected_behavior: "应纠正虚假前提而非浪漫化" };
    let meta = buildExampleMetadata(probe, "2");
    assert.equal(meta.group, "probes", "probe group");
    assert.equal(meta.description, "P99: Test probe", "probe description");
    assert.equal(meta.expected_behavior, "应纠正虚假前提而非浪漫化", "probe expected_behavior");
    assert.deepEqual(meta.assertions, [], "probe assertions empty");
    assert.equal(meta.scenarios_file_version, "2", "version");

    const normal: Scenario = { id: "regression_test", description: "Normal test", session: { mode: "canonical_live", continuity_scope: "main_relationship", continuity_family: "main_world" }, messages: [], assertions: [{ type: "no_self_analysis", description: "No self-analysis" }] };
    meta = buildExampleMetadata(normal, "1");
    assert.equal(meta.expected_behavior, undefined, "normal — expected_behavior omitted");
    assert.equal(meta.group, undefined, "normal — group omitted");
    assert.ok(Array.isArray(meta.assertions), "normal — assertions is array");
    assert.equal((meta.assertions as unknown[]).length, 1, "normal — assertions present");

    const rerank: Scenario = { id: "rerank_test", description: "Rerank test", session: { mode: "canonical_live", continuity_scope: "main_relationship", continuity_family: "main_world" }, messages: [], assertions: [], expected_selected_ids: ["mem1", "mem2"], expected_rejected_ids: ["mem3"], expected_final_context_mode: "selected_memory" };
    meta = buildExampleMetadata(rerank, "1");
    assert.deepEqual(meta.expected_selected_ids, ["mem1", "mem2"], "rerank selected_ids");
    assert.deepEqual(meta.expected_rejected_ids, ["mem3"], "rerank rejected_ids");
    assert.equal(meta.expected_final_context_mode, "selected_memory", "rerank context_mode");
  });
});
