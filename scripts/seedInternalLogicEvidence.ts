/**
 * Seed and validate internal-logic evidence rows.
 *
 * Usage:
 *   npm run seed:internal-logic -- --dry-run     # print seed plan, no writes
 *   npm run seed:internal-logic -- --apply       # insert/update + embed
 *   npm run seed:internal-logic -- --validate    # run validation queries
 *
 * --dry-run and --apply can be combined with --validate.
 * --apply requires a live DB connection and OpenAI credentials.
 */
import { db } from "../src/db/client";
import { internalLogicEvidence } from "../src/db/schema/internalLogic";
import { embedText } from "../src/llm/embeddings/embedText";
import { eq, and, sql } from "drizzle-orm";
import { ZUO_RAN_EVIDENCE_SEEDS, SEED_VERSION } from "../src/character/internalLogic/evidenceSeeds";
import type { InternalLogicEvidenceSeed } from "../src/character/internalLogic/evidenceSeeds";

// ---------------------------------------------------------------------------
// CLI argument parsing
// ---------------------------------------------------------------------------
const args = process.argv.slice(2);
const isDryRun = args.includes("--dry-run");
const isApply = args.includes("--apply");
const isValidate = args.includes("--validate");

if (!isDryRun && !isApply && !isValidate) {
  console.log(
    "Usage: npm run seed:internal-logic -- --dry-run | --apply | --validate [--validate with --dry-run or --apply]",
  );
  process.exit(0);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Compute an embedding for the given text. */
async function computeEmbedding(text: string): Promise<number[] | null> {
  try {
    return await embedText(text);
  } catch (err) {
    console.error(`  [WARN] Embedding failed: ${(err as Error).message}`);
    return null;
  }
}

/** Calculate cosine similarity between two vectors. */
function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) return 0;
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dot / denom;
}

// ---------------------------------------------------------------------------
// Dry-run mode
// ---------------------------------------------------------------------------
async function runDryRun(): Promise<void> {
  console.log(`\n[DRY-RUN] Internal-logic evidence seed plan for zuo_ran`);
  console.log(`Seed version: ${SEED_VERSION}`);
  console.log(`Total seeds in fixture: ${ZUO_RAN_EVIDENCE_SEEDS.length}\n`);

  // Check existing rows in DB
  let existingRows: Array<{ id: string; metadata: { seedId?: string }; status: string }> = [];
  try {
    existingRows = await db
      .select({
        id: internalLogicEvidence.id,
        metadata: internalLogicEvidence.metadata,
        status: internalLogicEvidence.status,
      })
      .from(internalLogicEvidence)
      .where(
        and(
          eq(internalLogicEvidence.characterId, "zuo_ran"),
          sql`metadata->>'seedId' IS NOT NULL`,
        ),
      );
  } catch (err) {
    console.log(`  (DB not available: ${(err as Error).message})`);
    console.log(`  Proceeding with fixture-only report.\n`);
  }

  const existingSeedIds = new Set(
    existingRows.map((r) => (r.metadata as { seedId?: string }).seedId),
  );

  const activeSeeds = ZUO_RAN_EVIDENCE_SEEDS.filter((s) => s.applyStatus === `active`);
  const candidateSeeds = ZUO_RAN_EVIDENCE_SEEDS.filter((s) => s.applyStatus === `candidate`);

  for (const seed of ZUO_RAN_EVIDENCE_SEEDS) {
    const exists = existingSeedIds.has(seed.seedId);
    const action = seed.applyStatus === `active`
      ? (exists ? "UPDATE (row exists)" : "INSERT")
      : "SKIP (candidate)";
    console.log(`  [${action}] ${seed.seedId}`);
    console.log(`    node:          ${seed.node}`);
    console.log(`    status:        ${seed.applyStatus}`);
    console.log(`    claimText:     ${seed.claimText.slice(0, 80)}...`);
    console.log(`    provenance:    ${seed.provenanceNote ?? "none"}`);
    console.log(`    scope:         ${JSON.stringify(seed.scopeApplicability)}`);
    console.log(`    queries:       ${seed.validationQueries.join(" | ")}`);
    console.log("");
  }

  const total = ZUO_RAN_EVIDENCE_SEEDS.length;
  const existing = existingRows.length;
  console.log(`Summary: ${total} seeds (${activeSeeds.length} active, ${candidateSeeds.length} candidate), ${existing} existing in DB.`);
}

