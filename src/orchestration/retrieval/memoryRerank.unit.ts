import { describe, it } from "node:test";
import assert from "node:assert";
import type { ContextCandidate } from "../context/contextCandidates";
import type { PromptMemorySource, PromptMemorySelectionDiagnostics } from "../context/promptMemoryContextSelector";
import { buildMemoryRerankPrompt } from "./memoryRerankPrompt";
import { __testing } from "./memoryRerank";
import { env } from "../../config/env";
import { buildRetrievalDiagnosticsPayload } from "./retrievalDiagnostics";
import type { RetrievalPlan } from "./retrievalPlan";

function makeCandidate(
  overrides: Partial<ContextCandidate> = {},
): ContextCandidate {
  return {
    id: overrides.id ?? "c1",
    source: overrides.source ?? "structmem_entry",
    text: overrides.text ?? "A shared memory of a cafe meeting.",
    score: overrides.score ?? 0.5,
    turnStart: overrides.turnStart ?? null,
    turnEnd: overrides.turnEnd ?? null,
  };
}

describe("buildMemoryRerankPrompt", () => {
  it("includes candidate text and source", () => {
    const { system, user } = buildMemoryRerankPrompt({
      currentUserMessage: "你还记得我们上次在咖啡馆说了什么吗？",
      plannerIntent: "explicit_recall",
      candidates: [
        makeCandidate({ id: "mem_1", source: "interactive_memory", text: "咖啡馆对话" }),
      ],
      maxSelected: 8,
    });
    assert.ok(system.includes("memory relevance judge"));
    assert.ok(user.includes("咖啡馆对话"));
    assert.ok(user.includes("explicit_recall"));
    assert.ok(user.includes("mem_1"));
  });

  it("renders intent hint for canon_question", () => {
    const { user } = buildMemoryRerankPrompt({
      currentUserMessage: "原作第三章是谁提出的？",
      plannerIntent: "canon_question",
      candidates: [makeCandidate({ source: "canon_chunk" })],
      maxSelected: 8,
    });
    assert.ok(user.includes("canon/story fact question"));
  });

  it("renders intent hint for scene_continuation", () => {
    const { user } = buildMemoryRerankPrompt({
      currentUserMessage: "我看着他，等着回应。",
      plannerIntent: "scene_continuation",
      candidates: [],
      maxSelected: 8,
    });
    assert.ok(user.includes("continuity"));
  });

  it("includes max selected count in system prompt", () => {
    const { system } = buildMemoryRerankPrompt({
      currentUserMessage: "test",
      plannerIntent: "scene_continuation",
      candidates: [],
      maxSelected: 5,
    });
    assert.ok(system.includes("5"));
  });
});

describe("validateSelected", () => {
  it("drops selected IDs unknown in candidates", () => {
    const result = __testing.validateSelected(
      [
        {
          id: "ghost",
          source: "interactive_memory",
          relevance: "useful",
          usageInstruction: "use_subtly",
          reasonCode: "direct_continuity",
        },
        {
          id: "real_1",
          source: "interactive_memory",
          relevance: "useful",
          usageInstruction: "use_subtly",
          reasonCode: "direct_continuity",
        },
      ],
      [makeCandidate({ id: "real_1", source: "interactive_memory" })],
      8,
    );
    assert.equal(result.length, 1);
    assert.equal(result[0]!.id, "real_1");
  });

  it("caps selected to max count", () => {
    const selected = Array.from({ length: 12 }, (_, i) => ({
      id: `item_${i}`,
      source: "structmem_entry" as const,
      relevance: "useful" as const,
      usageInstruction: "use_subtly" as const,
      reasonCode: "direct_continuity" as const,
    }));
    const candidates = selected.map((s) => makeCandidate({ id: s.id }));
    const result = __testing.validateSelected(selected, candidates, 8);
    assert.equal(result.length, 8);
  });
});

