import { describe, it } from "node:test";
import assert from "node:assert";
import type { ContextCandidate } from "../context/contextCandidates";
import type { PromptMemorySource, PromptMemorySelectionDiagnostics } from "../context/promptMemoryContextSelector";
import { buildMemoryRerankPrompt } from "./memoryRerankPrompt";
import { __testing } from "./memoryRerank";
import { env } from "../../config/env";
import { buildRetrievalDiagnosticsPayload } from "./retrievalDiagnostics";
import type { RetrievalPlan } from "./retrievalPlan";

function makeCandidate(overrides: Partial<ContextCandidate> = {}): ContextCandidate {
  return {
    id: overrides.id ?? "c1", source: overrides.source ?? "structmem_entry",
    text: overrides.text ?? "A shared memory of a cafe meeting.",
    score: overrides.score ?? 0.5, turnStart: overrides.turnStart ?? null, turnEnd: overrides.turnEnd ?? null,
  };
}

// ---------------------------------------------------------------------------
// buildMemoryRerankPrompt
// ---------------------------------------------------------------------------

describe("buildMemoryRerankPrompt", () => {
  it("includes candidate text, source, intent hint, and max count per intent", () => {
    const cases = [
      {
        name: "explicit_recall",
        input: { currentUserMessage: "你还记得我们上次在咖啡馆说了什么吗？", plannerIntent: "explicit_recall" as const, candidates: [makeCandidate({ id: "mem_1", source: "interactive_memory", text: "咖啡馆对话" })], maxSelected: 8 },
        checks: (p: ReturnType<typeof buildMemoryRerankPrompt>) => {
          assert.ok(p.system.includes("memory relevance judge"), "system — judge ref");
          assert.ok(p.user.includes("咖啡馆对话"), "user — candidate text");
          assert.ok(p.user.includes("explicit_recall"), "user — intent hint");
          assert.ok(p.user.includes("mem_1"), "user — candidate id");
          assert.ok(p.system.includes("8"), "system — max count");
        },
      },
      {
        name: "canon_question",
        input: { currentUserMessage: "原作第三章是谁提出的？", plannerIntent: "canon_question" as const, candidates: [makeCandidate({ source: "canon_chunk" })], maxSelected: 8 },
        checks: (p: ReturnType<typeof buildMemoryRerankPrompt>) => { assert.ok(p.user.includes("canon/story fact question"), "user — canon hint"); },
      },
      {
        name: "scene_continuation",
        input: { currentUserMessage: "我看着他，等着回应。", plannerIntent: "scene_continuation" as const, candidates: [], maxSelected: 8 },
        checks: (p: ReturnType<typeof buildMemoryRerankPrompt>) => { assert.ok(p.user.includes("continuity"), "user — continuity hint"); },
      },
    ];
    for (const c of cases) {
      const { system, user } = buildMemoryRerankPrompt(c.input);
      c.checks({ system, user });
    }
  });
});

// ---------------------------------------------------------------------------
// validateSelected
// ---------------------------------------------------------------------------

describe("validateSelected", () => {
  it("drops unknown IDs and caps to max count", () => {
    const result = __testing.validateSelected(
      [{ id: "ghost", source: "interactive_memory", relevance: "useful", usageInstruction: "use_subtly", reasonCode: "direct_continuity" }, { id: "real_1", source: "interactive_memory", relevance: "useful", usageInstruction: "use_subtly", reasonCode: "direct_continuity" }],
      [makeCandidate({ id: "real_1", source: "interactive_memory" })], 8,
    );
    assert.equal(result.length, 1, "unknown dropped");
    assert.equal(result[0]!.id, "real_1", "real kept");

    const manySelected = Array.from({ length: 12 }, (_, i) => ({ id: `item_${i}`, source: "structmem_entry" as const, relevance: "useful" as const, usageInstruction: "use_subtly" as const, reasonCode: "direct_continuity" as const }));
    const capped = __testing.validateSelected(manySelected, manySelected.map((s) => makeCandidate({ id: s.id })), 8);
    assert.equal(capped.length, 8, "capped to 8");
  });
});

// ---------------------------------------------------------------------------
// applyEmptySelectionGuard
// ---------------------------------------------------------------------------

