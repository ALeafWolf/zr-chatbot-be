/**
 * LLM proposal step for the evidence miner.
 *
 * Builds prompts with the character's internal-logic node texts as rubric,
 * calls `chatJsonWithFallback` for each batch, then maps `chunkRef` back to
 * provenance and validates nodes against the 8-node union.
 *
 * TG2 additions: confidence threshold filtering, dedup (exact + cosine-sim),
 * and evidence row-data construction.
 */
import type { z } from "zod";
import { models } from "../config/models";
import { chatJsonWithFallback } from "../llm/providers";
import {
  LlmProposalOutputSchema,
  INTERNAL_LOGIC_NODES,
  BATCH_SIZE,
  DEDUP_SIM,
} from "./types";
import type {
  CanonChunk,
  InternalLogicNode,
  LlmProposal,
  LlmProposalOutput,
  MappedProposal,
  ExistingEvidenceRow,
  EvidenceRowData,
} from "./types";

// ---------------------------------------------------------------------------
// Prompt builders
// ---------------------------------------------------------------------------

/**
 * Build the Chinese system prompt for evidence-mining LLM calls.
 *
 * Injects the character's 8 internal-logic node texts as the rubric, plus
 * attribution grounding rules (target is 左然), and requires Chinese output.
 */
export function buildMinerSystemPrompt(
  internalLogic: Record<string, string>,
): string {
  const nodeList = INTERNAL_LOGIC_NODES.map((key) => {
    const text = internalLogic[key] ?? "(无描述)";
    return `- ${key}：${text}`;
  }).join("\n");

  return `你是一个角色内在逻辑的证据挖掘助手。你的任务是从叙事文本片断中提取证据，将其与角色的内在逻辑节点关联起来。

## 内在逻辑节点列表

${nodeList}

## 规则

1. 每个片断可能包含一条或多条证据，对应不同的节点。
2. 如果某个片断不包含任何节点的证据，则跳过该片断。
3. 输出格式（JSON）：
   - \`chunkRef\`：该片断在当前批次中的序号（从0开始）
   - \`node\`：上述8个节点之一的英文键名（完全匹配，如 "core_belief"）
   - \`claimText\`：**用中文写**，简要陈述该证据支持的内在逻辑主张
   - \`evidenceText\`：**用中文写**，直接引用或忠实概括原文中支持该主张的内容。必须在原文中有依据，不得编造。
   - \`confidenceScore\`：0.0–1.0，表示该片断对节点的支持清晰度
4. 同一个 chunkRef 可以出现在多条提案中，如果该片断支持多个节点。
5. 不得编造证据。每条 evidenceText 必须可追溯至所提供的原文。

## 归因规则（目标角色：左然）

证据必须**关于左然**——即左然本人说的话、做的事，或者其他角色通过上下文明确在描述/提及左然。

- ✅ **可直接归因**：片断为左然本人的对话（speaker=左然）或叙述中描述左然的行动（speaker=<user>或speaker=null且内容是左然的行为）。置信度 0.8–0.95。
- ✅ **间接归因**：其他角色通过对话或上下文明确在描述左然。置信度 0.5–0.7。
- ✅ **推断性归因**：上下文强烈暗示，但并非直接关于左然。置信度 ≤0.5，或跳过。
- ❌ **拒绝**：第一人称叙述者的自我内心独白（"我"的回忆、感受、评价），如果明显是关于叙述者自己而不是关于左然。此类片断即使与内在逻辑主题相关也不应被提取为左然的证据。`;
}

/**
 * Build a Chinese user message for one batch of chunks.
 *
 * Includes chunk indices (0-based), speaker, text, and scene-local context
 * (before/after) so the model can judge attribution.
 */
