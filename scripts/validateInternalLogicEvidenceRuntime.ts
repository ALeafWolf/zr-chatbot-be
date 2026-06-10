/**
 * Internal-logic evidence runtime validation — manual checklist helper.
 *
 * This script does NOT call models or run the full resolveContext pipeline.
 * It provides:
 * 1. A quick seed-count check (active rows with embeddings).
 * 2. A printed manual checklist with exact curl commands for runtime validation.
 *
 * The actual runtime validation was performed via the agent eval CLI
 * (see implementation notes for probe commands and results).
 *
 * Usage:
 *   tsx scripts/validateInternalLogicEvidenceRuntime.ts
 */
import { db } from "../src/db/client";
import { internalLogicEvidence } from "../src/db/schema/internalLogic";
import { eq, and, sql } from "drizzle-orm";

async function main(): Promise<void> {
  console.log("=== Internal-Logic Evidence — Manual Validation Checklist ===\n");

  // 1. Active seed count
  const activeCount = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(internalLogicEvidence)
    .where(
      and(
        eq(internalLogicEvidence.characterId, "zuo_ran"),
        eq(internalLogicEvidence.status, "active"),
        sql`embedding IS NOT NULL`,
      ),
    );
  const count = activeCount[0]?.count ?? 0;
  console.log(`Active seeded rows with embeddings: ${count}`);
  console.log(`(Expected: 4 for the initial seed batch)\n`);

  // 2. Manual checklist
  console.log("--- Manual Runtime Validation Checklist ---");
  console.log("");
  console.log("To validate runtime evidence retrieval and rendering,");
  console.log("start the backend and run the following probe evals:\n");

  console.log("Positive test (should retrieve evidence):");
  console.log("  $env:EVAL_SCENARIO_SET=\"probes\"");
  console.log("  npm run eval:agent -- --scenario probe_false_premise_with_fact");
  console.log("  → Expect: rerank.selected >= 1, finalContextMode contains \"memory\"");
  console.log("  → Prompt should contain [CHARACTER INTERNAL LOGIC EVIDENCE]");
  console.log("");

  console.log("Negative test (no evidence match expected):");
  console.log("  $env:EVAL_SCENARIO_SET=\"probes\"");
  console.log("  npm run eval:agent -- --scenario probe_false_premise_no_fact");
  console.log("  → Expect: rerank.selected could be 0, no evidence in prompt");
  console.log("");

  console.log("Negative test (casual conversation, no evidence):");
  console.log("  $env:EVAL_SCENARIO_SET=\"probes\"");
  console.log("  npm run eval:agent -- --scenario probe_relaxed_morning");
  console.log("  → Expect: candidates selected from other sources, no evidence block");
  console.log("");

  console.log("To inspect the generated prompt directly:");
  console.log("  Check LangSmith traces for the 'prompt.build_context' span");
  console.log("  or add console.log to buildPromptContext to capture systemPrompt.");
  console.log("");

  console.log("Offline seed validation (no backend needed):");
  console.log("  npm run seed:internal-logic -- --validate");
  console.log("");
}

main().catch((err) => {
  console.error("Check failed:", err);
  process.exit(1);
});
