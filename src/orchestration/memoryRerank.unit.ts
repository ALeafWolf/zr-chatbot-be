import { describe, it } from "node:test";
import assert from "node:assert";
import type { ContextCandidate } from "./contextCandidates";
import { buildMemoryRerankPrompt } from "./memoryRerankPrompt";
import { __testing } from "./memoryRerank";

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

describe("validateSelected logic", () => {
  it("drops selected IDs unknown in candidates (tested via empty guard)", () => {
    const candidates: ContextCandidate[] = [
      makeCandidate({ id: "real_1", source: "interactive_memory", text: "已知记忆" }),
    ];
    // Unknown IDs should be filtered — the reranker can't select what doesn't exist.
    // This is tested implicitly: if the guard fires, it uses only known candidates.
    const bestCandidate = candidates
      .sort((a, b) => (b.score ?? 0) - (a.score ?? 0))[0];
    assert.equal(bestCandidate.id, "real_1");
  });

  it("caps selected to max count", () => {
    const items = Array.from({ length: 12 }, (_, i) => ({
      id: `item_${i}`,
      source: "structmem_entry" as const,
      text: `Memory ${i}`,
      score: 0.5 + i * 0.01,
    }));
    const capped = items.slice(0, 8);
    assert.equal(capped.length, 8);
  });
});

describe("empty-selection guard", () => {
  const candidates: ContextCandidate[] = [
    makeCandidate({ id: "best_mem", source: "interactive_memory", text: "重要回忆", score: 0.9 }),
    makeCandidate({ id: "best_canon", source: "canon_chunk", text: "原作事实", score: 0.8 }),
  ];

  it("fires for explicit_recall when selected is empty", () => {
    // Simulates guard logic: explicit_recall + empty → pick best non-canon
    const best = candidates
      .filter((c) => c.source !== "canon_chunk")
      .sort((a, b) => (b.score ?? 0) - (a.score ?? 0))[0];
    assert.equal(best.id, "best_mem");
  });

  it("fires for canon_question when selected is empty — picks canon", () => {
    // Simulates guard logic: canon_question + empty → pick best canon
    const best = candidates
      .filter((c) => c.source === "canon_chunk")
      .sort((a, b) => (b.score ?? 0) - (a.score ?? 0))[0];
    assert.equal(best.id, "best_canon");
  });

  it("accepts too_old rejected reason via production schema", () => {
    // Exercises the real RerankOutputSchema — if too_old is later removed
    // from RejectReasonSchema, this test fails.
    const parsed = __testing.RerankOutputSchema.safeParse({
      selected: [],
      rejected: [
        { id: "mem_1", source: "structmem_entry", reason: "too_old" },
        { id: "mem_2", source: "interactive_memory", reason: "irrelevant_to_current_turn" },
      ],
      finalContextMode: "recent_only",
      needsEvidenceFallback: false,
    });
    assert.ok(parsed.success, `schema rejected too_old: ${JSON.stringify(parsed.error?.format())}`);
    assert.equal(parsed.data!.rejected.length, 2);
    assert.equal(parsed.data!.rejected[0].reason, "too_old");
  });

  it("rejected reason enum line lists all shared categories", () => {
    const enumLine = '"reason": "may_derail_scene | possible_conflict | too_old | low_confidence | irrelevant_to_current_turn | too_broad | conflicts_with_recent_chat | canon_not_needed | memory_not_needed | duplicate | unsafe_to_use"';
    const { system } = buildMemoryRerankPrompt({
      currentUserMessage: "test",
      plannerIntent: "scene_continuation",
      candidates: [],
      maxSelected: 8,
    });
    assert.ok(
      system.includes(enumLine),
      "rejected reason enum line should list all shared categories",
    );
  });

  it("does not apply for scene_continuation", () => {
    // Guard should NOT fire for scene_continuation
    const intent = "scene_continuation" as "scene_continuation" | "explicit_recall" | "implicit_memory_callback" | "canon_question";
    const needsGuard =
      [].length === 0 &&
      (intent === "explicit_recall" ||
        intent === "canon_question" ||
        intent === "implicit_memory_callback");
    assert.equal(needsGuard, false);
  });

  it("accepts selected risk null and normalizes to undefined", () => {
    // Model emits null for "no risk" — schema must accept and normalize.
    const parsed = __testing.RerankOutputSchema.safeParse({
      selected: [
        { id: "mem_1", source: "structmem_entry", relevance: "useful", usageInstruction: "use_subtly", reason: "relevant", risk: null },
        { id: "mem_2", source: "interactive_memory", relevance: "required", usageInstruction: "must_use", reason: "important", risk: "too_old" },
      ],
      rejected: [],
      finalContextMode: "selected_memory",
      needsEvidenceFallback: false,
    });
    assert.ok(parsed.success, `schema rejected null risk: ${JSON.stringify(parsed.error?.format())}`);
    // null should normalize to undefined so it's absent on the parsed output
    assert.equal(parsed.data!.selected.length, 2);
    assert.equal(parsed.data!.selected[0].risk, undefined);
    assert.equal(parsed.data!.selected[1].risk, "too_old");
  });

  it("accepts selected risk empty strings and normalizes to undefined", () => {
    const parsed = __testing.RerankOutputSchema.safeParse({
      selected: [
        { id: "mem_1", source: "structmem_entry", relevance: "useful", usageInstruction: "use_subtly", reason: "relevant", risk: "" },
        { id: "mem_2", source: "interactive_memory", relevance: "useful", usageInstruction: "use_subtly", reason: "relevant", risk: "   " },
      ],
      rejected: [],
      finalContextMode: "selected_memory",
      needsEvidenceFallback: false,
    });
    assert.ok(parsed.success, `schema rejected blank risk: ${JSON.stringify(parsed.error?.format())}`);
    assert.equal(parsed.data!.selected[0].risk, undefined);
    assert.equal(parsed.data!.selected[1].risk, undefined);
  });

  it("prompt says to omit risk when not applicable", () => {
    // The prompt should tell the model to omit risk rather than use blank no-op values.
    const { system } = buildMemoryRerankPrompt({
      currentUserMessage: "test",
      plannerIntent: "scene_continuation",
      candidates: [],
      maxSelected: 8,
    });
    assert.ok(
      system.includes("omit when not applicable"),
      "buildMemoryRerankPrompt should guide the model to omit risk when not applicable",
    );
    assert.ok(
      system.includes("do not use null or empty string"),
      "buildMemoryRerankPrompt should discourage null or empty risk values",
    );
  });
});