describe("applyEmptySelectionGuard", () => {
  const candidates: ContextCandidate[] = [
    makeCandidate({ id: "best_mem", source: "interactive_memory", text: "重要回忆", score: 0.9 }),
    makeCandidate({ id: "best_canon", source: "canon_chunk", text: "原作事实", score: 0.8 }),
  ];

  const emptyOutput = {
    selected: [],
    rejected: [],
    finalContextMode: "recent_only" as const,
    needsEvidenceFallback: false,
  };

  it("picks best non-canon for explicit_recall when selected is empty", () => {
    const result = __testing.applyEmptySelectionGuard(
      emptyOutput,
      candidates,
      "explicit_recall",
    );
    assert.equal(result.selected.length, 1);
    assert.equal(result.selected[0]!.id, "best_mem");
    assert.equal(result.selected[0]!.reasonCode, "direct_continuity");
  });

  it("picks best canon for canon_question when selected is empty", () => {
    const result = __testing.applyEmptySelectionGuard(
      emptyOutput,
      candidates,
      "canon_question",
    );
    assert.equal(result.selected.length, 1);
    assert.equal(result.selected[0]!.id, "best_canon");
  });

  it("does not apply for scene_continuation", () => {
    assert.deepEqual(
      __testing.applyEmptySelectionGuard(
        { selected: [], rejected: [], finalContextMode: "recent_only", needsEvidenceFallback: false },
        [],
        "scene_continuation",
      ),
      { selected: [], rejected: [], finalContextMode: "recent_only", needsEvidenceFallback: false },
    );
  });

  it("picks canon_fact for canon_question when selected is empty", () => {
    const candidates = [
      makeCandidate({ id: "fact_1", source: "canon_fact", text: "A key story fact.", score: 0.9 }),
      makeCandidate({ id: "mem_1", source: "interactive_memory", text: "A memory.", score: 0.8 }),
    ];
    const result = __testing.applyEmptySelectionGuard(
      { selected: [], rejected: [], finalContextMode: "recent_only", needsEvidenceFallback: false },
      candidates,
      "canon_question",
    );
    assert.equal(result.selected.length, 1);
    assert.equal(result.selected[0]!.source, "canon_fact");
  });

  it("does not pick canon_fact for explicit_recall (non-canon guard)", () => {
    const candidates = [
      makeCandidate({ id: "fact_1", source: "canon_fact", text: "A key story fact.", score: 0.9 }),
      makeCandidate({ id: "mem_1", source: "interactive_memory", text: "A memory.", score: 0.7 }),
    ];
    const result = __testing.applyEmptySelectionGuard(
      { selected: [], rejected: [], finalContextMode: "recent_only", needsEvidenceFallback: false },
      candidates,
      "explicit_recall",
    );
    assert.equal(result.selected.length, 1);
    assert.notEqual(result.selected[0]!.source, "canon_fact", "should not pick canon_fact for non-canon intent");
    assert.equal(result.selected[0]!.source, "interactive_memory");
  });
});

describe("compact selected reason codes", () => {
  const EXPECTED_SELECTED = [
    "direct_continuity",
    "explicit_recall",
    "relationship_motif",
    "open_thread",
    "canon_required",
    "conflict_avoidance",
    "tone_guidance",
    "user_preference",
    "pending_commitment",
    "safety_boundary",
  ] as const;

  it("SELECTED_REASON_CODES matches the expected set", () => {
    assert.deepEqual([...__testing.SELECTED_REASON_CODES], [...EXPECTED_SELECTED]);
  });

  it("every selected reason code is accepted via compact schema", () => {
    for (const code of EXPECTED_SELECTED) {
      const parsed = __testing.CompactRawRerankOutputSchema.safeParse({
        selected: [
          { id: "m1", relevance: "useful", usageInstruction: "use_subtly", reasonCode: code },
        ],
        rejected: [],
        finalContextMode: "recent_only",
        needsEvidenceFallback: false,
      });
      assert.ok(
        parsed.success,
        `selected reasonCode "${code}" should be valid: ${JSON.stringify(parsed.error?.format())}`,
      );
    }
  });

  it("unknown selected reasonCode is rejected", () => {
    const parsed = __testing.CompactRawRerankOutputSchema.safeParse({
      selected: [
        { id: "m1", relevance: "useful", usageInstruction: "use_subtly", reasonCode: "unknown_code" },
      ],
      rejected: [],
      finalContextMode: "recent_only",
      needsEvidenceFallback: false,
    });
    assert.equal(parsed.success, false, "unknown selected reasonCode must be rejected");
  });
});

