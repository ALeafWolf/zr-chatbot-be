import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildNativeStructMemFallbackItems,
  ExtractorOutputSchema,
  normalizeExtractorMemoryScope,
  buildExtractorSystem,
} from "./extractPostTurnSignals";
import { env } from "../../config/env";

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

// ---------------------------------------------------------------------------
// TG8 — TurnEvent schema and prompt gating
// ---------------------------------------------------------------------------

describe("TurnEvent schema — TG8", () => {
  it("parses valid turn_event from extractor output", () => {
    const validInput = {
      memory_candidates: [],
      structmem_entries: [],
      confidence: 0.7,
      turn_event: {
        type: 'user_pursues_connection',
        intensity: 0.7,
        reason: 'User asked a personal question',
      },
    };
    const result = ExtractorOutputSchema.safeParse(validInput);
    assert.equal(result.success, true, "valid turn_event payload parses");
    // turn_event is unknown at top level, check the raw value
    const raw = result.data?.turn_event as Record<string, unknown> | undefined | null;
    assert.equal(raw?.type, 'user_pursues_connection', "event type passed through");
    assert.equal(raw?.intensity, 0.7, "event intensity passed through");
    assert.equal(raw?.reason, 'User asked a personal question', "event reason passed through");
  });

  it("F28: malformed turn_event does NOT reject the payload — memory/StructMem survive", () => {
    // Invalid type but valid memory candidates and structmem_entries
    const validInput = {
      memory_candidates: [
        { summary: "test memory", emotional_weight: 0.5, plot_relevance: 0.5, cross_session_durability: 0.3 },
      ],
      structmem_entries: [
        { entry_type: "factual", text: "test structmem", memory_scope: "current_session" },
      ],
      confidence: 0.5,
      turn_event: {
        type: 'not_a_valid_type',
        intensity: 1.5,
        reason: '',
      },
    };
    const result = ExtractorOutputSchema.safeParse(validInput);
    assert.equal(result.success, true, "malformed turn_event does NOT reject payload");
    assert.equal(result.data?.memory_candidates.length, 1, "memory_candidates survive");
    assert.equal(result.data?.structmem_entries.length, 1, "structmem_entries survive");
    // turn_event is still present as raw unknown data
    assert.ok(result.data?.turn_event !== undefined, "turn_event still present in parsed data");
  });

  it("F28: barely valid turn_event (edge case) still passes through", () => {
    // intensity = 0 is valid (min is 0)
    const validInput = {
      memory_candidates: [],
      structmem_entries: [],
      confidence: 0.5,
      turn_event: {
        type: 'routine_exchange',
        intensity: 0,
        reason: 'minimal',
      },
    };
    const result = ExtractorOutputSchema.safeParse(validInput);
    assert.equal(result.success, true, "edge case parses");
  });

  it("parses minimal payload without turn_event (optional field)", () => {
    const validInput = {
      memory_candidates: [],
      structmem_entries: [],
      confidence: 0.5,
    };
    const result = ExtractorOutputSchema.safeParse(validInput);
    assert.equal(result.success, true, "minimal payload parses without turn_event");
    assert.equal(result.data?.turn_event, undefined, "turn_event is absent from parsed data");
  });

  it("parses explicit null turn_event as null (optional nullable)", () => {
    const validInput = {
      memory_candidates: [],
      structmem_entries: [],
      confidence: 0.5,
      turn_event: null,
    };
    const result = ExtractorOutputSchema.safeParse(validInput);
    assert.equal(result.success, true, "null turn_event parses");
    assert.equal(result.data?.turn_event, null, "null turn_event stays null");
  });
});

// ---------------------------------------------------------------------------
// TG8 — extractor system prompt gating
// ---------------------------------------------------------------------------

describe("buildExtractorSystem — TG8 prompt gating", () => {
  it("F9: flag OFF ⇒ buildExtractorSystem prompt does NOT contain turn_event", () => {
    const saved = env.EMOTIONAL_ENGINE_ENABLED;
    try {
      (env as any).EMOTIONAL_ENGINE_ENABLED = false;
      const prompt = buildExtractorSystem();
      assert.ok(!prompt.includes("turn_event"), "flag-off prompt must not contain turn_event");
      assert.ok(!prompt.includes('"turn_event"'), "flag-off prompt must not contain turn_event JSON key");
    } finally {
      (env as any).EMOTIONAL_ENGINE_ENABLED = saved;
    }
  });

  it("F9: flag ON ⇒ buildExtractorSystem prompt includes turn_event with valid shape", () => {
    const saved = env.EMOTIONAL_ENGINE_ENABLED;
    try {
      (env as any).EMOTIONAL_ENGINE_ENABLED = true;
      const prompt = buildExtractorSystem();
      assert.ok(prompt.includes("turn_event"), "flag-on prompt must contain turn_event");
      assert.ok(prompt.includes("routine_exchange"), "flag-on prompt has event type enum");
      assert.ok(prompt.includes('"intensity": 0.0-1.0'), "flag-on prompt has intensity range");
      assert.ok(prompt.includes('"reason"'), "flag-on prompt has reason field");
    } finally {
      (env as any).EMOTIONAL_ENGINE_ENABLED = saved;
    }
  });
});