// ---------------------------------------------------------------------------
// Apply mode
// ---------------------------------------------------------------------------
async function runApply(): Promise<void> {
  console.log(`\n[APPLY] Seeding internal-logic evidence for zuo_ran\n`);

  // Fetch existing rows keyed by seedId
  const existingRows = await db
    .select({
      id: internalLogicEvidence.id,
      metadata: internalLogicEvidence.metadata,
      status: internalLogicEvidence.status,
    })
    .from(internalLogicEvidence)
    .where(
      and(
        eq(internalLogicEvidence.characterId, "zuo_ran"),
        sql`metadata->>'seedId' IS NOT NULL`,
      ),
    );

  // Identify duplicates
  const seedIdToRows = new Map<string, typeof existingRows>();
  for (const row of existingRows) {
    const sid = (row.metadata as { seedId?: string }).seedId;
    if (sid) {
      const existing = seedIdToRows.get(sid) ?? [];
      existing.push(row);
      seedIdToRows.set(sid, existing);
    }
  }

  for (const [sid, rows] of seedIdToRows) {
    if (rows.length > 1) {
      console.error(
        `[FATAL] Duplicate seedId "${sid}" found in DB (${rows.length} rows). IDs: ${rows.map((r) => r.id).join(", ")}. Manual cleanup required.`,
      );
      process.exit(1);
    }
  }

  let inserted = 0;
  let updated = 0;
  let failed = 0;
  const errors: string[] = [];

  const activeSeeds = ZUO_RAN_EVIDENCE_SEEDS.filter((s) => s.applyStatus === `active`);
  console.log(`Processing ${activeSeeds.length} active seeds (${ZUO_RAN_EVIDENCE_SEEDS.length - activeSeeds.length} candidates skipped).\n`);

  for (const seed of activeSeeds) {
    const existing = seedIdToRows.get(seed.seedId);
    const evidenceText = seed.evidenceText;

    // Embed using evidenceText (plan says evidenceText first)
    console.log(`  Embedding "${seed.seedId}"...`);
    const embedding = await computeEmbedding(evidenceText);
    if (!embedding) {
      const msg = `Failed to embed seed ${seed.seedId}: embedding returned null`;
      errors.push(msg);
      console.error(`  [FAIL] ${msg}`);
      failed++;
      continue;
    }

    const rowData = {
      characterId: seed.characterId,
      node: seed.node,
      claimText: seed.claimText,
      evidenceText: seed.evidenceText,
      embedding,
      arcKey: seed.arcKey ?? null,
      chapterKey: seed.chapterKey ?? null,
      episodeLabel: seed.episodeLabel ?? null,
      sceneOrder: seed.sceneOrder ?? null,
      unitIndex: seed.unitIndex ?? null,
      storySceneId: seed.storySceneId ?? null,
      scopeApplicability: seed.scopeApplicability,
      sourceKind: "canon" as const,
      status: "active" as const,
      confidenceScore: seed.confidenceScore ?? null,
      metadata: {
        source: "internal_logic_seed",
        seedId: seed.seedId,
        seedVersion: SEED_VERSION,
        validationQueries: seed.validationQueries,
        provenanceNote: seed.provenanceNote ?? null,
      },
    };

    try {
      if (existing && existing.length === 1) {
        // Update existing row
        await db
          .update(internalLogicEvidence)
          .set({ ...rowData, updatedAt: new Date() })
          .where(eq(internalLogicEvidence.id, existing[0].id));
        updated++;
        console.log(`  ✓ Updated ${seed.seedId}`);
      } else {
        // Insert new row
        await db.insert(internalLogicEvidence).values(rowData);
        inserted++;
        console.log(`  ✓ Inserted ${seed.seedId}`);
      }
    } catch (err) {
      const msg = `DB write failed for ${seed.seedId}: ${(err as Error).message}`;
      errors.push(msg);
      console.error(`  [FAIL] ${msg}`);
      failed++;
    }
  }

  console.log(`\nDone. Inserted: ${inserted}, Updated: ${updated}, Failed: ${failed}`);

  if (failed > 0) {
    console.error(`\n${failed} seed(s) failed. Errors:`);
    for (const e of errors) {
      console.error(`  - ${e}`);
    }
    process.exit(1);
  }
}