describe("compact rejected reason codes", () => {
  const EXPECTED_REJECTED = [
    "irrelevant",
    "too_broad",
    "duplicate",
    "conflicts_recent",
    "too_old",
    "low_confidence",
    "canon_not_needed",
    "memory_not_needed",
    "unsafe",
  ] as const;

  it("REJECTED_REASON_CODES matches the expected set", () => {
    assert.deepEqual([...__testing.REJECTED_REASON_CODES], [...EXPECTED_REJECTED]);
  });

  it("every rejected reason code is accepted via compact schema", () => {
    for (const code of EXPECTED_REJECTED) {
      const parsed = __testing.CompactRawRerankOutputSchema.safeParse({
        selected: [],
        rejected: [{ id: "m1", reasonCode: code }],
        finalContextMode: "recent_only",
        needsEvidenceFallback: false,
      });
      assert.ok(
        parsed.success,
        `rejected reasonCode "${code}" should be valid: ${JSON.stringify(parsed.error?.format())}`,
      );
    }
  });

  it("unknown rejected reasonCode is rejected", () => {
    const parsed = __testing.CompactRawRerankOutputSchema.safeParse({
      selected: [],
      rejected: [{ id: "m1", reasonCode: "unknown_code" }],
      finalContextMode: "recent_only",
      needsEvidenceFallback: false,
    });
    assert.equal(parsed.success, false, "unknown rejected reasonCode must be rejected");
  });
});

describe("resolveCandidate", () => {
  const candidates: ContextCandidate[] = [
    makeCandidate({ id: "session_summary", source: "session_summary", text: "summary", score: 0.9 }),
    makeCandidate({ id: "latest_turn_delta", source: "latest_turn_delta", text: "delta", score: 0.8 }),
    makeCandidate({ id: "mem_1", source: "interactive_memory", text: "memory", score: 0.7 }),
  ];

  it("resolves exact string ID match", () => {
    const result = __testing.resolveCandidate("mem_1", candidates);
    assert.notEqual(result, null);
    assert.equal(result!.id, "mem_1");
    assert.equal(result!.source, "interactive_memory");
  });

  it("resolves numeric ID as candidate list index", () => {
    const result = __testing.resolveCandidate(1, candidates);
    assert.notEqual(result, null);
    assert.equal(result!.id, "latest_turn_delta");
    assert.equal(result!.source, "latest_turn_delta");
  });

  it("resolves numeric string as index when no exact match", () => {
    // "2" does not match any candidate ID → treated as index
    const result = __testing.resolveCandidate("2", candidates);
    assert.notEqual(result, null);
    assert.equal(result!.id, "mem_1");
    assert.equal(result!.source, "interactive_memory");
  });

  it("prefers exact string match over index for numeric string", () => {
    // "session_summary" is both a valid ID and not a parseable index anyway
    const result = __testing.resolveCandidate("session_summary", candidates);
    assert.notEqual(result, null);
    assert.equal(result!.id, "session_summary");
  });

  it("returns null for out-of-range numeric ID", () => {
    assert.equal(__testing.resolveCandidate(99, candidates), null);
    assert.equal(__testing.resolveCandidate(-1, candidates), null);
  });

  it("returns null for non-integer numeric ID", () => {
    assert.equal(__testing.resolveCandidate(0.5, candidates), null);
    assert.equal(__testing.resolveCandidate(NaN, candidates), null);
  });

  it("returns null for unknown string ID that is not a valid index", () => {
    assert.equal(__testing.resolveCandidate("nonexistent", candidates), null);
  });

  it("returns null for empty candidates list", () => {
    assert.equal(__testing.resolveCandidate(0, []), null);
    assert.equal(__testing.resolveCandidate("anything", []), null);
  });
});

