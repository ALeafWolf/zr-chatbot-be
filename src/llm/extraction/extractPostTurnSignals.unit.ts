import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildNativeStructMemFallbackItems,
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

  it("defaults missing memory_type on memory_candidates", () => {
    const r = ExtractorOutputSchema.safeParse({
      memory_candidates: [
        {
          summary: "current-session beat",
          memory_scope: "current_session",
          session_chunk_type: "scene_moment",
        },
      ],
      confidence: 0.7,
    });
    assert.equal(r.success, true);
    if (r.success) {
      assert.equal(r.data.memory_candidates[0]!.memory_type, "banter");
    }
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

  it("builds conservative factual and relational fallback rows for meaningful turns", () => {
    const rows = buildNativeStructMemFallbackItems({
      userMessage:
        "（我把面试通过的邮件递给你看）我真的拿到录用了，但刚才还在发抖。",
      assistantReply:
        "他握住你的手，确认你做到了，并说周六会陪你去未名湖边的音乐会。",
    });
    assert.equal(rows.length, 2);
    assert.equal(rows[0]!.entryType, "factual");
    assert.equal(rows[1]!.entryType, "relational");
  });

  it("does not build fallback rows for trivial greetings", () => {
    const rows = buildNativeStructMemFallbackItems({
      userMessage: "hi",
      assistantReply: "hello",
    });
    assert.equal(rows.length, 0);
  });
});