describe("applyEmptySelectionGuard", () => {
  it("applies empty guard per intent, avoids canon_fact for recall", () => {
    const candidates = [
      makeCandidate({ id: "best_mem", source: "interactive_memory", text: "重要回忆", score: 0.9 }),
      makeCandidate({ id: "best_canon", source: "canon_chunk", text: "原作事实", score: 0.8 }),
    ];
    const empty = { selected: [], rejected: [], finalContextMode: "recent_only" as const, needsEvidenceFallback: false };

    // explicit_recall picks best non-canon
    let r = __testing.applyEmptySelectionGuard(empty, candidates, "explicit_recall");
    assert.equal(r.selected.length, 1, "recall — selected count");
    assert.equal(r.selected[0]!.id, "best_mem", "recall — id");
    assert.equal(r.selected[0]!.reasonCode, "direct_continuity", "recall — reasonCode");

    // canon_question picks best canon
    r = __testing.applyEmptySelectionGuard(empty, candidates, "canon_question");
    assert.equal(r.selected.length, 1, "canon_q — count");
    assert.equal(r.selected[0]!.id, "best_canon", "canon_q — id");

    // scene_continuation unchanged
    const unchanged = __testing.applyEmptySelectionGuard(empty, [], "scene_continuation");
    assert.deepEqual(unchanged, empty, "scene_cont — unchanged");

    // canon_fact preferred over memory for canon_question
    const factCandidates = [
      makeCandidate({ id: "fact_1", source: "canon_fact", text: "A key story fact.", score: 0.9 }),
      makeCandidate({ id: "mem_1", source: "interactive_memory", text: "A memory.", score: 0.8 }),
    ];
    r = __testing.applyEmptySelectionGuard(empty, factCandidates, "canon_question");
    assert.equal(r.selected.length, 1, "canon_q — fact selected");
    assert.equal(r.selected[0]!.source, "canon_fact", "canon_q — fact source");

    // explicit_recall does NOT pick canon_fact
    r = __testing.applyEmptySelectionGuard(empty, factCandidates, "explicit_recall");
    assert.equal(r.selected.length, 1, "recall — count");
    assert.notEqual(r.selected[0]!.source, "canon_fact", "recall — not canon_fact");
    assert.equal(r.selected[0]!.source, "interactive_memory", "recall — memory source");
  });
});

// ---------------------------------------------------------------------------
// Reason code sets
// ---------------------------------------------------------------------------

describe("reason code sets", () => {
  it("validates selected and rejected reason codes against schema", () => {
    const EXPECTED_SELECTED = ["direct_continuity", "explicit_recall", "relationship_motif", "open_thread", "canon_required", "conflict_avoidance", "tone_guidance", "user_preference", "pending_commitment", "safety_boundary"] as const;
    const EXPECTED_REJECTED = ["irrelevant", "too_broad", "duplicate", "conflicts_recent", "too_old", "low_confidence", "canon_not_needed", "memory_not_needed", "unsafe"] as const;

    // Selected set match
    assert.deepEqual([...__testing.SELECTED_REASON_CODES], [...EXPECTED_SELECTED], "SELECTED reason codes match");

    // Every selected code accepted
    for (const code of EXPECTED_SELECTED) {
      const parsed = __testing.CompactRawRerankOutputSchema.safeParse({
        selected: [{ id: "m1", relevance: "useful", usageInstruction: "use_subtly", reasonCode: code }],
        rejected: [], finalContextMode: "recent_only", needsEvidenceFallback: false,
      });
      assert.ok(parsed.success, `selected reasonCode "${code}" should be valid`);
    }

    // Unknown selected code rejected
    let parsed = __testing.CompactRawRerankOutputSchema.safeParse({
      selected: [{ id: "m1", relevance: "useful", usageInstruction: "use_subtly", reasonCode: "unknown_code" }],
      rejected: [], finalContextMode: "recent_only", needsEvidenceFallback: false,
    });
    assert.equal(parsed.success, false, "unknown selected code rejected");

    // Rejected set match
    assert.deepEqual([...__testing.REJECTED_REASON_CODES], [...EXPECTED_REJECTED], "REJECTED reason codes match");

    // Every rejected code accepted
    for (const code of EXPECTED_REJECTED) {
      parsed = __testing.CompactRawRerankOutputSchema.safeParse({
        selected: [], rejected: [{ id: "m1", reasonCode: code }],
        finalContextMode: "recent_only", needsEvidenceFallback: false,
      });
      assert.ok(parsed.success, `rejected reasonCode "${code}" should be valid`);
    }

    // Unknown rejected code rejected
    parsed = __testing.CompactRawRerankOutputSchema.safeParse({
      selected: [], rejected: [{ id: "m1", reasonCode: "unknown_code" }],
      finalContextMode: "recent_only", needsEvidenceFallback: false,
    });
    assert.equal(parsed.success, false, "unknown rejected code rejected");
  });
});