describe("normalizeSelected", () => {
  const candidates: ContextCandidate[] = [
    makeCandidate({ id: "session_summary", source: "session_summary", text: "summary", score: 0.9 }),
    makeCandidate({ id: "latest_turn_delta", source: "latest_turn_delta", text: "delta", score: 0.8 }),
    makeCandidate({ id: "mem_1", source: "interactive_memory", text: "memory", score: 0.7 }),
  ];

  it("passes through string IDs that match candidates, using candidate source", () => {
    const raw = [
      { id: "session_summary" as const, relevance: "useful" as const, usageInstruction: "use_subtly" as const, reasonCode: "direct_continuity" as const },
    ];
    const result = __testing.normalizeSelected(raw, candidates);
    assert.equal(result.length, 1);
    assert.equal(result[0].id, "session_summary");
    assert.equal(result[0].source, "session_summary");  // candidate source, not raw source
  });

  it("maps numeric selected IDs via candidate index", () => {
    const raw = [
      { id: 2 as const, relevance: "required" as const, usageInstruction: "must_use" as const, reasonCode: "explicit_recall" as const },
    ];
    const result = __testing.normalizeSelected(raw, candidates);
    assert.equal(result.length, 1);
    assert.equal(result[0].id, "mem_1");
    assert.equal(result[0].source, "interactive_memory");
  });

  it("maps numeric-string selected IDs via index when no exact match", () => {
    const raw = [
      { id: "1" as const, relevance: "useful" as const, usageInstruction: "use_subtly" as const, reasonCode: "open_thread" as const },
    ];
    const result = __testing.normalizeSelected(raw, candidates);
    assert.equal(result.length, 1);
    assert.equal(result[0].id, "latest_turn_delta");
  });

  it("drops unknown selected IDs", () => {
    const raw = [
      { id: "nonexistent" as const, relevance: "useful" as const, usageInstruction: "use_subtly" as const, reasonCode: "direct_continuity" as const },
      { id: 99 as const, relevance: "useful" as const, usageInstruction: "use_subtly" as const, reasonCode: "direct_continuity" as const },
      { id: -1 as const, relevance: "useful" as const, usageInstruction: "use_subtly" as const, reasonCode: "direct_continuity" as const },
    ];
    const result = __testing.normalizeSelected(raw, candidates);
    assert.equal(result.length, 0);
  });

  it("preserves relevance, usageInstruction, and reasonCode from raw item", () => {
    const raw = [
      { id: 0 as const, relevance: "subtle_tone_only" as const, usageInstruction: "tone_only" as const, reasonCode: "tone_guidance" as const },
    ];
    const result = __testing.normalizeSelected(raw, candidates);
    assert.equal(result.length, 1);
    assert.equal(result[0].relevance, "subtle_tone_only");
    assert.equal(result[0].usageInstruction, "tone_only");
    assert.equal(result[0].reasonCode, "tone_guidance");
  });

  it("handles empty input", () => {
    const result = __testing.normalizeSelected([], candidates);
    assert.equal(result.length, 0);
  });
});

describe("normalizeRejected", () => {
  const candidates: ContextCandidate[] = [
    makeCandidate({ id: "session_summary", source: "session_summary", text: "summary", score: 0.9 }),
    makeCandidate({ id: "latest_turn_delta", source: "latest_turn_delta", text: "delta", score: 0.8 }),
    makeCandidate({ id: "mem_1", source: "interactive_memory", text: "memory", score: 0.7 }),
  ];

  it("passes through string IDs that match candidates, using candidate source", () => {
    const raw = [
      { id: "mem_1" as const, reasonCode: "too_old" as const },
    ];
    const result = __testing.normalizeRejected(raw, candidates);
    assert.equal(result.length, 1);
    assert.equal(result[0].id, "mem_1");
    assert.equal(result[0].source, "interactive_memory");
    assert.equal(result[0].reasonCode, "too_old");
  });

  it("maps numeric rejected IDs via candidate index", () => {
    const raw = [
      { id: 0 as const, reasonCode: "irrelevant" as const },
    ];
    const result = __testing.normalizeRejected(raw, candidates);
    assert.equal(result.length, 1);
    assert.equal(result[0].id, "session_summary");
    assert.equal(result[0].source, "session_summary");
  });

  it("drops unknown rejected IDs", () => {
    const raw = [
      { id: "nonexistent" as const, reasonCode: "duplicate" as const },
      { id: 99 as const, reasonCode: "duplicate" as const },
    ];
    const result = __testing.normalizeRejected(raw, candidates);
    assert.equal(result.length, 0);
  });

  it("handles empty input", () => {
    const result = __testing.normalizeRejected([], candidates);
    assert.equal(result.length, 0);
  });
});

