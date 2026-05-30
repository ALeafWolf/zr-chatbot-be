/**
 * Offline internal-logic evidence miner (M-D).
 *
 * == Inertness invariant (verified) ==
 * `searchInternalLogicEvidence` in
 *   `src/retrieval/internalLogic/searchInternalLogicEvidence.ts:178`
 * filters `AND status = 'active'`, so `proposed` and `superseded` rows
 * never reach any prompt. Mined rows at `status='proposed'` are inert until
 * a human promotes them via `--promote`.
 *
 * == Status CHECK (verified) ==
 * Migration `drizzle/migrations/0013_add_internal_logic_evidence.sql:27-28`
 * defines CHECK: `status IN ('proposed', 'active', 'superseded')`.
 * `superseded` is explicitly allowed, so `--reject` sets `status='superseded'`
 * + `metadata.reviewOutcome='rejected'` without needing to delete the row.
 *
 * == Modes ==
 * Mining:   Reads canon → LLM proposes → thresholds/dedup → dry-run or apply
 * Review:   --list-proposed | --promote <id…> | --reject <id…>
 *
 * Usage:
 *   npm run mine:internal-logic -- --character zuo_ran [options]
 *   npm run mine:internal-logic -- --list-proposed [--character zuo_ran]
 *   npm run mine:internal-logic -- --promote <id1> [id2 ...]
 *   npm run mine:internal-logic -- --reject <id1> [id2 ...]
 *
 * Mining flags:
 *   --character        Character ID (default: zuo_ran)
 *   --arc              Arc key(s) (comma-separated; default: character's main arcs)
 *   --chapter          Chapter key(s) to scope the run (comma-separated; default: all in arc)
 *   --limit            Max chunks to read (default: 200)
 *   --min-confidence   Minimum confidence score (0-1, default: 0.6)
 *   --dry-run          Print proposals only — no embeddings, no DB writes (DEFAULT)
 *   --apply            Embed + insert proposals into internal_logic_evidence
 *
 * Review flags:
 *   --list-proposed    List proposed rows for a character
 *   --promote <id...>  Promote proposed rows to active
 *   --reject <id...>   Reject proposed rows (→ superseded + reviewOutcome)
 */
import { db } from "../src/db/client";
import { env } from "../src/config/env";
import { loadCharacterDefaults } from "../src/character/characterDefaults";
import { readCanonChunks } from "../src/evidenceMiner/canonReader";
import {
  buildMinerSystemPrompt,
  callLlmForBatch,
  mapAndValidateProposals,
  filterByConfidence,
  dedupByExactMatch,
  dedupEmbeddedProposals,
  buildEvidenceRowData,
  batchChunks,
  listProposedRows,
  promoteRows,
  rejectRows,
} from "../src/evidenceMiner/llmProposer";
import type { ProposedRow } from "../src/evidenceMiner/llmProposer";
import {
  DEFAULT_CHARACTER,
  DEFAULT_MIN_CONFIDENCE,
  BATCH_SIZE,
} from "../src/evidenceMiner/types";
import type {
  CanonChunk,
  MappedProposal,
  ExistingEvidenceRow,
  EvidenceRowData,
} from "../src/evidenceMiner/types";
import { internalLogicEvidence } from "../src/db/schema/internalLogic";
import { embedText } from "../src/llm/embeddings/embedText";
import { eq, and, inArray, sql } from "drizzle-orm";
import { models } from "../src/config/models";

// ---------------------------------------------------------------------------
// CLI argument parsing
// ---------------------------------------------------------------------------

