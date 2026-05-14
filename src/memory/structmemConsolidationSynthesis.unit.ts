import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildStructMemConsolidationPrompt,
  parseStructMemConsolidationOutput,
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
});
