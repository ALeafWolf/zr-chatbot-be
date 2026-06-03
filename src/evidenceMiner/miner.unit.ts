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
  it("includes all node descriptions, Chinese rules, and handles empty input", () => {
    // All 8 nodes present
    const prompt = buildMinerSystemPrompt(FIXTURE_INTERNAL_LOGIC);
    for (const node of INTERNAL_LOGIC_NODES) {
      assert.ok(prompt.includes(node), `prompt should mention node "${node}"`);
    }
    // Chinese grounding rules
    assert.ok(prompt.includes("chunkRef"));
    assert.ok(prompt.includes("confidenceScore"));
    assert.ok(prompt.includes("不得编造"));
    assert.ok(prompt.includes("内在逻辑节点"));
    assert.ok(prompt.includes("归因规则"));
    assert.ok(prompt.includes("左然"));
    // Empty internalLogic
    const promptEmpty = buildMinerSystemPrompt({});
    for (const node of INTERNAL_LOGIC_NODES) {
      assert.ok(promptEmpty.includes(node), `prompt should mention node "${node}" even without descriptions`);
    }
    assert.ok(promptEmpty.includes("无描述"));
  });
});

// ---------------------------------------------------------------------------
// TG1: buildBatchUserMessage
// ---------------------------------------------------------------------------

describe("buildBatchUserMessage", () => {
  it("includes chunk indices, provenance, text, speaker, and context", () => {
    const msg = buildBatchUserMessage(FIXTURE_CHUNKS, 0);
    assert.ok(msg.includes("[片断 0]"), "index 0");
    assert.ok(msg.includes("[片断 1]"), "index 1");
    assert.ok(msg.includes("[片断 2]"), "index 2");
    assert.ok(msg.includes("main_zhiai"), "arcKey");
    assert.ok(msg.includes("evidence_chapter"), "chapterKey");
    assert.ok(msg.includes("courtroom"), "chunk 0 text");
    assert.ok(msg.includes("small gift"), "chunk 1 text");
    assert.ok(msg.includes("changed the subject"), "chunk 2 text");
    assert.ok(msg.includes("发言人"), "speaker label");
    // Context before/after
    const chunksWithContext: CanonChunk[] = [
      {
        ...FIXTURE_CHUNKS[0]!,
        contextBefore: [{ text: "Previous line.", speaker: "narrator", unitIndex: 4 }],
        contextAfter: [{ text: "Next line.", speaker: "左然", unitIndex: 6 }],
      },
    ];
    const ctxMsg = buildBatchUserMessage(chunksWithContext, 0);
    assert.ok(ctxMsg.includes("上文"));
    assert.ok(ctxMsg.includes("下文"));
    assert.ok(ctxMsg.includes("Previous line."));
    assert.ok(ctxMsg.includes("Next line."));
    assert.ok(ctxMsg.includes("左然"));
  });
});

// ---------------------------------------------------------------------------
// TG1: mapAndValidateProposals
// ---------------------------------------------------------------------------