describe("CompactRawRerankOutputSchema — numeric ID acceptance", () => {
  it("accepts numeric selected IDs", () => {
    const parsed = __testing.CompactRawRerankOutputSchema.safeParse({
      selected: [
        { id: 0, relevance: "useful", usageInstruction: "use_subtly", reasonCode: "direct_continuity" },
        { id: 1, relevance: "required", usageInstruction: "must_use", reasonCode: "explicit_recall" },
      ],
      rejected: [],
      finalContextMode: "selected_memory",
      needsEvidenceFallback: false,
    });
    assert.ok(parsed.success, `compact schema should accept numeric selected IDs: ${JSON.stringify(parsed.error?.format())}`);
    assert.equal(parsed.data!.selected.length, 2);
  });

  it("accepts numeric rejected IDs", () => {
    const parsed = __testing.CompactRawRerankOutputSchema.safeParse({
      selected: [],
      rejected: [
        { id: 0, reasonCode: "too_old" },
        { id: 2, reasonCode: "duplicate" },
      ],
      finalContextMode: "recent_only",
      needsEvidenceFallback: false,
    });
    assert.ok(parsed.success, `compact schema should accept numeric rejected IDs: ${JSON.stringify(parsed.error?.format())}`);
    assert.equal(parsed.data!.rejected.length, 2);
  });

  it("accepts mixed string and numeric IDs", () => {
    const parsed = __testing.CompactRawRerankOutputSchema.safeParse({
      selected: [
        { id: "mem_1", relevance: "useful", usageInstruction: "use_subtly", reasonCode: "relationship_motif" },
        { id: 0, relevance: "required", usageInstruction: "must_use", reasonCode: "explicit_recall" },
      ],
      rejected: [
        { id: "some_id", reasonCode: "too_old" },
        { id: 2, reasonCode: "canon_not_needed" },
      ],
      finalContextMode: "memory_and_canon",
      needsEvidenceFallback: false,
    });
    assert.ok(parsed.success, "compact schema should accept mixed string and numeric IDs");
    assert.equal(parsed.data!.selected.length, 2);
    assert.equal(parsed.data!.rejected.length, 2);
  });

  it("still rejects unknown relevance value", () => {
    const parsed = __testing.CompactRawRerankOutputSchema.safeParse({
      selected: [
        { id: 0, relevance: "bogus_value", usageInstruction: "use_subtly", reasonCode: "direct_continuity" },
      ],
      rejected: [],
      finalContextMode: "recent_only",
      needsEvidenceFallback: false,
    });
    assert.equal(parsed.success, false, "compact schema should still reject unknown relevance");
  });

  it("still rejects unknown selected reasonCode", () => {
    const parsed = __testing.CompactRawRerankOutputSchema.safeParse({
      selected: [],
      rejected: [{ id: 0, reasonCode: "bogus_category" }],
      finalContextMode: "recent_only",
      needsEvidenceFallback: false,
    });
    assert.equal(parsed.success, false, "compact schema should still reject unknown reasonCode");
  });
});

describe("prompt hardening — candidate_index vs candidate_id", () => {
  const { system, user } = buildMemoryRerankPrompt({
    currentUserMessage: "test",
    plannerIntent: "scene_continuation",
    candidates: [makeCandidate({ id: "mem_1", source: "interactive_memory", text: "test" })],
    maxSelected: 8,
  });

  it("includes candidate_index in candidate format", () => {
    assert.ok(user.includes("candidate_index=0"), "candidate format should show candidate_index");
  });

  it("includes candidate_id in candidate format", () => {
    assert.ok(user.includes("candidate_id=mem_1"), "candidate format should show candidate_id");
  });

  it("explicitly warns not to use candidate_index as id", () => {
    assert.ok(
      system.includes("Never use `candidate_index` as the `id` value"),
      "prompt should warn against using candidate_index as id",
    );
  });

  it("tells the model to use candidate_id for the JSON id field", () => {
    assert.ok(
      system.includes("JSON `id` field MUST use the"),
      "prompt should emphasize using candidate_id for JSON id",
    );
  });

  it('shows "<copy from candidate_id>" in the JSON template', () => {
    assert.ok(
      system.includes('"<copy from candidate_id>"'),
      "JSON template id placeholder should reference candidate_id",
    );
  });
});