export function buildBatchUserMessage(
  batch: CanonChunk[],
  _batchIndex: number,
): string {
  const chunkList = batch
    .map((chunk, i) => {
      const ctxBefore = chunk.contextBefore.length > 0
        ? "\n    上文：" + chunk.contextBefore.map((c) => `[${c.speaker ?? "无发言人"}] ${c.text.slice(0, 80)}`).join("\n          ")
        : "";
      const ctxAfter = chunk.contextAfter.length > 0
        ? "\n    下文：" + chunk.contextAfter.map((c) => `[${c.speaker ?? "无发言人"}] ${c.text.slice(0, 80)}`).join("\n          ")
        : "";

      return `[片断 ${i}]
  发言人：${chunk.speaker ?? "（无）"}
  内容：${chunk.text}
  出处：arc="${chunk.arcKey}", chapter="${chunk.chapterKey}", episode="${chunk.episodeLabel}", scene=${chunk.sceneOrder}, unit=${chunk.unitIndex}${ctxBefore}${ctxAfter}`;
    })
    .join("\n\n");

  return `分析以下叙事片断，为左然（zuo_ran）的内在逻辑节点提取证据。使用片断序号作为 \`chunkRef\`。

${chunkList}

以JSON格式回复：{ "proposals": [{ "chunkRef": number, "node": string, "claimText": string（中文）, "evidenceText": string（中文）, "confidenceScore": number }] }`;
}

// ---------------------------------------------------------------------------
// LLM call
// ---------------------------------------------------------------------------

export interface BatchLlmResult {
  ok: boolean;
  proposals: LlmProposal[];
  error?: string;
}

/**
 * Call the LLM for a single batch of chunks.
 *
 * The LLM boundary is injectable for testing — pass `llmCall` to override.
 */
export async function callLlmForBatch(
  systemPrompt: string,
  batch: CanonChunk[],
  batchIndex: number,
  llmCall?: (
    system: string,
    user: string,
  ) => Promise<
    | { ok: true; data: LlmProposalOutput }
    | { ok: false; error: string }
  >,
): Promise<BatchLlmResult> {
  const userMessage = buildBatchUserMessage(batch, batchIndex);

  const callFn =
    llmCall ??
    (async (system: string, user: string) => {
      const result = await chatJsonWithFallback(
        models.extractor,
        models.fallbacks.postTurnExtractor,
        [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
        LlmProposalOutputSchema as unknown as z.ZodType<
          LlmProposalOutput,
          z.ZodTypeDef,
          unknown
        >,
        { maxTokens: 2048, temperature: 0.3 },
      );
      if (!result.ok) {
        return { ok: false as const, error: result.error ?? "LLM call failed" };
      }
      return { ok: true as const, data: result.data as LlmProposalOutput };
    });

  try {
    const result = await callFn(systemPrompt, userMessage);
    if (!result.ok) {
      return { ok: false, proposals: [], error: result.error };
    }
    return { ok: true, proposals: result.data.proposals };
  } catch (err) {
    return {
      ok: false,
      proposals: [],
      error: (err as Error).message,
    };
  }
}

// ---------------------------------------------------------------------------
// Mapping + validation
// ---------------------------------------------------------------------------

/**
 * Map raw LLM proposals back to chunk provenance and validate nodes.
 *
 * Steps:
 * 1. Drop proposals with chunkRefs outside the batch range.
 * 2. Drop proposals with invalid node names (warn each).
 * 3. Map chunkRef → full provenance from the original chunk list.
 */
export function mapAndValidateProposals(
  proposals: LlmProposal[],
  chunks: CanonChunk[],
): { valid: MappedProposal[]; dropped: number; warnings: string[] } {
  const warnings: string[] = [];
  const valid: MappedProposal[] = [];
  let dropped = 0;

  const validNodes = new Set<string>(INTERNAL_LOGIC_NODES);

  for (const p of proposals) {
    // Check chunkRef bounds
    if (p.chunkRef < 0 || p.chunkRef >= chunks.length) {
      warnings.push(
        `Dropped proposal: chunkRef ${p.chunkRef} out of range (0-${chunks.length - 1})`,
      );
      dropped++;
      continue;
    }

    // Validate node
    if (!validNodes.has(p.node)) {
      warnings.push(
        `Dropped proposal: invalid node "${p.node}" (chunkRef ${p.chunkRef})`,
      );
      dropped++;
      continue;
    }

    valid.push({
      chunk: chunks[p.chunkRef]!,
      node: p.node as InternalLogicNode,
      claimText: p.claimText,
      evidenceText: p.evidenceText,
      confidenceScore: p.confidenceScore,
    });
  }

  return { valid, dropped, warnings };
}

// ---------------------------------------------------------------------------
// TG2: Confidence threshold
// ---------------------------------------------------------------------------

/**
 * Filter proposals below the minimum confidence threshold.
 * Returns only proposals with confidenceScore >= minConfidence.
 */
export function filterByConfidence(
  proposals: MappedProposal[],
  minConfidence: number,
): { kept: MappedProposal[]; dropped: number } {
  const kept: MappedProposal[] = [];
  let dropped = 0;

  for (const p of proposals) {
    if (p.confidenceScore < minConfidence) {
      dropped++;
    } else {
      kept.push(p);
    }
  }

  return { kept, dropped };
}

// ---------------------------------------------------------------------------
// TG2: De-duplication
// ---------------------------------------------------------------------------

/**
 * Normalize evidence text for exact-match dedup (lowercase, trim, collapse
 * whitespace).
 */
export function normalizeEvidenceText(text: string): string {
  return text.toLowerCase().trim().replace(/\s+/g, " ");
}

/**
 * Compute cosine similarity between two vectors.
 */
export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length === 0) return 0;
  let dot = 0,
    normA = 0,
    normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dot / denom;
}