// ---------------------------------------------------------------------------
// resolveCandidate
// ---------------------------------------------------------------------------

describe("resolveCandidate", () => {
  it("resolves by exact string ID, numeric index, numeric string, and handles edge cases", () => {
    const candidates: ContextCandidate[] = [
      makeCandidate({ id: "session_summary", source: "session_summary", text: "summary", score: 0.9 }),
      makeCandidate({ id: "latest_turn_delta", source: "latest_turn_delta", text: "delta", score: 0.8 }),
      makeCandidate({ id: "mem_1", source: "interactive_memory", text: "memory", score: 0.7 }),
    ];

    let r = __testing.resolveCandidate("mem_1", candidates);
    assert.notEqual(r, null, "string — not null");
    assert.equal(r!.id, "mem_1", "string — id");
    assert.equal(r!.source, "interactive_memory", "string — source");

    r = __testing.resolveCandidate(1, candidates);
    assert.notEqual(r, null, "numeric — not null");
    assert.equal(r!.id, "latest_turn_delta", "numeric — id");

    r = __testing.resolveCandidate("2", candidates);
    assert.notEqual(r, null, "numeric string — not null");
    assert.equal(r!.id, "mem_1", "numeric string — id");

    r = __testing.resolveCandidate("session_summary", candidates);
    assert.notEqual(r, null, "exact string — not null");
    assert.equal(r!.id, "session_summary", "exact string — id");

    assert.equal(__testing.resolveCandidate(99, candidates), null, "OOB — null");
    assert.equal(__testing.resolveCandidate(-1, candidates), null, "negative — null");
    assert.equal(__testing.resolveCandidate(0.5, candidates), null, "float — null");
    assert.equal(__testing.resolveCandidate(NaN, candidates), null, "NaN — null");
    assert.equal(__testing.resolveCandidate("nonexistent", candidates), null, "unknown string — null");
    assert.equal(__testing.resolveCandidate(0, []), null, "empty candidates index — null");
    assert.equal(__testing.resolveCandidate("anything", []), null, "empty candidates string — null");
  });
});

// ---------------------------------------------------------------------------
// normalizeSelected
// ---------------------------------------------------------------------------

describe("normalizeSelected", () => {
  it("normalizes by string ID, numeric index, drops unknown, preserves metadata, empty", () => {
    const candidates: ContextCandidate[] = [
      makeCandidate({ id: "session_summary", source: "session_summary", text: "summary", score: 0.9 }),
      makeCandidate({ id: "latest_turn_delta", source: "latest_turn_delta", text: "delta", score: 0.8 }),
      makeCandidate({ id: "mem_1", source: "interactive_memory", text: "memory", score: 0.7 }),
    ];

    // String IDs use candidate source
    let r = __testing.normalizeSelected([{ id: "session_summary" as const, relevance: "useful" as const, usageInstruction: "use_subtly" as const, reasonCode: "direct_continuity" as const }], candidates);
    assert.equal(r.length, 1, "string — count");
    assert.equal(r[0].id, "session_summary", "string — id");
    assert.equal(r[0].source, "session_summary", "string — source");

    // Numeric indexes
    r = __testing.normalizeSelected([{ id: 2 as const, relevance: "required" as const, usageInstruction: "must_use" as const, reasonCode: "explicit_recall" as const }], candidates);
    assert.equal(r.length, 1, "numeric — count");
    assert.equal(r[0].id, "mem_1", "numeric — id");
    assert.equal(r[0].source, "interactive_memory", "numeric — source");

    // Numeric string via index
    r = __testing.normalizeSelected([{ id: "1" as const, relevance: "useful" as const, usageInstruction: "use_subtly" as const, reasonCode: "open_thread" as const }], candidates);
    assert.equal(r.length, 1, "num str — count");
    assert.equal(r[0].id, "latest_turn_delta", "num str — id");

    // Unknown IDs dropped
    r = __testing.normalizeSelected([{ id: "nonexistent" as const, relevance: "useful" as const, usageInstruction: "use_subtly" as const, reasonCode: "direct_continuity" as const }, { id: 99 as const, relevance: "useful" as const, usageInstruction: "use_subtly" as const, reasonCode: "direct_continuity" as const }, { id: -1 as const, relevance: "useful" as const, usageInstruction: "use_subtly" as const, reasonCode: "direct_continuity" as const }], candidates);
    assert.equal(r.length, 0, "unknown — all dropped");

    // Preserves relevance, usageInstruction, reasonCode
    r = __testing.normalizeSelected([{ id: 0 as const, relevance: "subtle_tone_only" as const, usageInstruction: "tone_only" as const, reasonCode: "tone_guidance" as const }], candidates);
    assert.equal(r.length, 1, "preserve — count");
    assert.equal(r[0].relevance, "subtle_tone_only", "preserve — relevance");
    assert.equal(r[0].usageInstruction, "tone_only", "preserve — usageInstruction");
    assert.equal(r[0].reasonCode, "tone_guidance", "preserve — reasonCode");

    // Empty input
    assert.equal(__testing.normalizeSelected([], candidates).length, 0, "empty — count");
  });
});