// ---------------------------------------------------------------------------
// Validate mode
// ---------------------------------------------------------------------------
async function runValidate(): Promise<void> {
  console.log(`\n[VALIDATE] Running retrieval quality checks\n`);

  // Fetch only seeded rows (identified by metadata.source) with embeddings
  const activeRows = await db
    .select()
    .from(internalLogicEvidence)
    .where(
      and(
        eq(internalLogicEvidence.characterId, "zuo_ran"),
        eq(internalLogicEvidence.status, "active"),
        sql`metadata->>'source' = 'internal_logic_seed'`,
        sql`embedding IS NOT NULL`,
      ),
    );

  if (activeRows.length === 0) {
    console.log("No seeded rows with embeddings found. Run --apply first.");
    return;
  }

  console.log(`Found ${activeRows.length} seeded rows (filtered by metadata.source='internal_logic_seed').\n`);

  // Collect unique validation queries from active (applyStatus) seeds only
  const seenQueries = new Set<string>();
  const queryToSeedIds = new Map<string, string[]>();
  const activeApplySeeds = ZUO_RAN_EVIDENCE_SEEDS.filter((s) => s.applyStatus === `active`);
  for (const seed of activeApplySeeds) {
    for (const q of seed.validationQueries) {
      if (seenQueries.has(q)) continue;
      seenQueries.add(q);
      const ids = queryToSeedIds.get(q) ?? [];
      ids.push(seed.seedId);
      queryToSeedIds.set(q, ids);
    }
  }

  for (const [query, expectedSeedIds] of queryToSeedIds) {
    console.log(`Query: "${query}"`);
    console.log(`  Expected seed IDs: ${expectedSeedIds.join(", ")}`);

    const queryEmbedding = await computeEmbedding(query);
    if (!queryEmbedding) {
      console.log(`  [SKIP] Could not embed query.\n`);
      continue;
    }

    // Score each active row
    const scored = activeRows.map((row) => {
      const rowEmb = row.embedding as unknown as number[] | null;
      const sim = rowEmb ? cosineSimilarity(queryEmbedding, rowEmb) : 0;
      const meta = row.metadata as Record<string, unknown>;
      return {
        seedId: (meta.seedId ?? "unknown") as string,
        node: row.node,
        similarity: sim,
        evidencePreview: row.evidenceText.slice(0, 80),
      };
    });

    scored.sort((a, b) => b.similarity - a.similarity);

    // Print top 5
    for (let i = 0; i < Math.min(5, scored.length); i++) {
      const s = scored[i];
      const expected = expectedSeedIds.includes(s.seedId) ? " ← EXPECTED" : "";
      const simStr = s.similarity.toFixed(4);
      console.log(`  ${i + 1}. [${simStr}] ${s.seedId} (${s.node})${expected}`);
      console.log(`     "${s.evidencePreview}..."`);
    }
    console.log("");
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main(): Promise<void> {
  if (isDryRun) await runDryRun();
  if (isApply) await runApply();
  if (isValidate) await runValidate();

  if (isDryRun || isValidate) {
    console.log("Done.");
  }
  process.exit(0);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