describe("mapAndValidateProposals", () => {
  it("maps valid proposals, drops invalid nodes/refs, preserves fields, handles empty", () => {
    // Valid mapping
    const validProps: LlmProposal[] = [
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
    let { valid, dropped, warnings } = mapAndValidateProposals(validProps, FIXTURE_CHUNKS);
    assert.equal(valid.length, 2, "valid — count");
    assert.equal(dropped, 0, "valid — dropped");
    assert.equal(warnings.length, 0, "valid — warnings");
    assert.equal(valid[0]!.chunk.storySceneId, "00000000-0000-0000-0000-000000000001", "valid — sceneId 0");
    assert.equal(valid[0]!.node, "core_belief", "valid — node 0");
    assert.equal(valid[1]!.chunk.storySceneId, "00000000-0000-0000-0000-000000000002", "valid — sceneId 1");
    assert.equal(valid[1]!.node, "core_motivation", "valid — node 1");
    assert.equal(valid[1]!.confidenceScore, 0.9, "valid — score 1");

    // Invalid node names
    const invalidNodeProps: LlmProposal[] = [
      { chunkRef: 0, node: "core_belief", claimText: "Valid claim", evidenceText: "Some evidence", confidenceScore: 0.8 },
      { chunkRef: 1, node: "nonexistent_node", claimText: "Invalid node", evidenceText: "Some evidence", confidenceScore: 0.7 },
      { chunkRef: 2, node: "NOT_A_NODE", claimText: "Also invalid", evidenceText: "Some evidence", confidenceScore: 0.6 },
    ];
    ({ valid, dropped, warnings } = mapAndValidateProposals(invalidNodeProps, FIXTURE_CHUNKS));
    assert.equal(valid.length, 1, "invalid node — count");
    assert.equal(dropped, 2, "invalid node — dropped");
    assert.equal(warnings.length, 2, "invalid node — warnings");
    assert.equal(valid[0]!.node, "core_belief", "invalid node — kept");
    const warnText = warnings.join(" ");
    assert.ok(warnText.includes("nonexistent_node"), "invalid node — warn for nonexistent_node");
    assert.ok(warnText.includes("NOT_A_NODE"), "invalid node — warn for NOT_A_NODE");

    // Out-of-range chunkRef
    const oobProps: LlmProposal[] = [
      { chunkRef: 0, node: "core_belief", claimText: "Valid", evidenceText: "Text", confidenceScore: 0.8 },
      { chunkRef: 999, node: "core_fear", claimText: "Out of range", evidenceText: "Text", confidenceScore: 0.7 },
      { chunkRef: -1, node: "core_motivation", claimText: "Negative ref", evidenceText: "Text", confidenceScore: 0.6 },
    ];
    ({ valid, dropped, warnings } = mapAndValidateProposals(oobProps, FIXTURE_CHUNKS));
    assert.equal(valid.length, 1, "OOB — count");
    assert.equal(dropped, 2, "OOB — dropped");
    const oobWarnText = warnings.join(" ");
    assert.ok(oobWarnText.includes("999"), "OOB — warn 999");
    assert.ok(oobWarnText.includes("-1"), "OOB — warn -1");

    // Preserves all fields on valid proposal
    const fieldProps: LlmProposal[] = [
      {
        chunkRef: 2,
        node: "defense_mechanism",
        claimText: "He deflects when emotions surface.",
        evidenceText: "He changed the subject when asked about feelings.",
        confidenceScore: 0.75,
      },
    ];
    ({ valid } = mapAndValidateProposals(fieldProps, FIXTURE_CHUNKS));
    assert.equal(valid.length, 1, "fields — count");
    assert.equal(valid[0]!.node, "defense_mechanism", "fields — node");
    assert.equal(valid[0]!.claimText, "He deflects when emotions surface.", "fields — claimText");
    assert.equal(valid[0]!.evidenceText, "He changed the subject when asked about feelings.", "fields — evidenceText");
    assert.equal(valid[0]!.confidenceScore, 0.75, "fields — score");
    assert.equal(valid[0]!.chunk.storySceneId, "00000000-0000-0000-0000-000000000003", "fields — sceneId");

    // Empty input
    ({ valid, dropped, warnings } = mapAndValidateProposals([], FIXTURE_CHUNKS));
    assert.equal(valid.length, 0, "empty — count");
    assert.equal(dropped, 0, "empty — dropped");
    assert.equal(warnings.length, 0, "empty — warnings");
  });
});

// ---------------------------------------------------------------------------
// TG1: batchChunks
// ---------------------------------------------------------------------------

describe("batchChunks", () => {
  it("splits into batches of correct sizes, handles edge cases", () => {
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

    const cases = [
      { name: "explicit batchSize 2", args: { chunks: FIXTURE_CHUNKS, size: 2 }, expect: (bs: CanonChunk[][]) => { assert.equal(bs.length, 2, "size2 — batches"); assert.equal(bs[0]!.length, 2, "size2 — batch0"); assert.equal(bs[1]!.length, 1, "size2 — batch1"); } },
      { name: "batchSize >= length", args: { chunks: FIXTURE_CHUNKS, size: 10 }, expect: (bs: CanonChunk[][]) => { assert.equal(bs.length, 1, "large — batches"); assert.equal(bs[0]!.length, 3, "large — batch0"); } },
      { name: "empty input", args: { chunks: [], size: 5 }, expect: (bs: CanonChunk[][]) => { assert.equal(bs.length, 0, "empty — batches"); } },
      { name: "default BATCH_SIZE (15)", args: { chunks: manyChunks }, expect: (bs: CanonChunk[][]) => { for (const b of bs) assert.ok(b.length <= 15, `batch should not exceed 15, got ${b.length}`); } },
    ];
    for (const c of cases) {
      const batches = batchChunks(c.args.chunks, c.args.size as number | undefined);
      c.expect(batches);
    }
  });
});

// ---------------------------------------------------------------------------
// TG1: callLlmForBatch
// ---------------------------------------------------------------------------

describe("callLlmForBatch", () => {
  it("returns proposals on success, handles LLM failure and thrown errors", async () => {
    // Success
    const fakeLlm = async (_system: string, _user: string) => ({
      ok: true as const,
      data: { proposals: [{ chunkRef: 0, node: "core_belief", claimText: "Thorough preparation", evidenceText: "Reviewed documents twice", confidenceScore: 0.8 }] },
    });
    let result = await callLlmForBatch("system", FIXTURE_CHUNKS.slice(0, 1), 0, fakeLlm);
    assert.ok(result.ok, "success — ok");
    assert.equal(result.proposals.length, 1, "success — proposals length");
    assert.equal(result.proposals[0]!.node, "core_belief", "success — node");
    assert.equal(result.proposals[0]!.chunkRef, 0, "success — chunkRef");

    // LLM failure (ok: false)
    const failingLlm = async (_system: string, _user: string) => ({ ok: false as const, error: "LLM rate limited" });
    result = await callLlmForBatch("system", FIXTURE_CHUNKS.slice(0, 1), 0, failingLlm);
    assert.ok(!result.ok, "fail — !ok");
    assert.equal(result.proposals.length, 0, "fail — proposals length");
    assert.ok(result.error?.includes("LLM rate limited"), "fail — error message");

    // Thrown error
    const throwingLlm = async (_system: string, _user: string) => { throw new Error("Network error"); };
    result = await callLlmForBatch("system", FIXTURE_CHUNKS.slice(0, 1), 0, throwingLlm);
    assert.ok(!result.ok, "throw — !ok");
    assert.equal(result.proposals.length, 0, "throw — proposals length");
    assert.ok(result.error?.includes("Network error"), "throw — error message");
  });
});

// ---------------------------------------------------------------------------
// TG2: filterByConfidence
// ---------------------------------------------------------------------------

describe("filterByConfidence", () => {
  it("filters by threshold, handles all above/below/empty", () => {
    const makeProposal = (node: string, score: number): MappedProposal => ({
      chunk: FIXTURE_CHUNKS[0]!, node: node as InternalLogicNode,
      claimText: "Test claim", evidenceText: "Test evidence", confidenceScore: score,
    });
    const cases = [
      { name: "all above threshold", input: [makeProposal("core_belief", 0.8), makeProposal("core_fear", 0.6)], threshold: 0.6, expectKept: 2, expectDropped: 0, expectNode: null },
      { name: "some below threshold", input: [makeProposal("core_belief", 0.8), makeProposal("core_fear", 0.4), makeProposal("core_motivation", 0.2)], threshold: 0.6, expectKept: 1, expectDropped: 2, expectNode: "core_belief" },
      { name: "all below threshold", input: [makeProposal("core_belief", 0.3), makeProposal("core_fear", 0.5)], threshold: 0.6, expectKept: 0, expectDropped: 2, expectNode: null },
      { name: "empty input", input: [], threshold: 0.6, expectKept: 0, expectDropped: 0, expectNode: null },
    ];
    for (const c of cases) {
      const { kept, dropped } = filterByConfidence(c.input, c.threshold);
      assert.equal(kept.length, c.expectKept, `kept — ${c.name}`);
      assert.equal(dropped, c.expectDropped, `dropped — ${c.name}`);
      if (c.expectNode !== null) assert.equal(kept[0]!.node, c.expectNode, `node — ${c.name}`);
    }
  });
});

// ---------------------------------------------------------------------------
// TG2: exact-match dedup
// ---------------------------------------------------------------------------

describe("dedupByExactMatch", () => {
  it("skips exact matches (case-insensitive, whitespace-normalized), distinguishes nodes, handles empty", () => {
    const makeProposal = (node: string, evidenceText: string): MappedProposal => ({
      chunk: FIXTURE_CHUNKS[0]!, node: node as InternalLogicNode,
      claimText: "Test claim", evidenceText, confidenceScore: 0.8,
    });
    const makeExisting = (node: string, evidenceText: string): ExistingEvidenceRow => ({
      id: "existing-id", node, evidenceText, embedding: null,
    });
    const characterId = "zuo_ran";

    const cases = [
      { name: "exact match skips", proposals: [makeProposal("core_belief", "Zuo Ran prepared thoroughly."), makeProposal("core_fear", "He was afraid of letting others down.")], existing: [makeExisting("core_belief", "Zuo Ran prepared thoroughly.")], expectKept: 1, expectSkipped: 1, expectNode: "core_fear" },
      { name: "case-insensitive", proposals: [makeProposal("core_belief", "Zuo Ran Prepared Thoroughly.")], existing: [makeExisting("core_belief", "zuo ran prepared thoroughly.")], expectKept: 0, expectSkipped: 1, expectNode: null },
      { name: "whitespace normalization", proposals: [makeProposal("core_belief", "Zuo  Ran   Prepared Thoroughly.")], existing: [makeExisting("core_belief", "Zuo Ran Prepared Thoroughly.")], expectKept: 0, expectSkipped: 1, expectNode: null },
      { name: "different nodes distinguished", proposals: [makeProposal("core_belief", "Same evidence text.")], existing: [makeExisting("core_fear", "Same evidence text.")], expectKept: 1, expectSkipped: 0, expectNode: null },
      { name: "empty existing", proposals: [makeProposal("core_belief", "Some text")], existing: [], expectKept: 1, expectSkipped: 0, expectNode: null },
    ];
    for (const c of cases) {
      const { kept, skipped } = dedupByExactMatch(c.proposals, characterId, c.existing);
      assert.equal(kept.length, c.expectKept, `kept — ${c.name}`);
      assert.equal(skipped, c.expectSkipped, `skipped — ${c.name}`);
      if (c.expectNode !== null) assert.equal(kept[0]!.node, c.expectNode, `node — ${c.name}`);
    }
  });
});

// ---------------------------------------------------------------------------
// TG2: normalizeEvidenceText
// ---------------------------------------------------------------------------

describe("normalizeEvidenceText", () => {
  it("lowercases, trims, and collapses whitespace", () => {
    const cases = [
      { name: "lowercase", input: "HELLO World", expected: "hello world" },
      { name: "trim", input: "  hello  ", expected: "hello" },
      { name: "collapse whitespace", input: "hello   world\n  foo", expected: "hello world foo" },
    ];
    for (const c of cases) {
      assert.equal(normalizeEvidenceText(c.input), c.expected, c.name);
    }
  });
});

// ---------------------------------------------------------------------------
// TG2: cosineSimilarity
// ---------------------------------------------------------------------------

describe("cosineSimilarity", () => {
  it("computes similarity for various vector pairs", () => {
    const cases = [
      { name: "identical", a: [1, 2, 3], b: [1, 2, 3], expect: (v: number) => v === 1 },
      { name: "orthogonal", a: [1, 0], b: [0, 1], expect: (v: number) => v === 0 },
      { name: "between 0 and 1", a: [1, 2, 3], b: [1, 2, 0], expect: (v: number) => v > 0 && v < 1 },
      { name: "empty vectors", a: [], b: [], expect: (v: number) => v === 0 },
      { name: "mismatched lengths", a: [1, 2], b: [1, 2, 3], expect: (v: number) => v === 0 },
      { name: "zero magnitude", a: [0, 0], b: [1, 2], expect: (v: number) => v === 0 },
    ];
    for (const c of cases) {
      const sim = cosineSimilarity(c.a, c.b);
      assert.ok(c.expect(sim), c.name);
    }
  });
});

// ---------------------------------------------------------------------------
// TG2: isEmbeddingDuplicate
// ---------------------------------------------------------------------------

describe("isEmbeddingDuplicate", () => {
  it("returns correct boolean for threshold, node, embedding availability, and empty", () => {
    const existing: ExistingEvidenceRow[] = [
      { id: "1", node: "core_belief", evidenceText: "", embedding: [1, 0, 0] },
    ];
    const existingOtherNode: ExistingEvidenceRow[] = [
      { id: "1", node: "core_fear", evidenceText: "", embedding: [1, 0, 0] },
    ];
    const existingNullEmbedding: ExistingEvidenceRow[] = [
      { id: "1", node: "core_belief", evidenceText: "", embedding: null },
    ];
    const cases = [
      { name: "above threshold same node", embedding: [1, 0, 0], node: "core_belief", existing, threshold: 0.9, expected: true },
      { name: "below threshold same node", embedding: [0, 1, 0], node: "core_belief", existing, threshold: 0.9, expected: false },
      { name: "different node (same embedding)", embedding: [1, 0, 0], node: "core_belief", existing: existingOtherNode, threshold: 0.9, expected: false },
      { name: "null embedding ignored", embedding: [1, 0, 0], node: "core_belief", existing: existingNullEmbedding, threshold: 0.9, expected: false },
      { name: "empty existing rows", embedding: [1, 0, 0], node: "core_belief", existing: [], threshold: 0.9, expected: false },
    ];
    for (const c of cases) {
      const result = isEmbeddingDuplicate(c.embedding, c.node, c.existing, c.threshold);
      if (c.expected) assert.ok(result, c.name);
      else assert.ok(!result, c.name);
    }
  });
});

// ---------------------------------------------------------------------------
// TG2: dedupEmbeddedProposals
// ---------------------------------------------------------------------------

describe("dedupEmbeddedProposals", () => {
  it("skips matching embeddings, keeps all when none have embeddings, handles empty", () => {
    const makeEntry = (node: string, embedding: number[]) => ({
      proposal: { chunk: FIXTURE_CHUNKS[0]!, node: node as InternalLogicNode, claimText: "Claim", evidenceText: "Evidence", confidenceScore: 0.8 },
      embedding,
    } as const);
    const cases = [
      { name: "match skips", proposals: [makeEntry("core_belief", [1, 0, 0]), makeEntry("core_fear", [0, 1, 0])], existing: [{ id: "e1", node: "core_belief", evidenceText: "", embedding: [1, 0, 0] }], expectKept: 1, expectSkipped: 1, expectNode: "core_fear" },
      { name: "no embeddings in existing", proposals: [makeEntry("core_belief", [1, 0, 0])], existing: [{ id: "e1", node: "core_belief", evidenceText: "", embedding: null }], expectKept: 1, expectSkipped: 0, expectNode: null },
      { name: "empty input", proposals: [], existing: [], expectKept: 0, expectSkipped: 0, expectNode: null },
    ];
    for (const c of cases) {
      const { kept, skipped } = dedupEmbeddedProposals(c.proposals, c.existing);
      assert.equal(kept.length, c.expectKept, `kept — ${c.name}`);
      assert.equal(skipped, c.expectSkipped, `skipped — ${c.name}`);
      if (c.expectNode !== null) assert.equal(kept[0]!.proposal.node, c.expectNode, `node — ${c.name}`);
    }
  });
});

// ---------------------------------------------------------------------------
// TG2: buildEvidenceRowData
// ---------------------------------------------------------------------------

describe("buildEvidenceRowData", () => {
  it("populates basic fields (status, sourceKind, metadata source, model, characterId, scope, minedBatchId)", () => {
    const proposal: MappedProposal = {
      chunk: FIXTURE_CHUNKS[0]!,
      node: "core_belief",
      claimText: "Zuo Ran believes in thorough preparation.",
      evidenceText: "He reviewed every document twice before presenting.",
      confidenceScore: 0.85,
    };
    const metadata = { model: "openai:gpt-4" as const, promptVersion: "1", minedBatchId: "test_batch_001" };
    const row = buildEvidenceRowData(proposal, "zuo_ran", null, metadata);
    assert.equal(row.status, "proposed", "status");
    assert.equal(row.sourceKind, "canon", "sourceKind");
    assert.equal(row.metadata.source, "evidence_miner", "metadata.source");
    assert.equal(row.characterId, "zuo_ran", "characterId");
    assert.deepEqual(row.scopeApplicability, {}, "scopeApplicability");
    assert.equal(row.metadata.minedBatchId, "test_batch_001", "minedBatchId");

    // Different metadata values
    const row2 = buildEvidenceRowData(proposal, "zuo_ran", null, { model: "openai:gpt-4", promptVersion: "v2", minedBatchId: "batch_1" });
    assert.equal(row2.metadata.model, "openai:gpt-4", "model");
    assert.equal(row2.metadata.promptVersion, "v2", "promptVersion");
  });

  it("populates provenance, confidence, embedding, minedAt, and tracking metadata", () => {
    const proposal: MappedProposal = {
      chunk: FIXTURE_CHUNKS[0]!,
      node: "core_belief",
      claimText: "Zuo Ran believes in thorough preparation.",
      evidenceText: "He reviewed every document twice before presenting.",
      confidenceScore: 0.85,
    };
    const metadata = { model: "openai:gpt-4" as const, promptVersion: "1", minedBatchId: "test_batch_001" };
    const row = buildEvidenceRowData(proposal, "zuo_ran", null, metadata);
    // Provenance from chunk
    assert.equal(row.arcKey, "main_zhiai", "arcKey");
    assert.equal(row.chapterKey, "evidence_chapter", "chapterKey");
    assert.equal(row.episodeLabel, "Episode 1", "episodeLabel");
    assert.equal(row.sceneOrder, 3, "sceneOrder");
    assert.equal(row.unitIndex, 5, "unitIndex");
    assert.equal(row.storySceneId, "00000000-0000-0000-0000-000000000001", "storySceneId");
    // Confidence
    assert.equal(row.confidenceScore, 0.85, "confidenceScore");
    // Embedding set and null
    assert.equal(row.embedding, null, "embedding null");
    const embedding = [0.1, 0.2, 0.3];
    const rowWithEmb = buildEvidenceRowData(proposal, "zuo_ran", embedding, metadata);
    assert.deepEqual(rowWithEmb.embedding, embedding, "embedding set");
    // Tracking metadata
    assert.equal(row.metadata.sourceUnitIndex, 5, "sourceUnitIndex");
    assert.equal(row.metadata.sourceSceneOrder, 3, "sourceSceneOrder");
    // minedAt ISO
    assert.equal(typeof row.metadata.minedAt, "string", "minedAt type");
    assert.ok(row.metadata.minedAt.length > 0, "minedAt length");
    assert.ok(!Number.isNaN(Date.parse(row.metadata.minedAt)), "minedAt parseable");
  });
});

// ---------------------------------------------------------------------------
// TG3: listProposedRows
// ---------------------------------------------------------------------------

describe("listProposedRows", () => {
  it("orders by node then confidence desc, handles null confidence, and empty input", async () => {
    const makeFakeDb = (rows: ProposedRow[]): ReviewDb => ({
      fetchProposed: async () => rows,
      updateStatus: async () => 0,
    });
    const characterId = "zuo_ran";

    // Normal ordering
    const rows: ProposedRow[] = [
      { id: "3", node: "core_fear", claimText: "Fear claim", evidenceText: "Fear evidence", arcKey: null, chapterKey: null, episodeLabel: null, sceneOrder: null, unitIndex: null, confidenceScore: 0.7, createdAt: new Date(), metadata: {} },
      { id: "1", node: "core_belief", claimText: "Belief claim", evidenceText: "Belief evidence", arcKey: null, chapterKey: null, episodeLabel: null, sceneOrder: null, unitIndex: null, confidenceScore: 0.9, createdAt: new Date(), metadata: {} },
      { id: "2", node: "core_belief", claimText: "Another belief", evidenceText: "More evidence", arcKey: null, chapterKey: null, episodeLabel: null, sceneOrder: null, unitIndex: null, confidenceScore: 0.8, createdAt: new Date(), metadata: {} },
    ];
    let result = await listProposedRows(characterId, makeFakeDb(rows));
    assert.equal(result.length, 3, "ordering — count");
    assert.equal(result[0]!.id, "1", "ordering — first (belief 0.9)");
    assert.equal(result[1]!.id, "2", "ordering — second (belief 0.8)");
    assert.equal(result[2]!.id, "3", "ordering — third (fear 0.7)");

    // Null confidenceScore → treated as 0
    const nullRows: ProposedRow[] = [
      { id: "a", node: "core_belief", claimText: "A", evidenceText: "a", arcKey: null, chapterKey: null, episodeLabel: null, sceneOrder: null, unitIndex: null, confidenceScore: null, createdAt: new Date(), metadata: {} },
      { id: "b", node: "core_belief", claimText: "B", evidenceText: "b", arcKey: null, chapterKey: null, episodeLabel: null, sceneOrder: null, unitIndex: null, confidenceScore: 0.5, createdAt: new Date(), metadata: {} },
    ];
    result = await listProposedRows(characterId, makeFakeDb(nullRows));
    assert.equal(result.length, 2, "null score — count");
    assert.equal(result[0]!.id, "b", "null score — b (0.5) first");
    assert.equal(result[1]!.id, "a", "null score — a (null=0) second");

    // Empty input
    result = await listProposedRows(characterId, makeFakeDb([]));
    assert.equal(result.length, 0, "empty — count");
  });
});

// ---------------------------------------------------------------------------
// TG3: promoteRows
// ---------------------------------------------------------------------------

describe("promoteRows", () => {
  it("updates status to 'active' and returns 0 for empty ids", async () => {
    let updatedStatus = "";
    let updatedIds: string[] = [];
    const db: ReviewDb = {
      fetchProposed: async () => [],
      updateStatus: async (ids, status) => { updatedIds = ids; updatedStatus = status; return ids.length; },
    };
    const count = await promoteRows(["id1", "id2"], db);
    assert.equal(count, 2, "promote — count");
    assert.equal(updatedStatus, "active", "promote — status");
    assert.deepEqual(updatedIds, ["id1", "id2"], "promote — ids");

    // Empty ids
    let called = false;
    const emptyDb: ReviewDb = {
      fetchProposed: async () => [],
      updateStatus: async () => { called = true; return 0; },
    };
    const emptyCount = await promoteRows([], emptyDb);
    assert.equal(emptyCount, 0, "empty — count");
    assert.equal(called, false, "empty — not called");
  });
});

// ---------------------------------------------------------------------------
// TG3: rejectRows
// ---------------------------------------------------------------------------

describe("rejectRows", () => {
  it("updates status to 'superseded' with reviewOutcome and returns 0 for empty ids", async () => {
    let updatedStatus = "";
    let updatedExtra: Record<string, unknown> | undefined;
    const db: ReviewDb = {
      fetchProposed: async () => [],
      updateStatus: async (ids, status, extra) => { updatedStatus = status; updatedExtra = extra; return ids.length; },
    };
    const count = await rejectRows(["id1"], db);
    assert.equal(count, 1, "reject — count");
    assert.equal(updatedStatus, "superseded", "reject — status");
    assert.deepEqual(updatedExtra, { reviewOutcome: "rejected" }, "reject — extra");

    // Empty ids
    let called = false;
    const emptyDb: ReviewDb = {
      fetchProposed: async () => [],
      updateStatus: async () => { called = true; return 0; },
    };
    const emptyCount = await rejectRows([], emptyDb);
    assert.equal(emptyCount, 0, "empty — count");
    assert.equal(called, false, "empty — not called");
  });
});