describe("compact prompt format", () => {
  it("instructs compact/minified JSON output", () => {
    const { system } = buildMemoryRerankPrompt({
      currentUserMessage: "test",
      plannerIntent: "scene_continuation",
      candidates: [],
      maxSelected: 8,
    });
    assert.ok(system.includes("compact/minified JSON"), "prompt should request compact JSON");
    assert.ok(system.includes("minified JSON"), "prompt should request minified JSON");
  });

  it("says enum reasonCode values only, no free-text reasons", () => {
    const { system } = buildMemoryRerankPrompt({
      currentUserMessage: "test",
      plannerIntent: "scene_continuation",
      candidates: [],
      maxSelected: 8,
    });
    assert.ok(
      system.includes("enum reasonCode values only"),
      "prompt should require enum reasonCode values only",
    );
    assert.ok(
      system.includes("no free-text reasons"),
      "prompt should forbid free-text reasons",
    );
  });

  it("says no source field in output", () => {
    const { system } = buildMemoryRerankPrompt({
      currentUserMessage: "test",
      plannerIntent: "scene_continuation",
      candidates: [],
      maxSelected: 8,
    });
    assert.ok(
      system.includes("Do not include a `source` field"),
      "prompt should tell the model not to emit source",
    );
  });

  it("selected reasonCode enum line lists all selected reason codes", () => {
    const { system } = buildMemoryRerankPrompt({
      currentUserMessage: "test",
      plannerIntent: "scene_continuation",
      candidates: [],
      maxSelected: 8,
    });
    const enumLine = '"reasonCode": "direct_continuity | explicit_recall | relationship_motif | open_thread | canon_required | conflict_avoidance | tone_guidance | user_preference | pending_commitment | safety_boundary"';
    assert.ok(
      system.includes(enumLine),
      "selected reasonCode enum line should list all selected reason codes",
    );
  });

  it("rejected reasonCode enum line lists all rejected reason codes", () => {
    const { system } = buildMemoryRerankPrompt({
      currentUserMessage: "test",
      plannerIntent: "scene_continuation",
      candidates: [],
      maxSelected: 8,
    });
    const enumLine = '"reasonCode": "irrelevant | too_broad | duplicate | conflicts_recent | too_old | low_confidence | canon_not_needed | memory_not_needed | unsafe"';
    assert.ok(
      system.includes(enumLine),
      "rejected reasonCode enum line should list all rejected reason codes",
    );
  });

  it("prompt JSON template has no source, reason, or risk fields", () => {
    const { system } = buildMemoryRerankPrompt({
      currentUserMessage: "test",
      plannerIntent: "scene_continuation",
      candidates: [],
      maxSelected: 8,
    });
    // The JSON template should not reference these old fields
    assert.ok(!system.includes('"source":'), "prompt JSON should not include source field");
    assert.ok(!system.includes('"reason":'), "prompt JSON should not include free-text reason field");
    assert.ok(!system.includes('"risk":'), "prompt JSON should not include risk field");
  });
});

describe("rerankRequestExtensions", () => {
  it("returns thinking disabled for DeepSeek", () => {
    const result = __testing.rerankRequestExtensions({ provider: "deepseek", model: "deepseek-chat" });
    assert.deepEqual(result, { thinking: { type: "disabled" } });
  });

  it("returns undefined for non-DeepSeek providers", () => {
    const anthropic = __testing.rerankRequestExtensions({ provider: "anthropic", model: "claude-3" });
    assert.equal(anthropic, undefined);

    const openai = __testing.rerankRequestExtensions({ provider: "openai", model: "gpt-4" });
    assert.equal(openai, undefined);
  });

});

