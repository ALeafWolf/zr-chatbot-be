import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildNativeStructMemFallbackItems,
  ExtractorOutputSchema,
  normalizeExtractorMemoryScope,
} from "./extractPostTurnSignals";

describe("extractPostTurnSignals schema", () => {
  it("ExtractorOutputSchema parses/rejects payloads with structmem and memory_candidate rules", () => {
    const entries = (n: number) =>
      Array.from({ length: n }, (_, i) => ({
        entry_type: "factual" as const,
        text: `line ${i}`,
        memory_scope: "current_session" as const,
      }));

    type Parsed = ReturnType<typeof ExtractorOutputSchema.safeParse>;
    const cases: {
      name: string;
      input: unknown;
      success: boolean;
      check?: (r: Extract<Parsed, { success: true }>) => void;
    }[] = [
      {
        name: "minimal payload defaults structmem_entries to []",
        input: { memory_candidates: [], confidence: 0.5 },
        success: true,
        check: (r) => assert.deepEqual(r.data.structmem_entries, [], "minimal — default entries"),
      },
      {
        name: "accepts up to 6 structmem_entries",
        input: { memory_candidates: [], structmem_entries: entries(6), confidence: 1 },
        success: true,
      },
      {
        name: "rejects more than 6 structmem_entries",
        input: { memory_candidates: [], structmem_entries: entries(7), confidence: 1 },
        success: false,
      },
      {
        name: "rejects invalid entry_type",
        input: {
          memory_candidates: [],
          structmem_entries: [{ entry_type: "not_a_type", text: "x", memory_scope: "current_session" }],
          confidence: 1,
        },
        success: false,
      },
      {
        name: "defaults missing memory_type on memory_candidates",
        input: {
          memory_candidates: [
            { summary: "current-session beat", memory_scope: "current_session", session_chunk_type: "scene_moment" },
          ],
          confidence: 0.7,
        },
        success: true,
        check: (r) => assert.equal(r.data.memory_candidates[0]!.memory_type, "banter", "default memory_type"),
      },
      {
        name: "parses cross_session structmem row and trims text",
        input: {
          memory_candidates: [],
          structmem_entries: [{ entry_type: "relational", text: " durable hint ", memory_scope: "cross_session" }],
          confidence: 0.8,
        },
        success: true,
        check: (r) => assert.equal(r.data.structmem_entries[0]!.text, "durable hint", "cross_session — trimmed text"),
      },
    ];

    for (const c of cases) {
      const r = ExtractorOutputSchema.safeParse(c.input);
      assert.equal(r.success, c.success, `${c.name} — success`);
      if (r.success && c.check) c.check(r as Extract<Parsed, { success: true }>);
    }
  });

  it("normalizeExtractorMemoryScope defaults undefined to current_session and passes known scopes", () => {
    assert.equal(normalizeExtractorMemoryScope(undefined), "current_session", "undefined → current_session");
    assert.equal(normalizeExtractorMemoryScope("current_session"), "current_session", "current_session passthrough");
    assert.equal(normalizeExtractorMemoryScope("cross_session"), "cross_session", "cross_session passthrough");
  });

  it("buildNativeStructMemFallbackItems builds conservative rows only for meaningful turns", () => {
    const cases: {
      name: string;
      input: { userMessage: string; assistantReply: string };
      check: (rows: ReturnType<typeof buildNativeStructMemFallbackItems>) => void;
    }[] = [
      {
        name: "meaningful turn → factual + relational rows",
        input: {
          userMessage: "（我把面试通过的邮件递给你看）我真的拿到录用了，但刚才还在发抖。",
          assistantReply: "他握住你的手，确认你做到了，并说周六会陪你去未名湖边的音乐会。",
        },
        check: (rows) => {
          assert.equal(rows.length, 2, "meaningful — 2 rows");
          assert.equal(rows[0]!.entryType, "factual", "meaningful — factual");
          assert.equal(rows[1]!.entryType, "relational", "meaningful — relational");
        },
      },
      {
        name: "trivial greeting → no rows",
        input: { userMessage: "hi", assistantReply: "hello" },
        check: (rows) => assert.equal(rows.length, 0, "trivial — 0 rows"),
      },
    ];

    for (const c of cases) {
      c.check(buildNativeStructMemFallbackItems(c.input));
    }
  });
});
