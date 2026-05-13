import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  ExtractorOutputSchema,
  normalizeExtractorMemoryScope,
} from "./extractPostTurnSignals";

describe("extractPostTurnSignals schema", () => {
  it("parses minimal payload with default structmem_entries", () => {
    const r = ExtractorOutputSchema.safeParse({
      memory_candidates: [],
      confidence: 0.5,
    });
    assert.equal(r.success, true);
    if (r.success) {
      assert.deepEqual(r.data.structmem_entries, []);
    }
  });

  it("accepts up to 6 structmem_entries", () => {
    const entries = Array.from({ length: 6 }, (_, i) => ({
      entry_type: "factual" as const,
      text: `line ${i}`,
      memory_scope: "current_session" as const,
    }));
    const r = ExtractorOutputSchema.safeParse({
      memory_candidates: [],
      structmem_entries: entries,
      confidence: 1,
    });
    assert.equal(r.success, true);
  });

  it("rejects more than 6 structmem_entries", () => {
    const entries = Array.from({ length: 7 }, (_, i) => ({
      entry_type: "factual" as const,
      text: `line ${i}`,
      memory_scope: "current_session" as const,
    }));
    const r = ExtractorOutputSchema.safeParse({
      memory_candidates: [],
      structmem_entries: entries,
      confidence: 1,
    });
    assert.equal(r.success, false);
  });

  it("rejects invalid entry_type", () => {
    const r = ExtractorOutputSchema.safeParse({
      memory_candidates: [],
      structmem_entries: [
        {
          entry_type: "not_a_type",
          text: "x",
          memory_scope: "current_session",
        },
      ],
      confidence: 1,
    });
    assert.equal(r.success, false);
  });

  it("parses cross_session structmem row (server filters before persist)", () => {
    const r = ExtractorOutputSchema.safeParse({
      memory_candidates: [],
      structmem_entries: [
        {
          entry_type: "relational",
          text: " durable hint ",
          memory_scope: "cross_session",
        },
      ],
      confidence: 0.8,
    });
    assert.equal(r.success, true);
    if (r.success) {
      assert.equal(r.data.structmem_entries[0]!.text, "durable hint");
    }
  });

  it("defaults omitted memory_scope to current_session", () => {
    assert.equal(normalizeExtractorMemoryScope(undefined), "current_session");
    assert.equal(
      normalizeExtractorMemoryScope("current_session"),
      "current_session",
    );
    assert.equal(normalizeExtractorMemoryScope("cross_session"), "cross_session");
  });
});