// ---------------------------------------------------------------------------
// normalizeRejected
// ---------------------------------------------------------------------------

describe("normalizeRejected", () => {
  it("normalizes by string/numeric ID, drops unknown, handles empty", () => {
    const candidates: ContextCandidate[] = [
      makeCandidate({ id: "session_summary", source: "session_summary", text: "summary", score: 0.9 }),
      makeCandidate({ id: "latest_turn_delta", source: "latest_turn_delta", text: "delta", score: 0.8 }),
      makeCandidate({ id: "mem_1", source: "interactive_memory", text: "memory", score: 0.7 }),
    ];

    // String IDs
    let r = __testing.normalizeRejected([{ id: "mem_1" as const, reasonCode: "too_old" as const }], candidates);
    assert.equal(r.length, 1, "string — count");
    assert.equal(r[0].id, "mem_1", "string — id");
    assert.equal(r[0].source, "interactive_memory", "string — source");
    assert.equal(r[0].reasonCode, "too_old", "string — reasonCode");

    // Numeric index
    r = __testing.normalizeRejected([{ id: 0 as const, reasonCode: "irrelevant" as const }], candidates);
    assert.equal(r.length, 1, "numeric — count");
    assert.equal(r[0].id, "session_summary", "numeric — id");
    assert.equal(r[0].source, "session_summary", "numeric — source");

    // Unknown IDs dropped
    r = __testing.normalizeRejected([{ id: "nonexistent" as const, reasonCode: "duplicate" as const }, { id: 99 as const, reasonCode: "duplicate" as const }], candidates);
    assert.equal(r.length, 0, "unknown — all dropped");

    // Empty input
    assert.equal(__testing.normalizeRejected([], candidates).length, 0, "empty — count");
  });
});

// ---------------------------------------------------------------------------
// CompactRawRerankOutputSchema — numeric ID acceptance
// ---------------------------------------------------------------------------