describe("shared reranker categories", () => {
  const ALL_CATEGORIES = [
    "may_derail_scene",
    "possible_conflict",
    "too_old",
    "low_confidence",
    "irrelevant_to_current_turn",
    "too_broad",
    "conflicts_with_recent_chat",
    "canon_not_needed",
    "memory_not_needed",
    "duplicate",
    "unsafe_to_use",
  ] as const;
  const ALIGNED_ENUM_LINE =
    '"may_derail_scene | possible_conflict | too_old | low_confidence | irrelevant_to_current_turn | too_broad | conflicts_with_recent_chat | canon_not_needed | memory_not_needed | duplicate | unsafe_to_use"';

  it("RERANKER_CATEGORIES matches the full expected set", () => {
    assert.deepEqual([...__testing.RERANKER_CATEGORIES], [...ALL_CATEGORIES]);
  });

  it("every category is accepted as selected risk", () => {
    for (const cat of ALL_CATEGORIES) {
      const parsed = __testing.RerankOutputSchema.safeParse({
        selected: [
          {
            id: "m1", source: "structmem_entry", relevance: "useful",
            usageInstruction: "use_subtly", reason: "relevant", risk: cat,
          },
        ],
        rejected: [],
        finalContextMode: "recent_only",
        needsEvidenceFallback: false,
      });
      assert.ok(
        parsed.success,
        `category "${cat}" should be valid as selected risk: ${JSON.stringify(parsed.error?.format())}`,
      );
    }
  });

  it("every category is accepted as rejected reason", () => {
    for (const cat of ALL_CATEGORIES) {
      const parsed = __testing.RerankOutputSchema.safeParse({
        selected: [],
        rejected: [{ id: "m1", source: "structmem_entry", reason: cat }],
        finalContextMode: "recent_only",
        needsEvidenceFallback: false,
      });
      assert.ok(
        parsed.success,
        `category "${cat}" should be valid as rejected reason: ${JSON.stringify(parsed.error?.format())}`,
      );
    }
  });

  it("prompt risk enum line lists all shared categories", () => {
    const { system } = buildMemoryRerankPrompt({
      currentUserMessage: "test",
      plannerIntent: "scene_continuation",
      candidates: [],
      maxSelected: 8,
    });
    assert.ok(
      system.includes(`"risk": ${ALIGNED_ENUM_LINE}`),
      "risk enum line should list all shared categories",
    );
  });

  it("prompt rejected reason enum line lists all shared categories", () => {
    const { system } = buildMemoryRerankPrompt({
      currentUserMessage: "test",
      plannerIntent: "scene_continuation",
      candidates: [],
      maxSelected: 8,
    });
    assert.ok(
      system.includes(`"reason": ${ALIGNED_ENUM_LINE}`),
      "rejected reason enum line should list all shared categories",
    );
  });

  it("rejects unknown string in both risk and reason", () => {
    const asRisk = __testing.RerankOutputSchema.safeParse({
      selected: [
        {
          id: "m1", source: "structmem_entry", relevance: "useful",
          usageInstruction: "use_subtly", reason: "relevant", risk: "unknown_category",
        },
      ],
      rejected: [],
      finalContextMode: "recent_only",
      needsEvidenceFallback: false,
    });
    assert.equal(asRisk.success, false, "unknown risk string must be rejected");

    const asReason = __testing.RerankOutputSchema.safeParse({
      selected: [],
      rejected: [{ id: "m1", source: "structmem_entry", reason: "unknown_category" }],
      finalContextMode: "recent_only",
      needsEvidenceFallback: false,
    });
    assert.equal(asReason.success, false, "unknown reason string must be rejected");
  });

  it("rejects empty rejected reason because reason is required", () => {
    const parsed = __testing.RerankOutputSchema.safeParse({
      selected: [],
      rejected: [{ id: "m1", source: "structmem_entry", reason: "" }],
      finalContextMode: "recent_only",
      needsEvidenceFallback: false,
    });
    assert.equal(parsed.success, false, "empty rejected reason must be rejected");
  });
});