function parseArgs(): {
  character: string;
  arcKeys: string[];
  chapterKeys: string[];
  limit: number;
  minConfidence: number;
  isDryRun: boolean;
  isApply: boolean;
  isListProposed: boolean;
  isPromote: boolean;
  isReject: boolean;
  ids: string[];
} {
  const args = process.argv.slice(2);
  const get = (flag: string): string | undefined => {
    const idx = args.indexOf(flag);
    return idx >= 0 && idx < args.length - 1 ? args[idx + 1] : undefined;
  };
  const has = (flag: string): boolean => args.includes(flag);

  const character = get("--character") ?? DEFAULT_CHARACTER;
  const arcArg = get("--arc");
  const arcKeys = arcArg
    ? arcArg.split(",").map((s) => s.trim()).filter(Boolean)
    : [];

  const chapterArg = get("--chapter");
  const chapterKeys = chapterArg
    ? chapterArg.split(",").map((s) => s.trim()).filter(Boolean)
    : [];

  const limitStr = get("--limit") ?? "200";
  const limit = parseInt(limitStr, 10);
  if (Number.isNaN(limit) || limit < 1) {
    console.error(`[FATAL] Invalid --limit value: "${limitStr}". Must be a positive integer.`);
    process.exit(1);
  }

  const mcStr = get("--min-confidence") ?? String(DEFAULT_MIN_CONFIDENCE);
  const minConfidence = parseFloat(mcStr);
  if (Number.isNaN(minConfidence) || minConfidence < 0 || minConfidence > 1) {
    console.error(`[FATAL] Invalid --min-confidence value: "${mcStr}". Must be a number between 0 and 1.`);
    process.exit(1);
  }

  const isListProposed = has("--list-proposed");
  const isPromote = has("--promote");
  const isReject = has("--reject");
  const isApply = has("--apply");
  const isDryRun = !isApply && !isListProposed && !isPromote && !isReject;

  // Collect IDs after --promote or --reject
  const ids: string[] = [];
  if (isPromote || isReject) {
    const flagIdx = isPromote ? args.indexOf("--promote") : args.indexOf("--reject");
    for (let i = flagIdx + 1; i < args.length; i++) {
      if (args[i]!.startsWith("--")) break;
      ids.push(args[i]!);
    }
  }

  return { character, arcKeys, chapterKeys, limit, minConfidence, isDryRun, isApply, isListProposed, isPromote, isReject, ids };
}

// ---------------------------------------------------------------------------
// Default arc keys for a character (fallback when --arc not provided)
// Resolution order: --arc > EVIDENCE_MINER_ARC_KEYS env > DEFAULT_ARC_KEYS
// ---------------------------------------------------------------------------

const DEFAULT_ARC_KEYS: Record<string, string[]> = {
  zuo_ran: ["main_weiming", "main_yimu", "main_tianmi", "main_zhiai", "main_xiangshou"],
};

function resolveArcKeys(
  characterId: string,
  explicitArcs: string[],
  logSource: boolean = true,
): string[] {
  // 1. --arc flag wins
  if (explicitArcs.length > 0) {
    if (logSource) console.log(`[MINE] Arc source: --arc flag`);
    return explicitArcs;
  }

  // 2. EVIDENCE_MINER_ARC_KEYS env var
  const envRaw = env.EVIDENCE_MINER_ARC_KEYS;
  if (envRaw && envRaw.trim().length > 0) {
    const envArcs = envRaw.split(",").map((s) => s.trim()).filter(Boolean);
    if (envArcs.length > 0) {
      if (logSource) console.log(`[MINE] Arc source: EVIDENCE_MINER_ARC_KEYS env`);
      return envArcs;
    }
  }

  // 3. Built-in defaults (final fallback)
  if (logSource) console.log(`[MINE] Arc source: built-in DEFAULT_ARC_KEYS`);
  return DEFAULT_ARC_KEYS[characterId] ?? [];
}

// ---------------------------------------------------------------------------
// Existing-row fetcher (for dedup)
// ---------------------------------------------------------------------------

async function fetchExistingRows(
  characterId: string,
): Promise<ExistingEvidenceRow[]> {
  try {
    const rows = await db
      .select({
        id: internalLogicEvidence.id,
        node: internalLogicEvidence.node,
        evidenceText: internalLogicEvidence.evidenceText,
        embedding: internalLogicEvidence.embedding,
      })
      .from(internalLogicEvidence)
      .where(
        and(
          eq(internalLogicEvidence.characterId, characterId),
          inArray(internalLogicEvidence.status, ["active", "proposed"]),
        ),
      );
    return rows.map((r) => ({
      id: r.id,
      node: r.node,
      evidenceText: r.evidenceText,
      embedding: r.embedding as number[] | null,
    }));
  } catch (err) {
    console.warn(`[WARN] Could not fetch existing rows for dedup: ${(err as Error).message}`);
    return [];
  }
}

// ---------------------------------------------------------------------------
// Output helpers
// ---------------------------------------------------------------------------

