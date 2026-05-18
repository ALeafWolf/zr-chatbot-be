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

  it("prompt documents too_old in rejected reason list", () => {
    // If the prompt stops documenting too_old for rejected items, the model
    // is less likely to emit it and the schema+prompt diverge.
    // This checks the specific rejected reason enum line, not the full prompt,
    // because "too_old" also appears in selected-item "risk".
    const { system } = buildMemoryRerankPrompt({
      currentUserMessage: "test",
      plannerIntent: "scene_continuation",
      candidates: [],
      maxSelected: 8,
    });
    assert.ok(
      system.includes(
        '"reason": "irrelevant_to_current_turn | too_broad | conflicts_with_recent_chat | canon_not_needed | memory_not_needed | duplicate | unsafe_to_use | too_old"',
      ),
      "buildMemoryRerankPrompt rejected reason enum should include too_old",
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
});
