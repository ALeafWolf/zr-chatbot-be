import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildStructMemConsolidationPrompt,
  parseStructMemConsolidationOutput,
  StructMemCrossSessionDistillationOutputSchema,
  StructMemConsolidationOutputSchema,
} from "./structmemConsolidationSynthesis";

describe("structmemConsolidationSynthesis", () => {
  it("rejects malformed consolidation output", () => {
    assert.throws(() =>
      parseStructMemConsolidationOutput({
        summary_text: "",
        summary_json: {},
        confidence_score: 1.2,
      }),
    );
  });

  it("accepts valid consolidation output shape", () => {
    const parsed = StructMemConsolidationOutputSchema.parse({
      summary_text: "A compact synthesis.",
      summary_json: { theme: "continuity" },
      confidence_score: 0.8,
    });
    assert.equal(parsed.summary_text, "A compact synthesis.");
    assert.equal(parsed.confidence_score, 0.8);
  });

  it("builds a bounded prompt with buffer and semantic seed sections", () => {
    const prompt = buildStructMemConsolidationPrompt({
      maxInputTokens: 50,
      bufferEntries: [
        {
          id: "b1",
          eventId: "e1",
          turnIndex: 2,
          entryType: "factual",
          text: "A meaningful fact.",
        },
      ],
      semanticSeedEntries: [],
    });
    assert.match(prompt, /BUFFER ENTRIES/);
    assert.match(prompt, /SEMANTIC SEED ENTRIES/);
    assert.ok(prompt.length <= 1000);
  });

  it("accepts valid cross-session distillation output shape", () => {
    const parsed = StructMemCrossSessionDistillationOutputSchema.parse({
      stable_items: [
        {
          category: "recurring_preference",
          summary_text: "The user prefers quiet dinner plans after work.",
          confidence_score: 0.86,
          importance_score: 0.8,
          tags: ["preference"],
        },
      ],
    });
    assert.equal(parsed.stable_items[0]!.category, "recurring_preference");
  });

  it("rejects cross-session distillation categories outside the allowed set", () => {
    assert.throws(() =>
      StructMemCrossSessionDistillationOutputSchema.parse({
        stable_items: [
          {
            category: "free_text_category",
            summary_text: "unsupported",
            confidence_score: 0.9,
            importance_score: 0.9,
          },
        ],
      }),
    );
  });
});
