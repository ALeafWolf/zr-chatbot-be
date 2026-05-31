/**
 * Internal-logic evidence coverage report — CLI script.
 *
 * Default (DB-only): queries internal_logic_evidence for a character,
 * feeds rows to buildEvidenceCoverageReport, prints per-node table + verdict.
 *
 * --probe (opt-in, makes model calls): embeds representative claim texts and
 * calls searchInternalLogicEvidence, reporting per-query hits / top node /
 * top cosine and a rollup.
 *
 * Usage:
 *   npm run report:internal-logic-coverage
 *   npm run report:internal-logic-coverage -- --character zuo_ran
 *   npm run report:internal-logic-coverage -- --probe
 */

import { db } from "../src/db/client";
import { internalLogicEvidence } from "../src/db/schema/internalLogic";
import { eq, sql } from "drizzle-orm";
import {
  buildEvidenceCoverageReport,
  EXPECTED_EVIDENCE_NODES,
} from "../src/retrieval/internalLogic/evidenceCoverage";

// ---------------------------------------------------------------------------
// Argument parsing
// ---------------------------------------------------------------------------
const args = process.argv.slice(2);
const characterFlag = args.indexOf("--character");
const characterId =
  characterFlag !== -1 && args.length > characterFlag + 1
    ? args[characterFlag + 1]
    : "zuo_ran";
const hasProbe = args.includes("--probe");

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main(): Promise<void> {
  console.log(`\n=== Internal-Logic Evidence Coverage Report ===`);
  console.log(`Character: ${characterId}\n`);

  // 1. Query DB
  const rows = await db
    .select({
      node: internalLogicEvidence.node,
      status: internalLogicEvidence.status,
      hasEmbedding: sql<boolean>`embedding IS NOT NULL`,
    })
    .from(internalLogicEvidence)
    .where(eq(internalLogicEvidence.characterId, characterId))
    .orderBy(internalLogicEvidence.node, internalLogicEvidence.status);

  // 2. Build coverage report
  const report = buildEvidenceCoverageReport(
    rows.map((r) => ({
      node: r.node,
      status: r.status,
      hasEmbedding: r.hasEmbedding,
    })),
  );

  // 3. Print per-node table
  console.log("--- Per-Node Coverage ---");
  console.log(
    padRight("Node", 30) +
      padRight("Active", 8) +
      padRight("Proposed", 10) +
      padRight("Superseded", 12) +
      padRight("Embedded", 10) +
      "Expected",
  );
  console.log("-".repeat(80));

  for (const node of report.perNode) {
    const active = node.counts["active"] ?? 0;
    const proposed = node.counts["proposed"] ?? 0;
    const superseded = node.counts["superseded"] ?? 0;
    const embedded = node.activeWithEmbedding;
    const expected = node.expected ? "✓" : "✗";
    console.log(
      padRight(node.node, 30) +
        padRight(String(active), 8) +
        padRight(String(proposed), 10) +
        padRight(String(superseded), 12) +
        padRight(String(embedded), 10) +
        expected,
    );
  }

  // 4. Print totals (columns aligned with the header: Active / Proposed / Superseded / Embedded)
  const totalProposed = report.perNode.reduce((s, n) => s + (n.counts["proposed"] ?? 0), 0);
  const totalSuperseded = report.perNode.reduce((s, n) => s + (n.counts["superseded"] ?? 0), 0);
  console.log("-".repeat(80));
  console.log(
    padRight("TOTAL", 30) +
      padRight(String(report.totals.active), 8) +
      padRight(String(totalProposed), 10) +
      padRight(String(totalSuperseded), 12) +
      padRight(String(report.totals.activeWithEmbedding), 10) +
      "",
  );
  console.log(`(${report.totals.rows} rows total across all statuses)`);
  console.log("");

  // 5. Print one-line verdict
  const { active, activeWithEmbedding, nodesWithActive } = report.totals;
  const totalNodes = EXPECTED_EVIDENCE_NODES.length;
  const gapList = report.gaps.length > 0 ? report.gaps.join(", ") : "(none)";
  const unexpectedList =
    report.unexpectedNodes.length > 0
      ? `; unexpected: ${report.unexpectedNodes.join(", ")}`
      : "";

  console.log(
    `Verdict: ${active} active rows across ${nodesWithActive}/${totalNodes} nodes` +
      `${unexpectedList}`,
  );
  console.log(`  Gaps (no active): ${gapList}`);
  console.log(`  Embeddings populated: ${activeWithEmbedding}/${active}`);

  // 6. Optional probe: retrieval smoke test
  if (hasProbe) {
    await runProbe(characterId);
  }

  console.log("");
}

// ---------------------------------------------------------------------------
// Probe: retrieval smoke test
// ---------------------------------------------------------------------------
async function runProbe(characterId: string): Promise<void> {
  console.log("\n--- Retrieval Probe ---");

  // Representative claim texts for each node
  const probeQueries = [
    {
      label: "defense_mechanism (emotional avoidance)",
      text: "当他感到情绪压力时会先沉默或转移话题",
    },
    {
      label: "core_belief (responsibility)",
      text: "真正的在意必须通过可靠的行动和长期承诺来证明",
    },
    {
      label: "core_motivation (protective care)",
      text: "以稳定可靠的方式守护所珍视的人",
    },
    {
      label: "growth_environment (family background)",
      text: "在温暖但要求严格的家庭中长大",
    },
    {
      label: "core_fear (failing others)",
      text: "因一时情绪误判或失控而辜负他人",
    },
    {
      label: "transition_rule (restraint to openness)",
      text: "从克制到坦露之间必须存在可见的中间态",
    },
    {
      label: "relationship_scope_gate (status gating)",
      text: "关系阶段决定了可以展现的情感深度",
    },
    {
      label: "expression_constraint (emotional articulation)",
      text: "不擅长直接表达情感但会通过行动传递关心",
    },
  ];

  // Dynamic imports for embedText and searchInternalLogicEvidence
  const { embedText } = await import("../src/llm/embeddings/embedText");
  const { searchInternalLogicEvidence } = await import(
    "../src/retrieval/internalLogic/searchInternalLogicEvidence"
  );

  let totalHits = 0;
  let queriesWithHits = 0;

  for (const q of probeQueries) {
    const embedding = await embedText(q.text);
    const hits = await searchInternalLogicEvidence({
      characterId,
      queryEmbedding: embedding,
      limit: 3,
    });

    if (hits.length > 0) {
      queriesWithHits++;
      totalHits += hits.length;
      const top = hits[0]!;
      console.log(
        `  ✓ ${q.label}: ${hits.length} hit(s), top node="${top.node}", ` +
          `cosine=${top.cosineSimilarity.toFixed(4)}`,
      );
    } else {
      console.log(`  ✗ ${q.label}: 0 hits`);
    }
  }

  const totalQueries = probeQueries.length;
  console.log(
    `\n  Probe rollup: ${queriesWithHits}/${totalQueries} sample queries returned ≥1 hit ` +
      `(${totalHits} total hits)`,
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function padRight(s: string, width: number): string {
  return s.length >= width ? s.slice(0, width) : s + " ".repeat(width - s.length);
}

// ---------------------------------------------------------------------------
// Entry
// ---------------------------------------------------------------------------
main().catch((err) => {
  console.error("Coverage report failed:", err);
  process.exit(1);
});
