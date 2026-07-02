import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseJsonOutput } from "../../llm/json/parseJsonOutput";
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

  it("prompt asks for compact output to reduce truncation risk", () => {
    const prompt = buildStructMemConsolidationPrompt({
      maxInputTokens: 200,
      bufferEntries: [
        {
          id: "b1", eventId: "e1", turnIndex: 0, entryType: "factual", text: "Something happened.",
        },
      ],
      semanticSeedEntries: [],
    });
    // Check the compactness guidance added by the hardening change. The prompt
    // is authored in Chinese, so match the localized guidance line
    // ("保持输出紧凑" = "keep output compact"), not the original English text.
    assert.match(prompt, /保持输出紧凑/);
  });

  it("rejects truncated raw JSON through parseJsonOutput path", () => {
    // Simulates the observed production failure: the model emits a JSON object
    // that starts but ends mid-value because the output cap was hit.
    // parseJsonOutput is the same extraction function used by chatJson(...)
    // when parsing the consolidation model's raw output.
    const truncated = '{"summary_text":"Several meaningful interactions occurred during this session. The user seemed particularly interested in';
    const result = parseJsonOutput(truncated);
    assert.equal(result.ok, false);
    assert.match(result.error, /No JSON object\/array found/);
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

  it("truncates cross-session distillation to the 3 most important items", () => {
    // Reproduces the production failure: the model returned more than 3
    // stable_items and the old .max(3) schema rejected the whole payload.
    const makeItem = (summary: string, importance: number) => ({
      category: "recurring_preference",
      summary_text: summary,
      confidence_score: 0.8,
      importance_score: importance,
      tags: [],
    });
    const parsed = StructMemCrossSessionDistillationOutputSchema.parse({
      stable_items: [
        makeItem("low", 0.4),
        makeItem("highest", 0.9),
        makeItem("mid", 0.6),
        makeItem("high", 0.8),
      ],
    });
    assert.equal(parsed.stable_items.length, 3);
    assert.deepEqual(
      parsed.stable_items.map((item) => item.summary_text),
      ["highest", "high", "mid"],
    );
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