describe("rerank timeout and abort", () => {
  it("MEMORY_RERANK_TIMEOUT_MS defaults to 30000", () => {
    assert.equal(env.MEMORY_RERANK_TIMEOUT_MS, 30000);
  });

  it("createRerankTimeout resolves with timeout-specific reason and aborts controller", async () => {
    const { promise, controller } = __testing.createRerankTimeout(5);
    const result = await promise;
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.fallbackReason, "timeout_after_5ms");
    }
    assert.ok(controller.signal.aborted, "AbortController should be aborted on timeout");
  });

  it("createRerankTimeout cancel() prevents the timeout from firing", async () => {
    const { promise, controller, cancel } = __testing.createRerankTimeout(50);
    cancel(); // Cancel before timer fires
    // After cancel, the promise never resolves. Race against a delayed sentinel
    // (100ms) to prove the timer was cleared — if cancel() did not work, the
    // 50ms timeout would fire before the sentinel and the test would fail.
    const result = await Promise.race([
      promise.then(() => "timeout" as const),
      new Promise<"sentinel">((resolve) => setTimeout(() => resolve("sentinel"), 100)),
    ]);
    assert.equal(result, "sentinel", "canceled timeout should not resolve");
    assert.ok(!controller.signal.aborted, "canceled timeout should not abort the controller");
  });
});

describe("rerank diagnostics shape", () => {
  it("buildRetrievalDiagnosticsPayload accepts rerank-success diagnostics", () => {
    const diagnostics = {
      retrievedCounts: {
        interactive_memory: 4,
        session_chunk: 3,
        structmem_entry: 2,
        structmem_consolidation: 1,
        open_thread: 2,
      },
      injectedCounts: {
        interactive_memory: 1,
        session_chunk: 1,
        structmem_entry: 0,
        structmem_consolidation: 0,
        open_thread: 0,
      },
      droppedDuplicateCount: 0,
      droppedLowScoreCount: 0,
      droppedCorrectionCount: 0,
      droppedBudgetCount: 0,
      topSources: [] as PromptMemorySource[],
      averageInjectedScore: null,
    } satisfies PromptMemorySelectionDiagnostics;

    const payload = buildRetrievalDiagnosticsPayload({
      retrievalPlan: {
        intent: "scene_continuation",
        broadFailOpen: false,
        canonMode: "skip",
        forceOpenThreads: false,
        durableMemoryTopK: 4,
        sessionRecallTopK: 5,
        structMemEntryTopK: 6,
        structMemConsolidationTopK: 4,
        openThreadTopK: 3,
        contextNeed: {
          needsRecentTurns: true,
          needsOlderSessionRecall: false,
          needsDurableMemory: false,
          needsStructMem: false,
          needsStructMemConsolidation: false,
          needsCanon: false,
          needsWeb: false,
          injectionMode: "skip",
          reason: "",
        },
      },
      memoryQueryMode: "single",
      rewriteConfidence: null,
      annotationFallback: false,
      boundaryOverlapTurns: 5,
      olderRecallExclusiveFirstTurn: 0,
      latestTurnDeltaActive: false,
      structMemEntryExpansion: { eligibleCount: 0, expandedCount: 0, droppedByBudgetCount: 0 },
      timingsMs: {
        queryRewriteMs: 100,
        embeddingsMs: 200,
        mainRetrievalMs: 300,
        olderRecallMs: 400,
        openThreadsMs: 50,
        selectorMs: 5000,
        totalResolveContextMs: 6050,
      },
      selectionDiagnostics: diagnostics,
      rerank: {
        selectedCount: 1,
        rejectedCount: 2,
        finalContextMode: "selected_memory",
        needsEvidenceFallback: false,
      },
    }) as Record<string, unknown>;

    const rerank = payload.rerank as Record<string, unknown> | null;
    assert.notEqual(rerank, null);
    assert.equal(rerank!.selectedCount, 1);
    assert.ok(Array.isArray(payload.topSources));
  });
});

