/**
 * Unit tests for buildEvidenceCoverageReport.
 *
 * Covers: per-node status breakdown, gap detection, active-with-embedding
 * counting, unexpected node detection, and totals correctness.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildEvidenceCoverageReport, type EvidenceCoverageRow } from "./evidenceCoverage";

const NODES = [
  "growth_environment",
  "core_belief",
  "core_motivation",
  "core_fear",
  "defense_mechanism",
  "transition_rule",
  "relationship_scope_gate",
  "expression_constraint",
];

describe("buildEvidenceCoverageReport", () => {
  it("reports empty coverage when no rows", () => {
    const report = buildEvidenceCoverageReport([]);

    assert.equal(report.perNode.length, NODES.length);
    assert.equal(report.totals.rows, 0);
    assert.equal(report.totals.active, 0);
    assert.equal(report.totals.activeWithEmbedding, 0);
    assert.equal(report.totals.nodesWithActive, 0);
    assert.deepEqual(report.gaps, [...NODES]);
    assert.deepEqual(report.unexpectedNodes, []);
  });

  it("breaks down per-node status counts", () => {
    const rows: EvidenceCoverageRow[] = [
      { node: "core_belief", status: "active", hasEmbedding: true },
      { node: "core_belief", status: "active", hasEmbedding: false },
      { node: "core_belief", status: "proposed", hasEmbedding: false },
      { node: "core_motivation", status: "active", hasEmbedding: true },
      { node: "core_motivation", status: "superseded", hasEmbedding: false },
      { node: "core_fear", status: "proposed", hasEmbedding: false },
    ];

    const report = buildEvidenceCoverageReport(rows);

    const belief = report.perNode.find((n) => n.node === "core_belief")!;
    assert.ok(belief);
    assert.equal(belief.expected, true);
    assert.equal(belief.counts["active"], 2);
    assert.equal(belief.counts["proposed"], 1);
    assert.equal(belief.activeWithEmbedding, 1);

    const motivation = report.perNode.find((n) => n.node === "core_motivation")!;
    assert.equal(motivation.counts["active"], 1);
    assert.equal(motivation.counts["superseded"], 1);
    assert.equal(motivation.activeWithEmbedding, 1);

    const fear = report.perNode.find((n) => n.node === "core_fear")!;
    assert.equal(fear.counts["proposed"], 1);
    assert.equal(fear.activeWithEmbedding, 0);
  });

  it("detects gaps — expected node with only proposed rows is a gap", () => {
    const rows: EvidenceCoverageRow[] = [
      { node: "core_fear", status: "active", hasEmbedding: true },
      { node: "core_fear", status: "proposed", hasEmbedding: false },
    ];

    // Custom expectedNodes: only core_fear and core_belief
    const report = buildEvidenceCoverageReport(rows, ["core_belief", "core_fear"]);

    // core_belief has zero rows → gap
    assert.ok(report.gaps.includes("core_belief"));
    // core_fear has active rows → not a gap
    assert.ok(!report.gaps.includes("core_fear"));
  });

  it("detects gaps — expected node with all proposed rows is a gap", () => {
    const rows: EvidenceCoverageRow[] = [
      { node: "core_belief", status: "proposed", hasEmbedding: false },
    ];

    const report = buildEvidenceCoverageReport(rows, ["core_belief", "core_motivation"]);

    // core_belief has only proposed → gap (no active)
    assert.ok(report.gaps.includes("core_belief"));
    assert.ok(report.gaps.includes("core_motivation"));
  });

  it("activeWithEmbedding counts only active rows with embeddings", () => {
    const rows: EvidenceCoverageRow[] = [
      { node: "core_belief", status: "active", hasEmbedding: true },
      { node: "core_belief", status: "active", hasEmbedding: false },
      { node: "core_belief", status: "proposed", hasEmbedding: true }, // proposed, not counted
      { node: "core_fear", status: "active", hasEmbedding: true },
    ];

    const report = buildEvidenceCoverageReport(rows);

    const belief = report.perNode.find((n) => n.node === "core_belief")!;
    assert.equal(belief.activeWithEmbedding, 1); // only the active+embedding row

    const fear = report.perNode.find((n) => n.node === "core_fear")!;
    assert.equal(fear.activeWithEmbedding, 1);
  });

  it("reports unexpected nodes not in expectedNodes", () => {
    const rows: EvidenceCoverageRow[] = [
      { node: "unknown_node", status: "active", hasEmbedding: true },
      { node: "another_unknown", status: "proposed", hasEmbedding: false },
    ];

    const report = buildEvidenceCoverageReport(rows, ["core_belief"]);

    assert.ok(report.unexpectedNodes.includes("unknown_node"));
    assert.ok(report.unexpectedNodes.includes("another_unknown"));
    assert.equal(report.unexpectedNodes.length, 2);
  });

  it("reports correct totals", () => {
    const rows: EvidenceCoverageRow[] = [
      { node: "core_belief", status: "active", hasEmbedding: true },
      { node: "core_belief", status: "active", hasEmbedding: true },
      { node: "core_belief", status: "proposed", hasEmbedding: false },
      { node: "core_motivation", status: "active", hasEmbedding: false },
      { node: "core_fear", status: "proposed", hasEmbedding: false },
      { node: "defense_mechanism", status: "superseded", hasEmbedding: false },
    ];

    const report = buildEvidenceCoverageReport(rows);

    assert.equal(report.totals.rows, 6);
    assert.equal(report.totals.active, 3); // 2 core_belief + 1 core_motivation
    assert.equal(report.totals.activeWithEmbedding, 2); // 2 core_belief active+embedding
    assert.equal(report.totals.nodesWithActive, 2); // core_belief + core_motivation
  });

  it("accepts custom expectedNodes", () => {
    const rows: EvidenceCoverageRow[] = [
      { node: "core_belief", status: "active", hasEmbedding: true },
      { node: "core_belief", status: "active", hasEmbedding: false },
    ];

    const report = buildEvidenceCoverageReport(rows, ["core_belief", "core_motivation"]);

    // perNode should contain only the two nodes in the data
    assert.equal(report.perNode.length, 2); // only 2 unique nodes total
    assert.deepEqual(report.gaps, ["core_motivation"]);
    assert.equal(report.totals.rows, 2);
    assert.equal(report.totals.active, 2);
    assert.equal(report.totals.nodesWithActive, 1);
  });

  it("expected node absent from rows appears as gap", () => {
    const rows: EvidenceCoverageRow[] = [
      { node: "core_belief", status: "active", hasEmbedding: true },
    ];

    const report = buildEvidenceCoverageReport(rows, ["core_belief", "transition_rule"]);

    assert.deepEqual(report.gaps, ["transition_rule"]);
    assert.equal(report.totals.nodesWithActive, 1);
  });
});