describe("CompactRawRerankOutputSchema", () => {
  it("accepts numeric, mixed IDs, and rejects unknown values", () => {
    // Numeric selected IDs
    let parsed = __testing.CompactRawRerankOutputSchema.safeParse({
      selected: [{ id: 0, relevance: "useful", usageInstruction: "use_subtly", reasonCode: "direct_continuity" }, { id: 1, relevance: "required", usageInstruction: "must_use", reasonCode: "explicit_recall" }],
      rejected: [], finalContextMode: "selected_memory", needsEvidenceFallback: false,
    });
    assert.ok(parsed.success, "numeric selected");
    assert.equal(parsed.data!.selected.length, 2, "numeric selected count");

    // Numeric rejected IDs
    parsed = __testing.CompactRawRerankOutputSchema.safeParse({
      selected: [], rejected: [{ id: 0, reasonCode: "too_old" }, { id: 2, reasonCode: "duplicate" }],
      finalContextMode: "recent_only", needsEvidenceFallback: false,
    });
    assert.ok(parsed.success, "numeric rejected");
    assert.equal(parsed.data!.rejected.length, 2);

    // Mixed string and numeric
    parsed = __testing.CompactRawRerankOutputSchema.safeParse({
      selected: [{ id: "mem_1", relevance: "useful", usageInstruction: "use_subtly", reasonCode: "relationship_motif" }, { id: 0, relevance: "required", usageInstruction: "must_use", reasonCode: "explicit_recall" }],
      rejected: [{ id: "some_id", reasonCode: "too_old" }, { id: 2, reasonCode: "canon_not_needed" }],
      finalContextMode: "memory_and_canon", needsEvidenceFallback: false,
    });
    assert.ok(parsed.success, "mixed IDs");
    assert.equal(parsed.data!.selected.length, 2, "mixed selected count");
    assert.equal(parsed.data!.rejected.length, 2, "mixed rejected count");

    // Reject unknown relevance
    parsed = __testing.CompactRawRerankOutputSchema.safeParse({
      selected: [{ id: 0, relevance: "bogus_value", usageInstruction: "use_subtly", reasonCode: "direct_continuity" }],
      rejected: [], finalContextMode: "recent_only", needsEvidenceFallback: false,
    });
    assert.equal(parsed.success, false, "unknown relevance rejected");

    // Reject unknown reasonCode
    parsed = __testing.CompactRawRerankOutputSchema.safeParse({
      selected: [], rejected: [{ id: 0, reasonCode: "bogus_category" }],
      finalContextMode: "recent_only", needsEvidenceFallback: false,
    });
    assert.equal(parsed.success, false, "unknown reasonCode rejected");
  });
});

// ---------------------------------------------------------------------------
// Prompt hardening — candidate_index vs candidate_id
// ---------------------------------------------------------------------------

describe("prompt hardening — candidate_index vs candidate_id", () => {
  const { system, user } = buildMemoryRerankPrompt({
    currentUserMessage: "test", plannerIntent: "scene_continuation",
    candidates: [makeCandidate({ id: "mem_1", source: "interactive_memory", text: "test" })], maxSelected: 8,
  });

  it("candidate format includes index and id, warns against using index as id", () => {
    assert.ok(user.includes("candidate_index=0"), "index");
    assert.ok(user.includes("candidate_id=mem_1"), "id");
    assert.ok(system.includes("Never use `candidate_index` as the `id` value"), "warning");
    assert.ok(system.includes("JSON `id` field MUST use the"), "MUST use");
    assert.ok(system.includes('"<copy from candidate_id>"'), "copy instruction");
  });
});

// ---------------------------------------------------------------------------
// Compact prompt format
// ---------------------------------------------------------------------------

describe("compact prompt format", () => {
  const { system } = buildMemoryRerankPrompt({
    currentUserMessage: "test", plannerIntent: "scene_continuation",
    candidates: [], maxSelected: 8,
  });

  it("requires compact JSON, lists reason enum lines, avoids free-text", () => {
    assert.ok(system.includes("compact/minified JSON"), "compact JSON");
    assert.ok(system.includes("minified JSON"), "minified JSON");
    assert.ok(system.includes("enum reasonCode values only"), "enum only");
    assert.ok(system.includes("no free-text reasons"), "no free-text");
    assert.ok(system.includes("Do not include a `source` field"), "no source");
    assert.ok(!system.includes('"source":'), 'source absent');
    assert.ok(!system.includes('"reason":'), 'reason absent');
    assert.ok(!system.includes('"risk":'), 'risk absent');

    const selectedEnum = '"reasonCode": "direct_continuity | explicit_recall | relationship_motif | open_thread | canon_required | conflict_avoidance | tone_guidance | user_preference | pending_commitment | safety_boundary"';
    assert.ok(system.includes(selectedEnum), "selected reason enum");

    const rejectedEnum = '"reasonCode": "irrelevant | too_broad | duplicate | conflicts_recent | too_old | low_confidence | canon_not_needed | memory_not_needed | unsafe"';
    assert.ok(system.includes(rejectedEnum), "rejected reason enum");
  });
});

// ---------------------------------------------------------------------------
// rerankRequestExtensions
// ---------------------------------------------------------------------------

