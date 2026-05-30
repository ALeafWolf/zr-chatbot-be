/**
 * Unit tests for the evidence miner core (TG1 + TG2 + TG3).
 *
 * Tests pure functions with no live LLM or DB:
 * - TG1: prompt builders, chunkRef→provenance mapping, node validation, batching, LLM call
 * - TG2: confidence threshold, exact-match dedup, embedding-sim dedup, rowData construction
 * - TG3: review helpers (listProposedRows, promoteRows, rejectRows) with injectable DB boundary
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildMinerSystemPrompt,
  buildBatchUserMessage,
  callLlmForBatch,
  mapAndValidateProposals,
  filterByConfidence,
  dedupByExactMatch,
  dedupEmbeddedProposals,
  isEmbeddingDuplicate,
  buildEvidenceRowData,
  batchChunks,
  normalizeEvidenceText,
  cosineSimilarity,
  listProposedRows,
  promoteRows,
  rejectRows,
} from "./llmProposer";
import type { ReviewDb, ProposedRow } from "./llmProposer";
import { INTERNAL_LOGIC_NODES } from "./types";
import type {
  CanonChunk,
  InternalLogicNode,
  LlmProposal,
  LlmProposalOutput,
  MappedProposal,
  ExistingEvidenceRow,
  EvidenceRowData,
  ContextUnit,
} from "./types";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const FIXTURE_CHUNKS: CanonChunk[] = [
  {
    text: "Zuo Ran walked into the courtroom, his posture straight and his notes perfectly organized. He reviewed every document twice before presenting.",
    speaker: "narrator",
    arcKey: "main_zhiai",
    chapterKey: "evidence_chapter",
    episodeLabel: "Episode 1",
    sceneOrder: 3,
    unitIndex: 5,
    storySceneId: "00000000-0000-0000-0000-000000000001",
    contextBefore: [],
    contextAfter: [],
  },
  {
    text: "At home, he quietly placed a small gift on the table — a book she had mentioned once, weeks ago. He said nothing about it.",
    speaker: "narrator",
    arcKey: "main_zhiai",
    chapterKey: "evidence_chapter",
    episodeLabel: "Episode 2",
    sceneOrder: 1,
    unitIndex: 12,
    storySceneId: "00000000-0000-0000-0000-000000000002",
    contextBefore: [],
    contextAfter: [],
  },
  {
    text: "When asked about his feelings, he paused for a long moment, then changed the subject to the weather. His hands were steady but his eyes gave him away.",
    speaker: "narrator",
    arcKey: "main_zhiai",
    chapterKey: "evidence_chapter",
    episodeLabel: "Episode 3",
    sceneOrder: 5,
    unitIndex: 3,
    storySceneId: "00000000-0000-0000-0000-000000000003",
    contextBefore: [],
    contextAfter: [],
  },
];

const FIXTURE_INTERNAL_LOGIC: Record<string, string> = {
  growth_environment: "Zuo Ran grew up in a warm but demanding family.",
  core_belief: "Rules and order are protection, not束缚.",
  core_motivation: "He expresses care through anticipatory action.",
  core_fear: "He fears letting others down due to his own inadequacy.",
  defense_mechanism: "He pauses, deflects, or retreats to facts when emotions rise.",
  transition_rule: "He moves from restraint to openness through visible intermediate states.",
  relationship_scope_gate: "His internal depth only activates in established intimacy.",
  expression_constraint: "He never psychoanalyzes his own communication patterns.",
};

// ---------------------------------------------------------------------------
// TG1: buildMinerSystemPrompt
// ---------------------------------------------------------------------------

describe("buildMinerSystemPrompt", () => {
  it("includes all 8 node descriptions in Chinese", () => {
    const prompt = buildMinerSystemPrompt(FIXTURE_INTERNAL_LOGIC);
    for (const node of INTERNAL_LOGIC_NODES) {
      // Node key appears as English enum key (e.g. "core_belief")
      assert.ok(
        prompt.includes(node),
        `prompt should mention node "${node}"`,
      );
    }
  });

  it("includes Chinese grounding rules (no invent, chunkRef, confidenceScore)", () => {
    const prompt = buildMinerSystemPrompt(FIXTURE_INTERNAL_LOGIC);
    // Rules are in Chinese now
    assert.ok(prompt.includes("chunkRef"));
    assert.ok(prompt.includes("confidenceScore"));
    assert.ok(prompt.includes("不得编造"));
    assert.ok(prompt.includes("内在逻辑节点"));
    assert.ok(prompt.includes("归因规则"));
    assert.ok(prompt.includes("左然"));
  });

  it("handles empty internalLogic gracefully", () => {
    const prompt = buildMinerSystemPrompt({});
    for (const node of INTERNAL_LOGIC_NODES) {
      assert.ok(
        prompt.includes(node),
        `prompt should mention node "${node}" even without descriptions`,
      );
    }
    // Should show (无描述) instead of (no description available)
    assert.ok(prompt.includes("无描述"));
  });
});

// ---------------------------------------------------------------------------
// TG1: buildBatchUserMessage
// ---------------------------------------------------------------------------

describe("buildBatchUserMessage", () => {
  it("includes chunk indices and provenance in Chinese format", () => {
    const msg = buildBatchUserMessage(FIXTURE_CHUNKS, 0);
    // Chinese format uses 片断 instead of Chunk
    assert.ok(msg.includes("[片断 0]"));
    assert.ok(msg.includes("[片断 1]"));
    assert.ok(msg.includes("[片断 2]"));
    assert.ok(msg.includes("main_zhiai"));
    assert.ok(msg.includes("evidence_chapter"));
  });

  it("includes chunk text content and speaker", () => {
    const msg = buildBatchUserMessage(FIXTURE_CHUNKS, 0);
    assert.ok(msg.includes("courtroom"));
    assert.ok(msg.includes("small gift"));
    assert.ok(msg.includes("changed the subject"));
    // Speaker info should be present
    assert.ok(msg.includes("发言人"));
  });

  it("includes context before/after when present", () => {
    const chunksWithContext: CanonChunk[] = [
      {
        ...FIXTURE_CHUNKS[0]!,
        contextBefore: [
          { text: "Previous line.", speaker: "narrator", unitIndex: 4 },
        ],
        contextAfter: [
          { text: "Next line.", speaker: "左然", unitIndex: 6 },
        ],
      },
    ];
    const msg = buildBatchUserMessage(chunksWithContext, 0);
    assert.ok(msg.includes("上文"));
    assert.ok(msg.includes("下文"));
    assert.ok(msg.includes("Previous line."));
    assert.ok(msg.includes("Next line."));
    assert.ok(msg.includes("左然"));
  });
});

// ---------------------------------------------------------------------------
// TG1: mapAndValidateProposals
// ---------------------------------------------------------------------------

describe("mapAndValidateProposals", () => {
  it("maps chunkRef to correct provenance", () => {
    const proposals: LlmProposal[] = [
      {
        chunkRef: 0,
        node: "core_belief",
        claimText: "Zuo Ran believes in thorough preparation.",
        evidenceText: "He reviewed every document twice.",
        confidenceScore: 0.85,
      },
      {
        chunkRef: 1,
        node: "core_motivation",
        claimText: "He expresses care through unspoken actions.",
        evidenceText: "He placed a gift on the table without mentioning it.",
        confidenceScore: 0.9,
      },
    ];

    const { valid, dropped, warnings } = mapAndValidateProposals(
      proposals,
      FIXTURE_CHUNKS,
    );

    assert.equal(valid.length, 2);
    assert.equal(dropped, 0);
    assert.equal(warnings.length, 0);

    assert.equal(
      valid[0]!.chunk.storySceneId,
      "00000000-0000-0000-0000-000000000001",
    );
    assert.equal(valid[0]!.node, "core_belief");
    assert.equal(valid[1]!.chunk.storySceneId, "00000000-0000-0000-0000-000000000002");
    assert.equal(valid[1]!.node, "core_motivation");
    assert.equal(valid[1]!.confidenceScore, 0.9);
  });

  it("drops proposals with invalid node names", () => {
    const proposals: LlmProposal[] = [
      {
        chunkRef: 0,
        node: "core_belief",
        claimText: "Valid claim",
        evidenceText: "Some evidence",
        confidenceScore: 0.8,
      },
      {
        chunkRef: 1,
        node: "nonexistent_node",
        claimText: "Invalid node",
        evidenceText: "Some evidence",
        confidenceScore: 0.7,
      },
      {
        chunkRef: 2,
        node: "NOT_A_NODE",
        claimText: "Also invalid",
        evidenceText: "Some evidence",
        confidenceScore: 0.6,
      },
    ];

    const { valid, dropped, warnings } = mapAndValidateProposals(
      proposals,
      FIXTURE_CHUNKS,
    );

    assert.equal(valid.length, 1);
    assert.equal(dropped, 2);
    assert.equal(warnings.length, 2);
    assert.equal(valid[0]!.node, "core_belief");
    const warnText = warnings.join(" ");
    assert.ok(warnText.includes("nonexistent_node"));
    assert.ok(warnText.includes("NOT_A_NODE"));
  });

  it("drops proposals with out-of-range chunkRef", () => {
    const proposals: LlmProposal[] = [
      {
        chunkRef: 0,
        node: "core_belief",
        claimText: "Valid",
        evidenceText: "Text",
        confidenceScore: 0.8,
      },
      {
        chunkRef: 999,
        node: "core_fear",
        claimText: "Out of range",
        evidenceText: "Text",
        confidenceScore: 0.7,
      },
      {
        chunkRef: -1,
        node: "core_motivation",
        claimText: "Negative ref",
        evidenceText: "Text",
        confidenceScore: 0.6,
      },
    ];

    const { valid, dropped, warnings } = mapAndValidateProposals(
      proposals,
      FIXTURE_CHUNKS,
    );

    assert.equal(valid.length, 1);
    assert.equal(dropped, 2);
    const warnText = warnings.join(" ");
    assert.ok(warnText.includes("999"));
    assert.ok(warnText.includes("-1"));
  });

  it("preserves all fields on valid proposals", () => {
    const proposals: LlmProposal[] = [
      {
        chunkRef: 2,
        node: "defense_mechanism",
        claimText: "He deflects when emotions surface.",
        evidenceText: "He changed the subject when asked about feelings.",
        confidenceScore: 0.75,
      },
    ];

    const { valid } = mapAndValidateProposals(proposals, FIXTURE_CHUNKS);

    assert.equal(valid.length, 1);
    assert.equal(valid[0]!.node, "defense_mechanism");
    assert.equal(valid[0]!.claimText, "He deflects when emotions surface.");
    assert.equal(valid[0]!.evidenceText, "He changed the subject when asked about feelings.");
    assert.equal(valid[0]!.confidenceScore, 0.75);
    assert.equal(valid[0]!.chunk.storySceneId, "00000000-0000-0000-0000-000000000003");
  });

  it("returns empty arrays for empty input", () => {
    const { valid, dropped, warnings } = mapAndValidateProposals([], FIXTURE_CHUNKS);
    assert.equal(valid.length, 0);
    assert.equal(dropped, 0);
    assert.equal(warnings.length, 0);
  });
});

// ---------------------------------------------------------------------------
// TG1: batchChunks
// ---------------------------------------------------------------------------

describe("batchChunks", () => {
  it("splits into correct batch sizes", () => {
    const batches = batchChunks(FIXTURE_CHUNKS, 2);
    assert.equal(batches.length, 2);
    assert.equal(batches[0]!.length, 2);
    assert.equal(batches[1]!.length, 1);
  });

  it("returns single batch if batchSize >= chunks.length", () => {
    const batches = batchChunks(FIXTURE_CHUNKS, 10);
    assert.equal(batches.length, 1);
    assert.equal(batches[0]!.length, 3);
  });

  it("returns empty array for empty input", () => {
    const batches = batchChunks([], 5);
    assert.equal(batches.length, 0);
  });

  it("uses default BATCH_SIZE when not specified", () => {
    const manyChunks: CanonChunk[] = Array.from({ length: 40 }, (_, i) => ({
      text: `Chunk ${i}`,
      speaker: null,
      arcKey: "test",
      chapterKey: "ch",
      episodeLabel: "ep",
      sceneOrder: i,
      unitIndex: 0,
      storySceneId: `id-${i}`,
      contextBefore: [],
      contextAfter: [],
    }));
    const batches = batchChunks(manyChunks);
    for (const b of batches) {
      assert.ok(b.length <= 15, `batch should not exceed 15, got ${b.length}`);
    }
  });
});

// ---------------------------------------------------------------------------
// TG1: callLlmForBatch
// ---------------------------------------------------------------------------

describe("callLlmForBatch", () => {
  it("returns proposals from injected LLM", async () => {
    const fakeLlm = async (_system: string, _user: string) => {
      return {
        ok: true as const,
        data: {
          proposals: [
            {
              chunkRef: 0,
              node: "core_belief",
              claimText: "Thorough preparation",
              evidenceText: "Reviewed documents twice",
              confidenceScore: 0.8,
            },
          ],
        } as LlmProposalOutput,
      };
    };

    const result = await callLlmForBatch(
      "system",
      FIXTURE_CHUNKS.slice(0, 1),
      0,
      fakeLlm,
    );

    assert.ok(result.ok);
    assert.equal(result.proposals.length, 1);
    assert.equal(result.proposals[0]!.node, "core_belief");
    assert.equal(result.proposals[0]!.chunkRef, 0);
  });

  it("handles LLM failure gracefully", async () => {
    const failingLlm = async (_system: string, _user: string) => {
      return { ok: false as const, error: "LLM rate limited" };
    };

    const result = await callLlmForBatch(
      "system",
      FIXTURE_CHUNKS.slice(0, 1),
      0,
      failingLlm,
    );

    assert.ok(!result.ok);
    assert.equal(result.proposals.length, 0);
    assert.ok(result.error?.includes("LLM rate limited"));
  });

  it("handles thrown errors gracefully", async () => {
    const throwingLlm = async (_system: string, _user: string) => {
      throw new Error("Network error");
    };

    const result = await callLlmForBatch(
      "system",
      FIXTURE_CHUNKS.slice(0, 1),
      0,
      throwingLlm,
    );

    assert.ok(!result.ok);
    assert.equal(result.proposals.length, 0);
    assert.ok(result.error?.includes("Network error"));
  });
});

// ---------------------------------------------------------------------------
// TG2: filterByConfidence
// ---------------------------------------------------------------------------

describe("filterByConfidence", () => {
  const makeProposal = (node: string, score: number): MappedProposal => ({
    chunk: FIXTURE_CHUNKS[0]!,
    node: node as InternalLogicNode,
    claimText: "Test claim",
    evidenceText: "Test evidence",
    confidenceScore: score,
  });

  it("keeps proposals above or equal to threshold", () => {
    const proposals = [makeProposal("core_belief", 0.8), makeProposal("core_fear", 0.6)];
    const { kept, dropped } = filterByConfidence(proposals, 0.6);
    assert.equal(kept.length, 2);
    assert.equal(dropped, 0);
  });

  it("drops proposals below threshold", () => {
    const proposals = [
      makeProposal("core_belief", 0.8),
      makeProposal("core_fear", 0.4),
      makeProposal("core_motivation", 0.2),
    ];
    const { kept, dropped } = filterByConfidence(proposals, 0.6);
    assert.equal(kept.length, 1);
    assert.equal(dropped, 2);
    assert.equal(kept[0]!.node, "core_belief");
  });

  it("keeps nothing when all below threshold", () => {
    const proposals = [makeProposal("core_belief", 0.3), makeProposal("core_fear", 0.5)];
    const { kept, dropped } = filterByConfidence(proposals, 0.6);
    assert.equal(kept.length, 0);
    assert.equal(dropped, 2);
  });

  it("handles empty input", () => {
    const { kept, dropped } = filterByConfidence([], 0.6);
    assert.equal(kept.length, 0);
    assert.equal(dropped, 0);
  });
});

// ---------------------------------------------------------------------------
// TG2: exact-match dedup
// ---------------------------------------------------------------------------

describe("dedupByExactMatch", () => {
  const makeProposal = (node: string, evidenceText: string): MappedProposal => ({
    chunk: FIXTURE_CHUNKS[0]!,
    node: node as InternalLogicNode,
    claimText: "Test claim",
    evidenceText,
    confidenceScore: 0.8,
  });

  const makeExisting = (node: string, evidenceText: string): ExistingEvidenceRow => ({
    id: "existing-id",
    node,
    evidenceText,
    embedding: null,
  });

  it("skips proposals with exact matching (characterId, node, evidenceText)", () => {
    const proposals = [
      makeProposal("core_belief", "Zuo Ran prepared thoroughly."),
      makeProposal("core_fear", "He was afraid of letting others down."),
    ];
    const existing = [makeExisting("core_belief", "Zuo Ran prepared thoroughly.")];

    const { kept, skipped } = dedupByExactMatch(proposals, "zuo_ran", existing);
    assert.equal(kept.length, 1);
    assert.equal(skipped, 1);
    assert.equal(kept[0]!.node, "core_fear");
  });

  it("is case-insensitive for evidence text", () => {
    const proposals = [
      makeProposal("core_belief", "Zuo Ran Prepared Thoroughly."),
    ];
    const existing = [makeExisting("core_belief", "zuo ran prepared thoroughly.")];

    const { kept, skipped } = dedupByExactMatch(proposals, "zuo_ran", existing);
    assert.equal(kept.length, 0);
    assert.equal(skipped, 1);
  });

  it("normalizes whitespace for comparison", () => {
    const proposals = [
      makeProposal("core_belief", "Zuo  Ran   Prepared Thoroughly."),
    ];
    const existing = [makeExisting("core_belief", "Zuo Ran Prepared Thoroughly.")];

    const { kept, skipped } = dedupByExactMatch(proposals, "zuo_ran", existing);
    assert.equal(kept.length, 0);
    assert.equal(skipped, 1);
  });

  it("distinguishes same text under different nodes", () => {
    const proposals = [
      makeProposal("core_belief", "Same evidence text."),
    ];
    const existing = [makeExisting("core_fear", "Same evidence text.")];

    const { kept, skipped } = dedupByExactMatch(proposals, "zuo_ran", existing);
    assert.equal(kept.length, 1);
    assert.equal(skipped, 0);
  });

  it("handles empty existing rows", () => {
    const proposals = [makeProposal("core_belief", "Some text")];
    const { kept, skipped } = dedupByExactMatch(proposals, "zuo_ran", []);
    assert.equal(kept.length, 1);
    assert.equal(skipped, 0);
  });
});

// ---------------------------------------------------------------------------
// TG2: normalizeEvidenceText
// ---------------------------------------------------------------------------

describe("normalizeEvidenceText", () => {
  it("lowercases text", () => {
    assert.equal(normalizeEvidenceText("HELLO World"), "hello world");
  });

  it("trims whitespace", () => {
    assert.equal(normalizeEvidenceText("  hello  "), "hello");
  });

  it("collapses internal whitespace", () => {
    assert.equal(normalizeEvidenceText("hello   world\n  foo"), "hello world foo");
  });
});

// ---------------------------------------------------------------------------
// TG2: cosineSimilarity
// ---------------------------------------------------------------------------

describe("cosineSimilarity", () => {
  it("returns 1 for identical vectors", () => {
    assert.equal(cosineSimilarity([1, 2, 3], [1, 2, 3]), 1);
  });

  it("returns 0 for orthogonal vectors", () => {
    assert.equal(cosineSimilarity([1, 0], [0, 1]), 0);
  });

  it("returns a value between 0 and 1 for non-identical vectors", () => {
    const sim = cosineSimilarity([1, 2, 3], [1, 2, 0]);
    assert.ok(sim > 0 && sim < 1);
  });

  it("returns 0 for empty vectors", () => {
    assert.equal(cosineSimilarity([], []), 0);
  });

  it("returns 0 for mismatched lengths", () => {
    assert.equal(cosineSimilarity([1, 2], [1, 2, 3]), 0);
  });

  it("returns 0 when magnitude is 0", () => {
    assert.equal(cosineSimilarity([0, 0], [1, 2]), 0);
  });
});

// ---------------------------------------------------------------------------
// TG2: isEmbeddingDuplicate
// ---------------------------------------------------------------------------

describe("isEmbeddingDuplicate", () => {
  it("returns true when embedding exceeds threshold for same node", () => {
    const existing: ExistingEvidenceRow[] = [
      { id: "1", node: "core_belief", evidenceText: "", embedding: [1, 0, 0] },
    ];
    assert.ok(isEmbeddingDuplicate([1, 0, 0], "core_belief", existing, 0.9));
  });

  it("returns false when embedding is below threshold for same node", () => {
    const existing: ExistingEvidenceRow[] = [
      { id: "1", node: "core_belief", evidenceText: "", embedding: [1, 0, 0] },
    ];
    assert.ok(!isEmbeddingDuplicate([0, 1, 0], "core_belief", existing, 0.9));
  });

  it("ignores rows from different nodes", () => {
    const existing: ExistingEvidenceRow[] = [
      { id: "1", node: "core_fear", evidenceText: "", embedding: [1, 0, 0] },
    ];
    // Even though embedding matches, different node
    assert.ok(!isEmbeddingDuplicate([1, 0, 0], "core_belief", existing, 0.9));
  });

  it("ignores rows without embeddings", () => {
    const existing: ExistingEvidenceRow[] = [
      { id: "1", node: "core_belief", evidenceText: "", embedding: null },
    ];
    assert.ok(!isEmbeddingDuplicate([1, 0, 0], "core_belief", existing, 0.9));
  });

  it("returns false for empty existing rows", () => {
    assert.ok(!isEmbeddingDuplicate([1, 0, 0], "core_belief", [], 0.9));
  });
});

// ---------------------------------------------------------------------------
// TG2: dedupEmbeddedProposals
// ---------------------------------------------------------------------------

describe("dedupEmbeddedProposals", () => {
  it("skips proposals whose embedding matches an existing row", () => {
    const proposals: Array<{ proposal: MappedProposal; embedding: number[] }> = [
      {
        proposal: {
          chunk: FIXTURE_CHUNKS[0]!,
          node: "core_belief",
          claimText: "Claim",
          evidenceText: "Evidence",
          confidenceScore: 0.8,
        },
        embedding: [1, 0, 0],
      },
      {
        proposal: {
          chunk: FIXTURE_CHUNKS[1]!,
          node: "core_fear",
          claimText: "Claim 2",
          evidenceText: "Evidence 2",
          confidenceScore: 0.7,
        },
        embedding: [0, 1, 0],
      },
    ];
    const existing: ExistingEvidenceRow[] = [
      { id: "e1", node: "core_belief", evidenceText: "", embedding: [1, 0, 0] },
    ];

    const { kept, skipped } = dedupEmbeddedProposals(proposals, existing);
    assert.equal(kept.length, 1);
    assert.equal(skipped, 1);
    assert.equal(kept[0]!.proposal.node, "core_fear");
  });

  it("keeps all when no existing rows have embeddings", () => {
    const proposals: Array<{ proposal: MappedProposal; embedding: number[] }> = [
      {
        proposal: {
          chunk: FIXTURE_CHUNKS[0]!,
          node: "core_belief",
          claimText: "Claim",
          evidenceText: "Evidence",
          confidenceScore: 0.8,
        },
        embedding: [1, 0, 0],
      },
    ];
    const existing: ExistingEvidenceRow[] = [
      { id: "e1", node: "core_belief", evidenceText: "", embedding: null },
    ];

    const { kept, skipped } = dedupEmbeddedProposals(proposals, existing);
    assert.equal(kept.length, 1);
    assert.equal(skipped, 0);
  });

  it("handles empty input", () => {
    const { kept, skipped } = dedupEmbeddedProposals([], []);
    assert.equal(kept.length, 0);
    assert.equal(skipped, 0);
  });
});

// ---------------------------------------------------------------------------
// TG2: buildEvidenceRowData
// ---------------------------------------------------------------------------

describe("buildEvidenceRowData", () => {
  const proposal: MappedProposal = {
    chunk: FIXTURE_CHUNKS[0]!,
    node: "core_belief",
    claimText: "Zuo Ran believes in thorough preparation.",
    evidenceText: "He reviewed every document twice before presenting.",
    confidenceScore: 0.85,
  };

  it("sets status to 'proposed'", () => {
    const row = buildEvidenceRowData(proposal, "zuo_ran", null, {
      model: "openai:gpt-4",
      promptVersion: "1",
      minedBatchId: "test_batch_001",
    });
    assert.equal(row.status, "proposed");
  });

  it("sets sourceKind to 'canon'", () => {
    const row = buildEvidenceRowData(proposal, "zuo_ran", null, {
      model: "openai:gpt-4",
      promptVersion: "1",
      minedBatchId: "test_batch_001",
    });
    assert.equal(row.sourceKind, "canon");
  });

  it("sets metadata.source to 'evidence_miner'", () => {
    const row = buildEvidenceRowData(proposal, "zuo_ran", null, {
      model: "openai:gpt-4",
      promptVersion: "1",
      minedBatchId: "test_batch_001",
    });
    assert.equal(row.metadata.source, "evidence_miner");
  });

  it("includes model and promptVersion in metadata", () => {
    const row = buildEvidenceRowData(proposal, "zuo_ran", null, {
      model: "openai:gpt-4",
      promptVersion: "v2",
      minedBatchId: "batch_1",
    });
    assert.equal(row.metadata.model, "openai:gpt-4");
    assert.equal(row.metadata.promptVersion, "v2");
  });

  it("includes provenance from chunk", () => {
    const row = buildEvidenceRowData(proposal, "zuo_ran", null, {
      model: "openai:gpt-4",
      promptVersion: "1",
      minedBatchId: "test_batch_001",
    });
    assert.equal(row.arcKey, "main_zhiai");
    assert.equal(row.chapterKey, "evidence_chapter");
    assert.equal(row.episodeLabel, "Episode 1");
    assert.equal(row.sceneOrder, 3);
    assert.equal(row.unitIndex, 5);
    assert.equal(row.storySceneId, "00000000-0000-0000-0000-000000000001");
  });

  it("includes confidenceScore from proposal", () => {
    const row = buildEvidenceRowData(proposal, "zuo_ran", null, {
      model: "openai:gpt-4",
      promptVersion: "1",
      minedBatchId: "test_batch_001",
    });
    assert.equal(row.confidenceScore, 0.85);
  });

  it("sets embedding to the provided value", () => {
    const embedding = [0.1, 0.2, 0.3];
    const row = buildEvidenceRowData(proposal, "zuo_ran", embedding, {
      model: "openai:gpt-4",
      promptVersion: "1",
      minedBatchId: "test_batch_001",
    });
    assert.deepEqual(row.embedding, embedding);
  });

  it("sets embedding to null when not provided", () => {
    const row = buildEvidenceRowData(proposal, "zuo_ran", null, {
      model: "openai:gpt-4",
      promptVersion: "1",
      minedBatchId: "test_batch_001",
    });
    assert.equal(row.embedding, null);
  });

  it("includes sourceUnitIndex and sourceSceneOrder in metadata", () => {
    const row = buildEvidenceRowData(proposal, "zuo_ran", null, {
      model: "openai:gpt-4",
      promptVersion: "1",
      minedBatchId: "test_batch_001",
    });
    assert.equal(row.metadata.sourceUnitIndex, 5);
    assert.equal(row.metadata.sourceSceneOrder, 3);
  });

  it("includes minedAt as an ISO string in metadata", () => {
    const row = buildEvidenceRowData(proposal, "zuo_ran", null, {
      model: "openai:gpt-4",
      promptVersion: "1",
      minedBatchId: "test_batch_001",
    });
    assert.equal(typeof row.metadata.minedAt, "string");
    assert.ok(row.metadata.minedAt.length > 0);
    // Should parse as valid ISO date
    assert.ok(!Number.isNaN(Date.parse(row.metadata.minedAt)));
  });

  it("sets characterId correctly", () => {
    const row = buildEvidenceRowData(proposal, "zuo_ran", null, {
      model: "openai:gpt-4",
      promptVersion: "1",
      minedBatchId: "test_batch_001",
    });
    assert.equal(row.characterId, "zuo_ran");
  });

  it("sets scopeApplicability to empty object", () => {
    const row = buildEvidenceRowData(proposal, "zuo_ran", null, {
      model: "openai:gpt-4",
      promptVersion: "1",
      minedBatchId: "test_batch_001",
    });
    assert.deepEqual(row.scopeApplicability, {});
  });

  it("includes minedBatchId in metadata", () => {
    const row = buildEvidenceRowData(proposal, "zuo_ran", null, {
      model: "openai:gpt-4",
      promptVersion: "1",
      minedBatchId: "batch_abc_123",
    });
    assert.equal(row.metadata.minedBatchId, "batch_abc_123");
  });
});

// ---------------------------------------------------------------------------
// TG3: listProposedRows
// ---------------------------------------------------------------------------

describe("listProposedRows", () => {
  const makeFakeDb = (rows: ProposedRow[]): ReviewDb => ({
    fetchProposed: async () => rows,
    updateStatus: async () => 0,
  });

  it("returns rows ordered by node then confidence desc", async () => {
    const rows: ProposedRow[] = [
      {
        id: "3", node: "core_fear", claimText: "Fear claim",
        evidenceText: "Fear evidence", arcKey: null, chapterKey: null,
        episodeLabel: null, sceneOrder: null, unitIndex: null,
        confidenceScore: 0.7, createdAt: new Date(), metadata: {},
      },
      {
        id: "1", node: "core_belief", claimText: "Belief claim",
        evidenceText: "Belief evidence", arcKey: null, chapterKey: null,
        episodeLabel: null, sceneOrder: null, unitIndex: null,
        confidenceScore: 0.9, createdAt: new Date(), metadata: {},
      },
      {
        id: "2", node: "core_belief", claimText: "Another belief",
        evidenceText: "More evidence", arcKey: null, chapterKey: null,
        episodeLabel: null, sceneOrder: null, unitIndex: null,
        confidenceScore: 0.8, createdAt: new Date(), metadata: {},
      },
    ];

    const result = await listProposedRows("zuo_ran", makeFakeDb(rows));
    assert.equal(result.length, 3);
    // Order: core_belief (0.9), core_belief (0.8), core_fear (0.7)
    assert.equal(result[0]!.id, "1");
    assert.equal(result[1]!.id, "2");
    assert.equal(result[2]!.id, "3");
  });

  it("handles null confidenceScore by treating as 0", async () => {
    const rows: ProposedRow[] = [
      {
        id: "a", node: "core_belief", claimText: "A",
        evidenceText: "a", arcKey: null, chapterKey: null,
        episodeLabel: null, sceneOrder: null, unitIndex: null,
        confidenceScore: null, createdAt: new Date(), metadata: {},
      },
      {
        id: "b", node: "core_belief", claimText: "B",
        evidenceText: "b", arcKey: null, chapterKey: null,
        episodeLabel: null, sceneOrder: null, unitIndex: null,
        confidenceScore: 0.5, createdAt: new Date(), metadata: {},
      },
    ];

    const result = await listProposedRows("zuo_ran", makeFakeDb(rows));
    assert.equal(result.length, 2);
    // null sorts as 0, so "b" (0.5) comes first, then "a" (null=0)
    assert.equal(result[0]!.id, "b");
    assert.equal(result[1]!.id, "a");
  });

  it("returns empty array for empty DB", async () => {
    const result = await listProposedRows("zuo_ran", makeFakeDb([]));
    assert.equal(result.length, 0);
  });
});

// ---------------------------------------------------------------------------
// TG3: promoteRows
// ---------------------------------------------------------------------------

describe("promoteRows", () => {
  it("updates status to 'active' via injectable DB", async () => {
    let updatedStatus = "";
    let updatedIds: string[] = [];
    const db: ReviewDb = {
      fetchProposed: async () => [],
      updateStatus: async (ids, status) => {
        updatedIds = ids;
        updatedStatus = status;
        return ids.length;
      },
    };

    const count = await promoteRows(["id1", "id2"], db);
    assert.equal(count, 2);
    assert.equal(updatedStatus, "active");
    assert.deepEqual(updatedIds, ["id1", "id2"]);
  });

  it("returns 0 for empty ids", async () => {
    let called = false;
    const db: ReviewDb = {
      fetchProposed: async () => [],
      updateStatus: async () => { called = true; return 0; },
    };
    const count = await promoteRows([], db);
    assert.equal(count, 0);
    assert.equal(called, false);
  });
});

// ---------------------------------------------------------------------------
// TG3: rejectRows
// ---------------------------------------------------------------------------

describe("rejectRows", () => {
  it("updates status to 'superseded' with reviewOutcome via injectable DB", async () => {
    let updatedStatus = "";
    let updatedExtra: Record<string, unknown> | undefined;
    const db: ReviewDb = {
      fetchProposed: async () => [],
      updateStatus: async (ids, status, extra) => {
        updatedStatus = status;
        updatedExtra = extra;
        return ids.length;
      },
    };

    const count = await rejectRows(["id1"], db);
    assert.equal(count, 1);
    assert.equal(updatedStatus, "superseded");
    assert.deepEqual(updatedExtra, { reviewOutcome: "rejected" });
  });

  it("returns 0 for empty ids", async () => {
    let called = false;
    const db: ReviewDb = {
      fetchProposed: async () => [],
      updateStatus: async () => { called = true; return 0; },
    };
    const count = await rejectRows([], db);
    assert.equal(count, 0);
    assert.equal(called, false);
  });
});