function printProposals(
  proposals: MappedProposal[],
  characterId: string,
  label: string = "proposed evidence rows",
): void {
  console.log(`\n[MINE] ${proposals.length} ${label} for "${characterId}":\n`);
  for (const p of proposals) {
    console.log(`  Node:          ${p.node}`);
    console.log(`  Claim:         ${p.claimText}`);
    console.log(`  Evidence:      ${p.evidenceText.slice(0, 120)}${p.evidenceText.length > 120 ? "..." : ""}`);
    console.log(`  Confidence:    ${p.confidenceScore}`);
    console.log(`  Provenance:    arc="${p.chunk.arcKey}" chapter="${p.chunk.chapterKey}" episode="${p.chunk.episodeLabel}" scene=${p.chunk.sceneOrder} unit=${p.chunk.unitIndex}`);
    console.log("");
  }
}

// ---------------------------------------------------------------------------
// Review subcommands
// ---------------------------------------------------------------------------

function makeReviewDb() {
  return {
    fetchProposed: async (characterId: string): Promise<ProposedRow[]> => {
      const rows = await db
        .select({
          id: internalLogicEvidence.id,
          node: internalLogicEvidence.node,
          claimText: internalLogicEvidence.claimText,
          evidenceText: internalLogicEvidence.evidenceText,
          arcKey: internalLogicEvidence.arcKey,
          chapterKey: internalLogicEvidence.chapterKey,
          episodeLabel: internalLogicEvidence.episodeLabel,
          sceneOrder: internalLogicEvidence.sceneOrder,
          unitIndex: internalLogicEvidence.unitIndex,
          confidenceScore: internalLogicEvidence.confidenceScore,
          createdAt: internalLogicEvidence.createdAt,
          metadata: internalLogicEvidence.metadata,
        })
        .from(internalLogicEvidence)
        .where(
          and(
            eq(internalLogicEvidence.characterId, characterId),
            eq(internalLogicEvidence.status, "proposed"),
          ),
        );
      return rows.map((r) => ({
        ...r,
        metadata: r.metadata as Record<string, unknown>,
      }));
    },
    updateStatus: async (
      ids: string[],
      status: string,
      extra?: Record<string, unknown>,
    ): Promise<number> => {
      if (ids.length === 0) return 0;
      const updateData: Record<string, unknown> = {
        status,
        updatedAt: new Date(),
      };
      if (extra) {
        // For reject: merge reviewOutcome into metadata
        for (const row of await db
          .select({ id: internalLogicEvidence.id, metadata: internalLogicEvidence.metadata })
          .from(internalLogicEvidence)
          .where(inArray(internalLogicEvidence.id, ids))) {
          const meta = (row.metadata as Record<string, unknown>) ?? {};
          await db
            .update(internalLogicEvidence)
            .set({
              status,
              updatedAt: new Date(),
              metadata: { ...meta, ...extra },
            })
            .where(eq(internalLogicEvidence.id, row.id));
        }
        return ids.length;
      }
      const result = await db
        .update(internalLogicEvidence)
        .set(updateData)
        .where(inArray(internalLogicEvidence.id, ids));
      return ids.length;
    },
  };
}

async function runListProposed(characterId: string): Promise<void> {
  const dbInterface = makeReviewDb();
  const rows = await listProposedRows(characterId, dbInterface);
  if (rows.length === 0) {
    console.log(`[REVIEW] No proposed rows for "${characterId}".`);
    return;
  }
  console.log(`\n[REVIEW] ${rows.length} proposed row(s) for "${characterId}":\n`);
  for (const r of rows) {
    const provenance = [r.arcKey, r.chapterKey, r.episodeLabel]
      .filter(Boolean)
      .join(" / ");
    console.log(`  ID:            ${r.id}`);
    console.log(`  Node:          ${r.node}`);
    console.log(`  Claim:         ${r.claimText}`);
    console.log(`  Evidence:      ${r.evidenceText.slice(0, 120)}${r.evidenceText.length > 120 ? "..." : ""}`);
    console.log(`  Confidence:    ${r.confidenceScore ?? "N/A"}`);
    console.log(`  Provenance:    ${provenance || "(none)"}`);
    console.log(`  Created:       ${r.createdAt.toISOString()}`);
    console.log("");
  }
}

async function runPromote(ids: string[]): Promise<void> {
  if (ids.length === 0) {
    console.error("[FATAL] --promote requires at least one ID.");
    process.exit(1);
  }
  const dbInterface = makeReviewDb();
  const count = await promoteRows(ids, dbInterface);
  console.log(`[REVIEW] Promoted ${count} row(s) to active.`);
}