describe("rerankRequestExtensions", () => {
  it("returns thinking disabled for DeepSeek, undefined for others", () => {
    assert.deepEqual(__testing.rerankRequestExtensions({ provider: "deepseek", model: "deepseek-chat" }), { thinking: { type: "disabled" } }, "DeepSeek");
    assert.equal(__testing.rerankRequestExtensions({ provider: "anthropic", model: "claude-3" }), undefined, "Anthropic");
    assert.equal(__testing.rerankRequestExtensions({ provider: "openai", model: "gpt-4" }), undefined, "OpenAI");
  });
});

// ---------------------------------------------------------------------------
// Rerank timeout and abort
// ---------------------------------------------------------------------------

describe("rerank timeout and abort", () => {
  it("defaults to 30000ms, resolves with timeout reason, and cancel() prevents firing", async () => {
    assert.equal(env.MEMORY_RERANK_TIMEOUT_MS, 30000, "default 30000");

    const { promise, controller } = __testing.createRerankTimeout(5);
    const result = await promise;
    assert.equal(result.ok, false, "timeout — !ok");
    if (!result.ok) assert.equal(result.fallbackReason, "timeout_after_5ms", "timeout — reason");
    assert.ok(controller.signal.aborted, "timeout — aborted");

    // Cancel prevents timeout
    const { promise: p2, cancel } = __testing.createRerankTimeout(50);
    cancel();
    const raced = await Promise.race([
      p2.then(() => "timeout" as const),
      new Promise<"sentinel">((resolve) => setTimeout(() => resolve("sentinel"), 100)),
    ]);
    assert.equal(raced, "sentinel", "cancel — sentinel wins");
  });
});

// ---------------------------------------------------------------------------
// Rerank diagnostics shape
// ---------------------------------------------------------------------------

describe("rerank diagnostics shape", () => {
  it("buildRetrievalDiagnosticsPayload accepts rerank-success diagnostics", () => {
    const diagnostics = {
      retrievedCounts: { interactive_memory: 4, session_chunk: 3, structmem_entry: 2, structmem_consolidation: 1, open_thread: 2 },
      injectedCounts: { interactive_memory: 1, session_chunk: 1, structmem_entry: 0, structmem_consolidation: 0, open_thread: 0 },
      droppedDuplicateCount: 0, droppedLowScoreCount: 0, droppedCorrectionCount: 0, droppedBudgetCount: 0,
      topSources: [] as PromptMemorySource[], averageInjectedScore: null,
    } satisfies PromptMemorySelectionDiagnostics;

    const payload = buildRetrievalDiagnosticsPayload({
      retrievalPlan: { intent: "scene_continuation", broadFailOpen: false, canonMode: "skip", forceOpenThreads: false,
        durableMemoryTopK: 4, sessionRecallTopK: 5, structMemEntryTopK: 6, structMemConsolidationTopK: 4, openThreadTopK: 3,
        contextNeed: { needsRecentTurns: true, needsOlderSessionRecall: false, needsDurableMemory: false, needsStructMem: false,
          needsStructMemConsolidation: false, needsCanon: false, needsWeb: false, injectionMode: "skip", reason: "" } },
      memoryQueryMode: "single", rewriteConfidence: null, annotationFallback: false,
      boundaryOverlapTurns: 5, olderRecallExclusiveFirstTurn: 0, latestTurnDeltaActive: false,
      structMemEntryExpansion: { eligibleCount: 0, expandedCount: 0, droppedByBudgetCount: 0 },
      timingsMs: { queryRewriteMs: 100, embeddingsMs: 200, mainRetrievalMs: 300, olderRecallMs: 400, openThreadsMs: 50, selectorMs: 5000, totalResolveContextMs: 6050 },
      selectionDiagnostics: diagnostics,
      rerank: { selectedCount: 1, rejectedCount: 2, finalContextMode: "selected_memory", needsEvidenceFallback: false },
    }) as Record<string, unknown>;

    const rerank = payload.rerank as Record<string, unknown> | null;
    assert.notEqual(rerank, null, "rerank present");
    assert.equal(rerank!.selectedCount, 1, "selectedCount");
    assert.ok(Array.isArray(payload.topSources), "topSources array");
  });
});

