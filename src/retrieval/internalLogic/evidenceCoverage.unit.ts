/**
 * Unit tests for buildEvidenceCoverageReport.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildEvidenceCoverageReport } from "./evidenceCoverage";

const NODES = ["growth_environment", "core_belief", "core_motivation", "core_fear", "defense_mechanism", "transition_rule", "relationship_scope_gate", "expression_constraint"];

describe("buildEvidenceCoverageReport", () => {
  it("reports empty, per-node breakdown, gaps, unexpected nodes, and totals", () => {
    // Empty coverage
    let report = buildEvidenceCoverageReport([]);
    assert.equal(report.perNode.length, NODES.length, "empty — perNode");
    assert.equal(report.totals.rows, 0, "empty — rows");
    assert.equal(report.totals.active, 0, "empty — active");
    assert.equal(report.totals.activeWithEmbedding, 0, "empty — activeWithEmbedding");
    assert.equal(report.totals.nodesWithActive, 0, "empty — nodesWithActive");
    assert.deepEqual(report.gaps, [...NODES], "empty — gaps");
    assert.deepEqual(report.unexpectedNodes, [], "empty — unexpectedNodes");

    // Per-node breakdown
    let rows = [
      { node: "core_belief", status: "active", hasEmbedding: true },
      { node: "core_belief", status: "active", hasEmbedding: false },
      { node: "core_belief", status: "proposed", hasEmbedding: false },
      { node: "core_motivation", status: "active", hasEmbedding: true },
      { node: "core_motivation", status: "superseded", hasEmbedding: false },
      { node: "core_fear", status: "proposed", hasEmbedding: false },
    ];
    report = buildEvidenceCoverageReport(rows);
    const belief = report.perNode.find((n) => n.node === "core_belief")!;
    assert.ok(belief, "breakdown — belief exists");
    assert.equal(belief.expected, true, "breakdown — belief expected");
    assert.equal(belief.counts["active"], 2, "breakdown — belief active count");
    assert.equal(belief.counts["proposed"], 1, "breakdown — belief proposed count");
    assert.equal(belief.activeWithEmbedding, 1, "breakdown — belief activeWithEmbedding");
    const motivation = report.perNode.find((n) => n.node === "core_motivation")!;
    assert.equal(motivation.counts["active"], 1, "breakdown — motivation active");
    assert.equal(motivation.counts["superseded"], 1, "breakdown — motivation superseded");
    assert.equal(motivation.activeWithEmbedding, 1, "breakdown — motivation activeWithEmbedding");
    const fear = report.perNode.find((n) => n.node === "core_fear")!;
    assert.equal(fear.counts["proposed"], 1, "breakdown — fear proposed");
    assert.equal(fear.activeWithEmbedding, 0, "breakdown — fear activeWithEmbedding");

    // Gap detection — expected node with only proposed
    rows = [{ node: "core_fear", status: "active", hasEmbedding: true }, { node: "core_fear", status: "proposed", hasEmbedding: false }];
    report = buildEvidenceCoverageReport(rows, ["core_belief", "core_fear"]);
    assert.ok(report.gaps.includes("core_belief"), "gap — belief in gaps");
    assert.ok(!report.gaps.includes("core_fear"), "gap — fear not in gaps");

    // Gap detection — all proposed rows
    rows = [{ node: "core_belief", status: "proposed", hasEmbedding: false }];
    report = buildEvidenceCoverageReport(rows, ["core_belief", "core_motivation"]);
    assert.ok(report.gaps.includes("core_belief"), "proposed gap — belief");
    assert.ok(report.gaps.includes("core_motivation"), "proposed gap — motivation");

    // activeWithEmbedding counts only active rows with embeddings
    rows = [
      { node: "core_belief", status: "active", hasEmbedding: true },
      { node: "core_belief", status: "active", hasEmbedding: false },
      { node: "core_belief", status: "proposed", hasEmbedding: true },
      { node: "core_fear", status: "active", hasEmbedding: true },
    ];
    report = buildEvidenceCoverageReport(rows);
    assert.equal(report.perNode.find((n) => n.node === "core_belief")!.activeWithEmbedding, 1, "embedding — belief");
    assert.equal(report.perNode.find((n) => n.node === "core_fear")!.activeWithEmbedding, 1, "embedding — fear");

    // Unexpected nodes
    rows = [{ node: "unknown_node", status: "active", hasEmbedding: true }, { node: "another_unknown", status: "proposed", hasEmbedding: false }];
    report = buildEvidenceCoverageReport(rows, ["core_belief"]);
    assert.ok(report.unexpectedNodes.includes("unknown_node"), "unexpected — unknown_node");
    assert.ok(report.unexpectedNodes.includes("another_unknown"), "unexpected — another_unknown");
    assert.equal(report.unexpectedNodes.length, 2, "unexpected — count");

    // Correct totals
    rows = [
      { node: "core_belief", status: "active", hasEmbedding: true },
      { node: "core_belief", status: "active", hasEmbedding: true },
      { node: "core_belief", status: "proposed", hasEmbedding: false },
      { node: "core_motivation", status: "active", hasEmbedding: false },
      { node: "core_fear", status: "proposed", hasEmbedding: false },
      { node: "defense_mechanism", status: "superseded", hasEmbedding: false },
    ];
    report = buildEvidenceCoverageReport(rows);
    assert.equal(report.totals.rows, 6, "totals — rows");
    assert.equal(report.totals.active, 3, "totals — active");
    assert.equal(report.totals.activeWithEmbedding, 2, "totals — activeWithEmbedding");
    assert.equal(report.totals.nodesWithActive, 2, "totals — nodesWithActive");

    // Custom expectedNodes with gap
    rows = [{ node: "core_belief", status: "active", hasEmbedding: true }, { node: "core_belief", status: "active", hasEmbedding: false }];
    report = buildEvidenceCoverageReport(rows, ["core_belief", "core_motivation"]);
    assert.equal(report.perNode.length, 2, "custom — perNode");
    assert.deepEqual(report.gaps, ["core_motivation"], "custom — gaps");
    assert.equal(report.totals.rows, 2, "custom — rows");
    assert.equal(report.totals.active, 2, "custom — active");
    assert.equal(report.totals.nodesWithActive, 1, "custom — nodesWithActive");

    // Absent node as gap
    rows = [{ node: "core_belief", status: "active", hasEmbedding: true }];
    report = buildEvidenceCoverageReport(rows, ["core_belief", "transition_rule"]);
    assert.deepEqual(report.gaps, ["transition_rule"], "absent — gaps");
    assert.equal(report.totals.nodesWithActive, 1, "absent — nodesWithActive");
  });
});