/**
 * Dedup by exact normalized evidence text match.
 *
 * Returns proposals that do NOT have an existing row with the same
 * `(characterId, node, normalized evidenceText)`.
 */
export function dedupByExactMatch(
  proposals: MappedProposal[],
  characterId: string,
  existingRows: ExistingEvidenceRow[],
): { kept: MappedProposal[]; skipped: number } {
  // Build a set of "node::normalizedText" for existing rows
  const existingKeys = new Set<string>();
  for (const row of existingRows) {
    existingKeys.add(
      `${row.node}::${normalizeEvidenceText(row.evidenceText)}`,
    );
  }

  const kept: MappedProposal[] = [];
  let skipped = 0;

  for (const p of proposals) {
    const key = `${p.node}::${normalizeEvidenceText(p.evidenceText)}`;
    if (existingKeys.has(key)) {
      skipped++;
    } else {
      kept.push(p);
    }
  }

  return { kept, skipped };
}

/**
 * Check if a single new embedding is a duplicate of any existing row
 * for the same node using cosine similarity.
 *
 * Returns `true` if the new embedding's cosine similarity to any existing
 * row (same node, with embedding) meets or exceeds the threshold.
 */
export function isEmbeddingDuplicate(
  newEmbedding: number[],
  node: string,
  existingRows: ExistingEvidenceRow[],
  threshold: number = DEDUP_SIM,
  similarityFn: (a: number[], b: number[]) => number = cosineSimilarity,
): boolean {
  for (const row of existingRows) {
    if (row.node !== node) continue;
    if (!row.embedding) continue;
    const sim = similarityFn(newEmbedding, row.embedding);
    if (sim >= threshold) return true;
  }
  return false;
}

/**
 * Dedup embedded proposals by comparing their embeddings against existing
 * rows for the same node.
 *
 * Takes proposals paired with their computed embeddings and returns those
 * whose embedding does NOT exceed the similarity threshold with any existing
 * row for the same node.
 */
export function dedupEmbeddedProposals(
  proposals: Array<{ proposal: MappedProposal; embedding: number[] }>,
  existingRows: ExistingEvidenceRow[],
  threshold: number = DEDUP_SIM,
  similarityFn?: (a: number[], b: number[]) => number,
): { kept: Array<{ proposal: MappedProposal; embedding: number[] }>; skipped: number } {
  const kept: Array<{ proposal: MappedProposal; embedding: number[] }> = [];
  let skipped = 0;

  for (const item of proposals) {
    const isDup = isEmbeddingDuplicate(
      item.embedding,
      item.proposal.node,
      existingRows,
      threshold,
      similarityFn,
    );
    if (isDup) {
      skipped++;
    } else {
      kept.push(item);
    }
  }

  return { kept, skipped };
}