// ---------------------------------------------------------------------------
// countIdResolutionModes
// ---------------------------------------------------------------------------

describe("countIdResolutionModes", () => {
  it("counts exact matches, numeric indexes, and unresolved IDs", () => {
    const candidates: ContextCandidate[] = [
      makeCandidate({ id: "session_summary", source: "session_summary", text: "summary", score: 0.9 }),
      makeCandidate({ id: "latest_turn_delta", source: "latest_turn_delta", text: "delta", score: 0.8 }),
      makeCandidate({ id: "mem_1", source: "interactive_memory", text: "memory", score: 0.7 }),
    ];

    let r = __testing.countIdResolutionModes([{ id: "session_summary" }, { id: "mem_1" }], candidates);
    assert.equal(r.exactIdCount, 2, "exact — count");
    assert.equal(r.numericIndexCount, 0, "exact — numeric 0");
    assert.equal(r.unresolvedCount, 0, "exact — unresolved 0");

    r = __testing.countIdResolutionModes([{ id: 0 }, { id: 2 }], candidates);
    assert.equal(r.exactIdCount, 0, "numeric — exact 0");
    assert.equal(r.numericIndexCount, 2, "numeric — count");
    assert.equal(r.unresolvedCount, 0, "numeric — unresolved 0");

    r = __testing.countIdResolutionModes([{ id: "nonexistent" }, { id: 99 }], candidates);
    assert.equal(r.exactIdCount, 0, "unknown — exact 0");
    assert.equal(r.numericIndexCount, 0, "unknown — numeric 0");
    assert.equal(r.unresolvedCount, 2, "unknown — unresolved 2");

    r = __testing.countIdResolutionModes([{ id: "1" }], candidates);
    assert.equal(r.exactIdCount, 0, "num str — exact 0");
    assert.equal(r.numericIndexCount, 1, "num str — numeric 1");
    assert.equal(r.unresolvedCount, 0, "num str — unresolved 0");

    r = __testing.countIdResolutionModes([{ id: "session_summary" }], candidates);
    assert.equal(r.exactIdCount, 1, "exact string — count");
    assert.equal(r.numericIndexCount, 0, "exact string — numeric 0");
    assert.equal(r.unresolvedCount, 0, "exact string — unresolved 0");

    r = __testing.countIdResolutionModes([{ id: "session_summary" }, { id: 1 }, { id: "ghost" }, { id: "mem_1" }, { id: 99 }], candidates);
    assert.equal(r.exactIdCount, 2, "mixed — exact 2");
    assert.equal(r.numericIndexCount, 1, "mixed — numeric 1");
    assert.equal(r.unresolvedCount, 2, "mixed — unresolved 2");

    assert.deepEqual(__testing.countIdResolutionModes([], candidates), { exactIdCount: 0, numericIndexCount: 0, unresolvedCount: 0 }, "empty");
  });
});

// ---------------------------------------------------------------------------
// safeRawPreview
// ---------------------------------------------------------------------------

describe("reranker non-JSON failure diagnostics", () => {
  it("safeRawPreview strips controls, truncates long, preserves short/newlines", () => {
    // Strips control characters
    let result = __testing.safeRawPreview("hello\x00world\x01test");
    assert.equal(result.includes("\x00"), false, "strip null");
    assert.equal(result.includes("\x01"), false, "strip SOH");
    assert.ok(result.includes("hello"), "has hello");
    assert.ok(result.includes("world"), "has world");

    // Truncates long with ellipsis
    result = __testing.safeRawPreview("a".repeat(500), 50);
    assert.equal(result.length, 53, "truncated length");
    assert.ok(result.endsWith("..."), "ellipsis");

    // Short strings preserved
    assert.equal(__testing.safeRawPreview("hello world"), "hello world", "short preserved");

    // Newlines preserved
    assert.ok(__testing.safeRawPreview("line1\nline2\r\nline3").includes("\n"), "newlines preserved");

    // Bounded preview for very long raw output
    const longRaw = "x".repeat(1000);
    const preview = __testing.safeRawPreview(longRaw);
    assert.ok(preview.length < longRaw.length, "bounded — shorter");
    assert.ok(preview.endsWith("..."), "bounded — ellipsis");
    assert.ok(preview.length <= 203, "bounded — max 203");
  });
});