async function runReject(ids: string[]): Promise<void> {
  if (ids.length === 0) {
    console.error("[FATAL] --reject requires at least one ID.");
    process.exit(1);
  }
  const dbInterface = makeReviewDb();
  const count = await rejectRows(ids, dbInterface);
  console.log(`[REVIEW] Rejected ${count} row(s) (→ superseded).`);
}

// ---------------------------------------------------------------------------
// Mining main pipeline
// ---------------------------------------------------------------------------

async function runMine(input: {
  character: string;
  arcKeys: string[];
  chapterKeys: string[];
  limit: number;
  minConfidence: number;
  isDryRun: boolean;
  isApply: boolean;
}): Promise<void> {
  const { character, arcKeys, chapterKeys, limit, minConfidence, isDryRun, isApply } = input;
  const resolvedArcs = resolveArcKeys(character, arcKeys);

  console.log(`[MINE] Character:       ${character}`);
  console.log(`[MINE] Arc keys:        ${resolvedArcs.length > 0 ? resolvedArcs.join(", ") : "(all arcs)"}`);
  console.log(`[MINE] Chapters:        ${chapterKeys.length > 0 ? chapterKeys.join(", ") : "(all in arc)"}`);
  console.log(`[MINE] Max chunks:      ${limit}`);
  console.log(`[MINE] Min confidence:  ${minConfidence}`);
  console.log(`[MINE] Mode:            ${isDryRun ? "DRY-RUN (no DB writes)" : "APPLY"}`);

  // 1. Load character defaults
  let internalLogic: Record<string, string> = {};
  try {
    const defaults = loadCharacterDefaults(character);
    internalLogic = (defaults.internal_logic ?? {}) as Record<string, string>;
  } catch (err) {
    console.error(`[FATAL] Could not load defaults for "${character}": ${(err as Error).message}`);
    process.exit(1);
  }
  const filledNodes = Object.keys(internalLogic).filter((k) => internalLogic[k]?.trim());
  if (filledNodes.length === 0) {
    console.error(`[FATAL] Character "${character}" has no internal_logic node descriptions.`);
    process.exit(1);
  }

  // 2. Read canon chunks
  let chunks: CanonChunk[] = [];
  try {
    chunks = await readCanonChunks({ characterId: character, arcKeys: resolvedArcs, chapterKeys, limit });
    console.log(`[MINE] Read ${chunks.length} canon chunks`);
  } catch (err) {
    console.error(`[FATAL] Failed to read canon: ${(err as Error).message}`);
    process.exit(1);
  }
  if (chunks.length === 0) {
    console.log("[MINE] No canon chunks found.");
    process.exit(0);
  }

  // 3. Build system prompt
  const systemPrompt = buildMinerSystemPrompt(internalLogic);

  // 4. Batch + LLM calls
  const batches = batchChunks(chunks);
  console.log(`[MINE] Processing ${batches.length} batch(es) of up to ${BATCH_SIZE} chunks`);

  let allMapped: MappedProposal[] = [];
  let totalDropped = 0;
  const allWarnings: string[] = [];
  let batchErrors = 0;

  for (let bIdx = 0; bIdx < batches.length; bIdx++) {
    const batch = batches[bIdx]!;
    console.log(`[MINE] Batch ${bIdx + 1}/${batches.length} (${batch.length} chunks)...`);
    const result = await callLlmForBatch(systemPrompt, batch, bIdx);
    if (!result.ok) {
      console.warn(`  [WARN] Batch ${bIdx + 1} LLM call failed: ${result.error}`);
      batchErrors++;
      continue;
    }
    const { valid, dropped, warnings } = mapAndValidateProposals(result.proposals, batch);
    for (const w of warnings) console.warn(`  [WARN] ${w}`);
    totalDropped += dropped;
    allWarnings.push(...warnings);
    allMapped.push(...valid);
    console.log(`  → ${valid.length} valid, ${dropped} dropped`);
  }

  console.log(`\n[MINE] After LLM + mapping: ${allMapped.length} valid proposals`);
  if (allMapped.length === 0) {
    console.log("[MINE] No valid proposals. Nothing to do.");
    process.exit(0);
  }

  // 5. Confidence threshold
  const { kept: afterConf, dropped: confDropped } = filterByConfidence(allMapped, minConfidence);
  console.log(`[MINE] After confidence threshold (>= ${minConfidence}): ${afterConf.length} kept, ${confDropped} dropped`);
  if (afterConf.length === 0) {
    console.log("[MINE] No proposals survived threshold.");
    process.exit(0);
  }

  // 6. Dedup (exact match)
  const existingRows = await fetchExistingRows(character);
  console.log(`[MINE] Existing rows for dedup: ${existingRows.length}`);
  const { kept: afterExact, skipped: exactSkipped } = dedupByExactMatch(afterConf, character, existingRows);
  console.log(`[MINE] After exact-match dedup: ${afterExact.length} kept, ${exactSkipped} skipped`);
  if (afterExact.length === 0) {
    console.log("[MINE] All proposals were exact duplicates.");
    process.exit(0);
  }

  // 7. Dry-run: print and exit
  if (isDryRun) {
    printProposals(afterExact, character, "unique proposals (dry-run)");
    console.log(`[MINE] Dry-run complete. ${afterExact.length} proposals would be inserted with --apply.`);
    console.log("[MINE] No embeddings computed, no DB writes performed.");
    process.exit(0);
  }

  // 8. Apply: embed → embedding dedup → insert
  console.log(`\n[MINE] === APPLY mode: embedding ${afterExact.length} proposals ===`);
  const embedded: Array<{ proposal: MappedProposal; embedding: number[] }> = [];
  let embedFailures = 0;

  for (let i = 0; i < afterExact.length; i++) {
    const p = afterExact[i]!;
    process.stdout.write(`  [${i + 1}/${afterExact.length}] Embedding "${p.node}"... `);
    const emb = await computeEmbedding(p.evidenceText);
    if (!emb) {
      console.log(`SKIP (failed)`);
      embedFailures++;
      continue;
    }
    console.log(`✓`);
    embedded.push({ proposal: p, embedding: emb });
  }

  console.log(`\n[MINE] Embedded: ${embedded.length}, failures: ${embedFailures}`);
  if (embedded.length === 0) {
    console.log("[MINE] No proposals could be embedded.");
    process.exit(1);
  }

  const { kept: afterEmbedDedup, skipped: embedSkipped } = dedupEmbeddedProposals(embedded, existingRows);
  console.log(`[MINE] After embedding dedup: ${afterEmbedDedup.length} kept, ${embedSkipped} skipped`);
  if (afterEmbedDedup.length === 0) {
    console.log("[MINE] All proposals were embedding-duplicates.");
    process.exit(0);
  }

  // 9. Insert
  const minedBatchId = `mine_${Date.now()}`;
  const modelStr = `${models.extractor.provider}:${models.extractor.model}`;
  let inserted = 0;
  let insertFailures = 0;

  for (const item of afterEmbedDedup) {
    const rowData = buildEvidenceRowData(item.proposal, character, item.embedding, {
      model: modelStr,
      promptVersion: "1",
      minedBatchId,
    });
    try {
      await db.insert(internalLogicEvidence).values(rowData);
      inserted++;
    } catch (err) {
      console.error(`  [FAIL] DB insert failed for node="${item.proposal.node}": ${(err as Error).message}`);
      insertFailures++;
    }
  }

  console.log(`\n[MINE] === Apply complete ===`);
  console.log(`Inserted:     ${inserted}`);
  console.log(`Insert fails: ${insertFailures}`);
  console.log(`Batch ID:     ${minedBatchId}`);

  printProposals(
    afterEmbedDedup.map((i) => i.proposal),
    character,
    "inserted evidence rows",
  );

  if (insertFailures > 0) {
    console.error(`[MINE] ${insertFailures} insert(s) failed.`);
    process.exit(1);
  }
  console.log("[MINE] Done.");
}

// ---------------------------------------------------------------------------
// Compute embedding with error handling
// ---------------------------------------------------------------------------

async function computeEmbedding(text: string): Promise<number[] | null> {
  try {
    return await embedText(text);
  } catch (err) {
    console.error(`  [WARN] Embedding failed: ${(err as Error).message}`);
    return null;
  }
}

// ---------------------------------------------------------------------------
// Main dispatcher
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const args = parseArgs();

  if (args.isListProposed) {
    await runListProposed(args.character);
  } else if (args.isPromote) {
    await runPromote(args.ids);
  } else if (args.isReject) {
    await runReject(args.ids);
  } else {
    await runMine(args);
  }
}

main().catch((err) => {
  console.error("[FATAL] Unhandled error:", err);
  process.exit(1);
});