describe("countIdResolutionModes", () => {
  const candidates: ContextCandidate[] = [
    makeCandidate({ id: "session_summary", source: "session_summary", text: "summary", score: 0.9 }),
    makeCandidate({ id: "latest_turn_delta", source: "latest_turn_delta", text: "delta", score: 0.8 }),
    makeCandidate({ id: "mem_1", source: "interactive_memory", text: "memory", score: 0.7 }),
  ];

  it("counts exact ID matches", () => {
    const result = __testing.countIdResolutionModes(
      [{ id: "session_summary" }, { id: "mem_1" }],
      candidates,
    );
    assert.equal(result.exactIdCount, 2);
    assert.equal(result.numericIndexCount, 0);
    assert.equal(result.unresolvedCount, 0);
  });

  it("counts numeric index resolutions", () => {
    const result = __testing.countIdResolutionModes(
      [{ id: 0 }, { id: 2 }],
      candidates,
    );
    assert.equal(result.exactIdCount, 0);
    assert.equal(result.numericIndexCount, 2);
    assert.equal(result.unresolvedCount, 0);
  });

  it("counts unresolved IDs", () => {
    const result = __testing.countIdResolutionModes(
      [{ id: "nonexistent" }, { id: 99 }],
      candidates,
    );
    assert.equal(result.exactIdCount, 0);
    assert.equal(result.numericIndexCount, 0);
    assert.equal(result.unresolvedCount, 2);
  });

  it("counts numeric-string IDs that resolve by index as numeric", () => {
    // "1" does not match any exact candidate ID, but resolves as index 1 → "latest_turn_delta"
    const result = __testing.countIdResolutionModes(
      [{ id: "1" }],
      candidates,
    );
    assert.equal(result.exactIdCount, 0);
    assert.equal(result.numericIndexCount, 1);
    assert.equal(result.unresolvedCount, 0);
  });

  it("prefers exact match over numeric index for numeric-string IDs", () => {
    // "session_summary" is a string that exactly matches a candidate ID
    const result = __testing.countIdResolutionModes(
      [{ id: "session_summary" }],
      candidates,
    );
    assert.equal(result.exactIdCount, 1);
    assert.equal(result.numericIndexCount, 0);
    assert.equal(result.unresolvedCount, 0);
  });

  it("handles mixed resolution modes", () => {
    const result = __testing.countIdResolutionModes(
      [
        { id: "session_summary" },  // exact
        { id: 1 },                   // numeric index → latest_turn_delta
        { id: "ghost" },             // unresolved
        { id: "mem_1" },             // exact
        { id: 99 },                  // unresolved
      ],
      candidates,
    );
    assert.equal(result.exactIdCount, 2);
    assert.equal(result.numericIndexCount, 1);
    assert.equal(result.unresolvedCount, 2);
  });

  it("handles empty input", () => {
    const result = __testing.countIdResolutionModes([], candidates);
    assert.equal(result.exactIdCount, 0);
    assert.equal(result.numericIndexCount, 0);
    assert.equal(result.unresolvedCount, 0);
  });
});

describe("reranker non-JSON failure diagnostics", () => {
  it("safeRawPreview strips control characters", () => {
    const raw = "hello\x00world\x01test";
    const result = __testing.safeRawPreview(raw);
    assert.equal(result.includes("\x00"), false, "null byte should be stripped");
    assert.equal(result.includes("\x01"), false, "SOH byte should be stripped");
    assert.ok(result.includes("hello"), "text should be preserved");
    assert.ok(result.includes("world"), "text should be preserved");
  });

  it("safeRawPreview truncates to default max length and appends ellipsis", () => {
    const raw = "a".repeat(500);
    const result = __testing.safeRawPreview(raw, 50);
    assert.equal(result.length, 53, "50 chars + '...' = 53");
    assert.ok(result.endsWith("..."), "should end with ellipsis");
  });

  it("safeRawPreview does not truncate short strings", () => {
    const raw = "hello world";
    const result = __testing.safeRawPreview(raw);
    assert.equal(result, "hello world");
  });

  it("safeRawPreview preserves newlines", () => {
    const raw = "line1\nline2\r\nline3";
    const result = __testing.safeRawPreview(raw);
    assert.ok(result.includes("\n"), "newlines should be preserved");
  });

  it("diagnostics rawPreview is bounded and never contains full raw output when raw is long", () => {
    const longRaw = "x".repeat(1000);
    const preview = __testing.safeRawPreview(longRaw);
    assert.ok(preview.length < longRaw.length, "preview should be shorter than raw");
    assert.ok(preview.endsWith("..."), "preview should indicate truncation");
    assert.ok(preview.length <= 203, "preview should not exceed max + ellipsis");
  });
});
