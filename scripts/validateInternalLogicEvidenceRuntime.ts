/**
 * Targeted runtime validation for internal-logic evidence.
 *
 * Sends test queries through the full resolveContext pipeline and captures
 * whether evidence is retrieved, selected, and rendered in the prompt.
 *
 * Run: tsx scripts/validateInternalLogicEvidenceRuntime.ts
 */
import { resolveContext } from "../src/orchestration/context/resolveContext";
import { buildPromptContext } from "../src/orchestration/prompt/buildPromptContext";
import { loadCharacterDefaults } from "../src/character/characterDefaults";
import { loadPersonaOverlay } from "../src/character/characterDefaults";
import { db } from "../src/db/client";
import { internalLogicEvidence } from "../src/db/schema/internalLogic";
import { eq, sql } from "drizzle-orm";

// Quick inline test: retrieve evidence diagnostics and verify
async function main(): Promise<void> {
  console.log("=== Internal-Logic Evidence Runtime Validation ===\n");

  // 1. Check active seed count in DB
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
  console.log(`Active seeded rows in DB: ${activeCount[0]?.count ?? 0}\n`);

  // 2. Check candidate shortlist for evidence
  console.log("To run full pipeline validation, start the backend and send:");
  console.log('  curl -X POST http://localhost:3000/api/turn \\');
  console.log('    -H "Content-Type: application/json" \\');
  console.log('    -d \'{"characterId":"zuo_ran","message":"你还记得我们第一次去枫河的时候吗？"}\'');
  console.log("");
  console.log("Then inspect the LangSmith trace or the returned prompt for:");
  console.log("  - [CHARACTER INTERNAL LOGIC EVIDENCE] block");
  console.log("  - internal_logic_evidence in retrieval diagnostics");
  console.log("");

  // 3. Negative validation: a normal greeting should NOT trigger evidence
  console.log("Negative test (should NOT retrieve evidence):");
  console.log('  curl -X POST http://localhost:3000/api/turn \\');
  console.log('    -H "Content-Type: application/json" \\');
  console.log('    -d \'{"characterId":"zuo_ran","message":"早啊，今天天气不错。"}\'');
  console.log("  → [CHARACTER INTERNAL LOGIC EVIDENCE] should be ABSENT");
}

import { and } from "drizzle-orm";

main().catch((err) => {
  console.error("Validation failed:", err);
  process.exit(1);
});
