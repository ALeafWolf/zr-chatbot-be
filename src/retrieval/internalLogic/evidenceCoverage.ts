/**
 * Internal-logic evidence coverage report — pure, unit-testable core.
 *
 * Given a flat list of evidence rows and the expected internal-logic node
 * names, produces a per-node coverage breakdown with gap detection.
 *
 * No DB, no I/O, no model calls — fully synchronous and testable.
 */

import { INTERNAL_LOGIC_NODES } from "../../evidenceMiner/types";

/**
 * A flattened evidence row as returned by a DB query.
 * `hasEmbedding` is true when the row's embedding vector is non-null.
 */
export interface EvidenceCoverageRow {
  node: string;
  status: string;
  hasEmbedding: boolean;
}

/**
 * Per-node coverage statistics.
 */
export interface PerNodeCoverage {
  node: string;
  /** True if this node is in the expected set. */
  expected: boolean;
  /** Count of rows by status. */
  counts: Record<string, number>;
  /** Number of active rows that have an embedding. */
  activeWithEmbedding: number;
}

/**
 * Structured coverage report.
 */
export interface EvidenceCoverageReport {
  /** Per-node breakdown, one entry per sorted unique node. */
  perNode: PerNodeCoverage[];
  /** Expected nodes that have zero active rows. */
  gaps: string[];
  /** Nodes present in the data but not in expectedNodes. */
  unexpectedNodes: string[];
  /** Overall totals. */
  totals: {
    rows: number;
    active: number;
    activeWithEmbedding: number;
    nodesWithActive: number;
  };
}

/**
 * Canonical list of internal-logic evidence node names.
 *
 * Reuses the shared constant from evidenceMiner/types.ts (the source of
 * truth). As of 2026-05-31 this contains 8 nodes: growth_environment,
 * core_belief, core_motivation, core_fear, defense_mechanism,
 * transition_rule, relationship_scope_gate, expression_constraint.
 */
export const EXPECTED_EVIDENCE_NODES: readonly string[] = INTERNAL_LOGIC_NODES;

/**
 * Build a per-node evidence coverage report.
 *
 * @param rows  Flat list of evidence rows (typically from a DB query).
 * @param expectedNodes  The set of node names that are expected to have
 *   active evidence. Defaults to `EXPECTED_EVIDENCE_NODES`.
 * @returns A structured coverage report.
 */
export function buildEvidenceCoverageReport(
  rows: EvidenceCoverageRow[],
  expectedNodes?: string[],
): EvidenceCoverageReport {
  const nodes = expectedNodes ?? [...EXPECTED_EVIDENCE_NODES];
  const nodeSet = new Set(nodes);

  // Accumulate per-node statistics
  const perNodeMap = new Map<string, { counts: Record<string, number>; activeWithEmbedding: number }>();

  for (const row of rows) {
    let acc = perNodeMap.get(row.node);
    if (!acc) {
      acc = { counts: {}, activeWithEmbedding: 0 };
      perNodeMap.set(row.node, acc);
    }
    acc.counts[row.status] = (acc.counts[row.status] ?? 0) + 1;
    if (row.status === "active" && row.hasEmbedding) {
      acc.activeWithEmbedding++;
    }
  }

  // Collect all unique node names (expected + unexpected)
  const allNodes = new Set<string>([...nodes, ...perNodeMap.keys()]);

  let totalRows = 0;
  let totalActive = 0;
  let totalActiveWithEmbedding = 0;
  let nodesWithActive = 0;

  const perNode: PerNodeCoverage[] = [];

  for (const node of [...allNodes].sort()) {
    const acc = perNodeMap.get(node);
    const isExpected = nodeSet.has(node);
    const counts = acc?.counts ?? {};
    const activeWithEmbedding = acc?.activeWithEmbedding ?? 0;
    const nodeActive = counts["active"] ?? 0;

    totalRows += Object.values(counts).reduce((s, v) => s + v, 0);
    if (nodeActive > 0) {
      totalActive += nodeActive;
      nodesWithActive++;
    }
    totalActiveWithEmbedding += activeWithEmbedding;

    perNode.push({ node, expected: isExpected, counts, activeWithEmbedding });
  }

  // Gaps: expected nodes with zero active rows
  const gaps = nodes.filter((n) => {
    const acc = perNodeMap.get(n);
    const activeCount = acc?.counts["active"] ?? 0;
    return activeCount === 0;
  });

  // Unexpected nodes: present in rows but not in expectedNodes
  const unexpectedNodes = [...perNodeMap.keys()].filter((n) => !nodeSet.has(n));

  return {
    perNode,
    gaps,
    unexpectedNodes,
    totals: {
      rows: totalRows,
      active: totalActive,
      activeWithEmbedding: totalActiveWithEmbedding,
      nodesWithActive,
    },
  };
}