// ---------------------------------------------------------------------------
// TG2: Row-data construction (mirrors seedInternalLogicEvidence.ts)
// ---------------------------------------------------------------------------

/**
 * Build an `EvidenceRowData` object for insertion, mirroring the pattern in
 * `scripts/seedInternalLogicEvidence.ts` but with TG2-specific fields.
 */
export function buildEvidenceRowData(
  proposal: MappedProposal,
  characterId: string,
  embedding: number[] | null,
  metadata: {
    model?: string;
    promptVersion?: string;
    minedBatchId: string;
  },
): EvidenceRowData {
  return {
    characterId,
    node: proposal.node,
    claimText: proposal.claimText,
    evidenceText: proposal.evidenceText,
    embedding,
    arcKey: proposal.chunk.arcKey ?? null,
    chapterKey: proposal.chunk.chapterKey ?? null,
    episodeLabel: proposal.chunk.episodeLabel ?? null,
    sceneOrder: proposal.chunk.sceneOrder ?? null,
    unitIndex: proposal.chunk.unitIndex ?? null,
    storySceneId: proposal.chunk.storySceneId ?? null,
    scopeApplicability: {},
    sourceKind: "canon",
    status: "proposed",
    confidenceScore: proposal.confidenceScore ?? null,
    metadata: {
      source: "evidence_miner",
      model: metadata.model,
      promptVersion: metadata.promptVersion,
      minedAt: new Date().toISOString(),
      sourceUnitIndex: proposal.chunk.unitIndex,
      sourceSceneOrder: proposal.chunk.sceneOrder,
      minedBatchId: metadata.minedBatchId,
    },
  };
}

// ---------------------------------------------------------------------------
// TG3: Review helpers (injectable DB boundary)
// ---------------------------------------------------------------------------

/** Shape of a proposed row returned by the DB. */
export interface ProposedRow {
  id: string;
  node: string;
  claimText: string;
  evidenceText: string;
  arcKey: string | null;
  chapterKey: string | null;
  episodeLabel: string | null;
  sceneOrder: number | null;
  unitIndex: number | null;
  confidenceScore: number | null;
  createdAt: Date;
  metadata: Record<string, unknown>;
}

/** Injectable DB interface for review operations. */
export interface ReviewDb {
  fetchProposed(characterId: string): Promise<ProposedRow[]>;
  updateStatus(ids: string[], status: string, extra?: Record<string, unknown>): Promise<number>;
}

/**
 * List proposed rows for a character, ordered by node then confidence desc.
 */
export async function listProposedRows(
  characterId: string,
  db: ReviewDb,
): Promise<ProposedRow[]> {
  const rows = await db.fetchProposed(characterId);
  rows.sort((a, b) => {
    const nodeCmp = a.node.localeCompare(b.node);
    if (nodeCmp !== 0) return nodeCmp;
    return (b.confidenceScore ?? 0) - (a.confidenceScore ?? 0);
  });
  return rows;
}

/**
 * Promote proposed rows to active.
 * Returns the number of rows updated.
 */
export async function promoteRows(
  ids: string[],
  db: ReviewDb,
): Promise<number> {
  if (ids.length === 0) return 0;
  return db.updateStatus(ids, "active");
}

/**
 * Reject proposed rows by marking them superseded + reviewOutcome.
 * Returns the number of rows updated.
 *
 * Status note: migration `0013` CHECK constraint allows 'superseded',
 * so we reuse it rather than deleting. The human decision is recorded
 * in `metadata.reviewOutcome='rejected'`.
 */
export async function rejectRows(
  ids: string[],
  db: ReviewDb,
): Promise<number> {
  if (ids.length === 0) return 0;
  return db.updateStatus(ids, "superseded", { reviewOutcome: "rejected" });
}

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

/**
 * Split chunks into batches of at most `batchSize`.
 */
export function batchChunks(
  chunks: CanonChunk[],
  batchSize: number = BATCH_SIZE,
): CanonChunk[][] {
  const batches: CanonChunk[][] = [];
  for (let i = 0; i < chunks.length; i += batchSize) {
    batches.push(chunks.slice(i, i + batchSize));
  }
  return batches;
}
