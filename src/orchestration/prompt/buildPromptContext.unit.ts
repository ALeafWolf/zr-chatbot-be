import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildPromptContext } from "./buildPromptContext";
import type { ChatSession } from "../../db/schema/chat";
import { buildPromptTracePayload } from "../../observability/tracePayloads";
import type { CharacterDefaults, PersonaOverlayDefaults } from "../../character/characterDefaults";
import type { QueryRewriteResult } from "../../retrieval/query/rewriteQuery";

const characterDefaults = {
  name: "Test Character",
  identity: "A test character.",
  hard_rules: ["Stay in character."],
  core_traits: ["careful"],
  narrative_prose_guidelines: "",
  speech_style: {
    language: "Chinese",
    formality: "formal",
    emotionality: "restrained",
    preferred_patterns: [],
    avoid: [],
  },
  in_character_expression: "",
  emotional_core: "",
  values: [],
  private_habits_and_texture: [],
  relationship_expression: { general: "" },
  interaction_defaults: {
    default_continuity_scope: "main",
    default_emotional_baseline: "calm",
    default_relationship_baseline: "neutral",
  },
} as unknown as CharacterDefaults;

const personaOverlay = {
  continuity_scope: "main",
  relationship_status: "confirmed_relationship",
  baseline_warmth: "medium",
  baseline_nsfw_openness: "none",
  max_nsfw_level: "none",
  escalation_rule: "none",
  out_of_scope_chapter_behavior: "deflect",
  overlay_identity: "",
} as unknown as PersonaOverlayDefaults;

const session = {
  sessionId: "s1",
  characterId: "c1",
  playerId: "p1",
  mode: "canonical_live",
  continuityScope: "main",
  continuityFamily: "main_world",
  personaOverlayId: null,
  memoryNamespace: "main",
  pinnedTime: null,
  pinnedLocation: null,
  writebackPolicy: "full_writeback",
  sessionSummary: null,
  displayTitle: null,
  thinking: true,
  temperature: 1,
  deletedAt: null,
  createdAt: new Date(),
  updatedAt: new Date(),
} satisfies ChatSession;

function baseInput() {
  return {
    characterDefaults,
    personaOverlay,
    session,
    derivedState: {
      inferredMood: "calm",
      inferredActivity: "in_conversation",
      conversationalStance: "attentive",
    },
    memories: [],
    canonChunks: [],
    recentTurns: [],
    userMessage: "hello",
  };
}

function structuredQueryRewrite(
  overrides: Partial<QueryRewriteResult> = {},
): QueryRewriteResult {
  return {
    segments: [{ lane: "user_speech", text: "你好" }],
    combined_for_embedding: "[user speech] 你好",
    entities: [],
    intent: "general",
    confidence: 0.9,
    structuralParseOk: true,
    labelOk: true,
    parseOk: true,
    ...overrides,
  };
}

describe("buildPromptContext open threads", () => {
  it("renders ACTIVE OPEN THREADS only when open threads exist", () => {
    const withoutThreads = buildPromptContext(baseInput());
    assert.equal(withoutThreads.systemPrompt.includes("[ACTIVE OPEN THREADS]"), false);

    const withThreads = buildPromptContext({
      ...baseInput(),
      openThreads: [
        {
          id: "t1",
          source: "session_summary",
          text: "answer the pending question",
          status: "open",
          sourceTurnIndex: 2,
          score: 0.9,
        },
      ],
    });
    assert.equal(withThreads.systemPrompt.includes("[ACTIVE OPEN THREADS]"), true);
    assert.equal(withThreads.systemPrompt.includes("answer the pending question"), true);
  });
});

describe("buildPromptContext latest turn delta", () => {
  it("renders latest turn delta when present", () => {
    const prompt = buildPromptContext({
      ...baseInput(),
      latestTurnDelta: {
        kind: "latest_turn_delta",
        sourceTurnStart: 2,
        sourceTurnEnd: 3,
        expiresAfterTurn: 7,
        facts: ["the user asked to resume the scene"],
        pendingActions: [],
        relationshipSignals: [],
      },
    }).systemPrompt;

    assert.equal(prompt.includes("[LATEST TURN DELTA]"), true);
    assert.equal(prompt.includes("the user asked to resume the scene"), true);
  });
});

describe("buildPromptContext memory corrections", () => {
  it("renders MEMORY CORRECTIONS before latest turn delta", () => {
    const prompt = buildPromptContext({
      ...baseInput(),
      memoryCorrections: [
        {
          oldClaim: "the meeting is tomorrow",
          correctedClaim: "the meeting is Friday",
          sourceTurnIndex: 6,
        },
      ],
      latestTurnDelta: {
        kind: "latest_turn_delta",
        sourceTurnStart: 7,
        sourceTurnEnd: 8,
        expiresAfterTurn: 10,
        facts: ["latest fact"],
        pendingActions: [],
        relationshipSignals: [],
      },
    }).systemPrompt;

    assert.equal(prompt.includes("[MEMORY CORRECTIONS]"), true);
    assert.ok(
      prompt.indexOf("[MEMORY CORRECTIONS]") <
        prompt.indexOf("[LATEST TURN DELTA]"),
    );
  });
});

describe("buildPromptContext StructMem expansions", () => {
  it("passes StructMem entry context expansions into the event memory block", () => {
    const prompt = buildPromptContext({
      ...baseInput(),
      structMemEntries: [
        {
          id: "entry-1",
          eventId: "event-1",
          turnIndex: 2,
          entryType: "decision",
          text: "They agreed to revisit the question.",
          importanceScore: 0.9,
          confidenceScore: 0.9,
          cosineSimilarity: 0.9,
          finalScore: 0.9,
        },
      ],
      structMemEntryContextExpansions: [
        {
          entryId: "entry-1",
          eventId: "event-1",
          messages: [
            { turnIndex: 1, role: "user", content: "Later?" },
            { turnIndex: 2, role: "assistant", content: "Later." },
          ],
        },
      ],
    }).systemPrompt;

    assert.equal(prompt.includes("Context:"), true);
    assert.equal(prompt.includes("turn 1 user: Later?"), true);
  });
});

describe("buildPromptContext honors reranker-empty selection", () => {
  it("omits SESSION SUMMARY when sessionSummary is null", () => {
    const prompt = buildPromptContext({
      ...baseInput(),
      sessionSummary: null,
    }).systemPrompt;
    assert.equal(prompt.includes("[SESSION SUMMARY]"), false);
  });

  it("omits MEMORY CORRECTIONS when memoryCorrections is empty", () => {
    const prompt = buildPromptContext({
      ...baseInput(),
      memoryCorrections: [],
    }).systemPrompt;
    assert.equal(prompt.includes("[MEMORY CORRECTIONS]"), false);
  });

  it("omits LATEST TURN DELTA when latestTurnDelta is null", () => {
    const prompt = buildPromptContext({
      ...baseInput(),
      latestTurnDelta: null,
    }).systemPrompt;
    assert.equal(prompt.includes("[LATEST TURN DELTA]"), false);
  });

  it("omits all candidate-backed blocks when reranker selected is empty and filtered sources are null/empty", () => {
    // Simulates the state after resolveContext filters sources based on empty reranker selection
    const prompt = buildPromptContext({
      ...baseInput(),
      sessionSummary: null,
      latestTurnDelta: null,
      memoryCorrections: [],
      openThreads: [],
      memories: [],
      sessionRecall: [],
      structMemEntries: [],
      structMemConsolidations: [],
      memoryRerank: {
        selected: [],
        rejected: [
          { id: "session_summary", source: "session_summary", reasonCode: "irrelevant" },
          { id: "latest_turn_delta", source: "latest_turn_delta", reasonCode: "irrelevant" },
        ],
        finalContextMode: "recent_only",
        needsEvidenceFallback: false,
      },
    }).systemPrompt;

    assert.equal(prompt.includes("[SESSION SUMMARY]"), false, "SESSION SUMMARY should be absent");
    assert.equal(prompt.includes("[MEMORY CORRECTIONS]"), false, "MEMORY CORRECTIONS should be absent");
    assert.equal(prompt.includes("[LATEST TURN DELTA]"), false, "LATEST TURN DELTA should be absent");
    assert.equal(prompt.includes("[ACTIVE OPEN THREADS]"), false, "ACTIVE OPEN THREADS should be absent");
    assert.equal(prompt.includes("[RELEVANT SESSION RECALL]"), false, "RELEVANT SESSION RECALL should be absent");
    assert.equal(prompt.includes("[STRUCTURED EVENT MEMORY]"), false, "STRUCTURED EVENT MEMORY should be absent");
    assert.equal(prompt.includes("[STRUCTURED MEMORY SYNTHESIS]"), false, "STRUCTURED MEMORY SYNTHESIS should be absent");
    assert.equal(prompt.includes("[INTERACTIVE MEMORY]"), false, "INTERACTIVE MEMORY should be absent");
    assert.equal(prompt.includes("[CANON NARRATIVE]"), false, "CANON NARRATIVE should be absent when no canon chunks exist");
  });

  it("with one selected session_chunk and all other sources filtered out by reranker, renders only the selected block among candidate-backed sources", () => {
    // Regression: a trace showed llm.memory_rerank selected only one session_chunk,
    // but generation still received rejected memory blocks. After fix, resolveContext
    // filters all sources based on reranker selection; buildPromptContext receives
    // only the filtered data. This test verifies the post-filter output is correct.
    const prompt = buildPromptContext({
      ...baseInput(),
      sessionSummary: null,
      latestTurnDelta: null,
      memoryCorrections: [],
      openThreads: [],
      memories: [],
      structMemEntries: [],
      structMemConsolidations: [],
      // Non-empty canon retrieved but no canon selected by reranker;
      // resolveContext filters it out before passing to buildPromptContext.
      canonChunks: [
        {
          id: "canon_unused",
          textContent: "lakeside canon scene that should not appear",
          contentType: "narrative",
          speaker: null,
          canonPriority: null,
          rankScore: 0,
          arcKey: "main",
          chapterName: "",
          sceneId: "scene_99",
        },
      ],
      sessionRecall: [
        {
          id: "c7375a00-77db-4e40-a413-6cd046f374c6",
          chunkText: "user seemed interested in resuming the scene at the lakeside",
          turnStart: 10,
          turnEnd: 12,
          finalScore: 0.91,
          cosineSimilarity: 0.85,
          chunkType: "scene",
        },
      ],
      memoryRerank: {
        selected: [
          { id: "c7375a00-77db-4e40-a413-6cd046f374c6", source: "session_chunk", relevance: "useful", usageInstruction: "use_subtly", reasonCode: "direct_continuity" },
        ],
        rejected: [
          { id: "session_summary", source: "session_summary", reasonCode: "irrelevant" },
          { id: "latest_turn_delta", source: "latest_turn_delta", reasonCode: "irrelevant" },
        ],
        finalContextMode: "selected_memory",
        needsEvidenceFallback: false,
      },
    }).systemPrompt;

    // Selected block should appear
    assert.equal(prompt.includes("[RELEVANT SESSION RECALL]"), true, "selected session recall should appear");
    assert.equal(prompt.includes("[SELECTED CONTEXT USAGE]"), false, "SELECTED CONTEXT USAGE should be removed from generation prompt");
    assert.equal(prompt.includes("lakeside"), true, "selected chunk text should be in prompt");

    // Unselected canon content must not leak through
    assert.equal(prompt.includes("lakeside canon scene that should not appear"), false, "unselected canon content should be absent");

    // Non-selected candidate-backed blocks should all be absent.
    // CANON NARRATIVE is omitted when no canon chunks/scenes exist after filtering.
    assert.equal(prompt.includes("[SESSION SUMMARY]"), false, "SESSION SUMMARY should be absent (rejected by reranker)");
    assert.equal(prompt.includes("[MEMORY CORRECTIONS]"), false, "MEMORY CORRECTIONS should be absent (rejected by reranker)");
    assert.equal(prompt.includes("[LATEST TURN DELTA]"), false, "LATEST TURN DELTA should be absent (rejected by reranker)");
    assert.equal(prompt.includes("[ACTIVE OPEN THREADS]"), false, "ACTIVE OPEN THREADS should be absent (rejected or not selected)");
    assert.equal(prompt.includes("[STRUCTURED EVENT MEMORY]"), false, "STRUCTURED EVENT MEMORY should be absent (not selected)");
    assert.equal(prompt.includes("[STRUCTURED MEMORY SYNTHESIS]"), false, "STRUCTURED MEMORY SYNTHESIS should be absent (not selected)");
    assert.equal(prompt.includes("[INTERACTIVE MEMORY]"), false, "INTERACTIVE MEMORY should be absent (not selected)");
    assert.equal(prompt.includes("[CANON NARRATIVE]"), false, "CANON NARRATIVE should be absent when no canon content exists after filtering");
  });

  it("renders selected canon chunks when memoryRerank selects specific canon", () => {
    // rerankContext.filterCanonBySelection() already filters chunks before
    // they reach buildPromptContext. Only already-filtered chunks are passed in.
    const prompt = buildPromptContext({
      ...baseInput(),
      canonChunks: [
        {
          id: "scene_1_0",
          textContent: "selected canon text that must appear",
          contentType: "narrative",
          speaker: null,
          canonPriority: null,
          rankScore: 0.9,
          sceneId: "scene_1",
        },
      ],
      memoryRerank: {
        selected: [
          { id: "scene_1_0", source: "canon_chunk", relevance: "useful", usageInstruction: "use_subtly", reasonCode: "canon_required" },
        ],
        rejected: [],
        finalContextMode: "memory_and_canon",
        needsEvidenceFallback: false,
      },
    }).systemPrompt;

    assert.equal(prompt.includes("selected canon text that must appear"), true, "selected canon chunk text should render");
    assert.equal(prompt.includes("[CANON NARRATIVE]"), true, "CANON NARRATIVE block should be present");
  });

  it("renders selected canon_fact in [CANON NARRATIVE] when memoryRerank selects a fact", () => {
    // The selected fact has original index 2 (non-zero) to prove index preservation.
    const prompt = buildPromptContext({
      ...baseInput(),
      canonChunks: [],
      canonScenes: [
        {
          sceneId: "scene_1",
          arcKey: "a",
          chapterId: "ch1",
          episodeId: "ep1",
          chapterName: "第一章",
          episodeLabel: "第一幕",
          episodeSummary: null,
          episodeOpeningUnits: [],
          sceneTitle: "湖畔",
          sceneSummary: "两人在湖边散步。",
          units: [
            { unitIndex: 0, speaker: "A", contentType: "narrative", textContent: "A walks by the lake." },
          ],
          // After filterCanonBySelection, only selected facts remain.
          // originalFactIndex is present at runtime (from filterCanonBySelection).
          // originalFactIndex is a runtime augmentation from filterCanonBySelection,
          // not part of the production fact type — cast to add it for the test.
          facts: [
            { subject: "E", predicate: "loves", object: "F", textForm: "E loves F.", originalFactIndex: 2 } as any,
          ],
          rankScore: 0.9,
          provenance: { fromSummary: null, fromFact: null, fromUnit: null, fromLex: null },
        },
      ],
      memoryRerank: {
        selected: [
          { id: "fact_scene_1_2", source: "canon_fact", relevance: "required", usageInstruction: "must_use", reasonCode: "canon_required" },
        ],
        rejected: [],
        finalContextMode: "memory_and_canon",
        needsEvidenceFallback: false,
      },
    }).systemPrompt;

    assert.equal(prompt.includes("[CANON NARRATIVE]"), true, "CANON NARRATIVE block should be present");
    assert.equal(prompt.includes("- E loves F"), true, "selected fact content should render in canon narrative");
    assert.equal(prompt.includes("湖畔"), true, "scene title should render for the fact-parent scene");
  });

  it("clears canon when memoryRerank selected exists but contains no canon sources (safety)", () => {
    const prompt = buildPromptContext({
      ...baseInput(),
      canonChunks: [
        {
          id: "canon_unused",
          textContent: "should not appear",
          contentType: "narrative",
          speaker: null,
          canonPriority: null,
          rankScore: 0.5,
          arcKey: "a",
          chapterName: "Ch1",
          sceneId: "scene_1",
        },
      ],
      memoryRerank: {
        selected: [
          { id: "mem_1", source: "interactive_memory", relevance: "useful", usageInstruction: "use_subtly", reasonCode: "direct_continuity" },
        ],
        rejected: [],
        finalContextMode: "selected_memory",
        needsEvidenceFallback: false,
      },
    }).systemPrompt;

    assert.equal(prompt.includes("[CANON NARRATIVE]"), false, "CANON NARRATIVE should be absent when reranker selected no canon");
    assert.equal(prompt.includes("should not appear"), false, "unselected canon content should not leak through");
  });

  it("already-filtered selected fact scenes survive prompt formatting", () => {
    // rerankContext.filterCanonBySelection() already filtered scenes before
    // they reach buildPromptContext. All remaining facts are selected and
    // should render. This test proves the simplified trust-based approach.
    const prompt = buildPromptContext({
      ...baseInput(),
      canonChunks: [],
      canonScenes: [
        {
          sceneId: "scene_1",
          arcKey: "a",
          chapterId: "ch1",
          episodeId: "ep1",
          chapterName: "第一章",
          episodeLabel: "第一幕",
          episodeSummary: null,
          episodeOpeningUnits: [],
          sceneTitle: "湖畔",
          sceneSummary: "两人在湖边散步。",
          units: [
            { unitIndex: 0, speaker: "A", contentType: "narrative", textContent: "A walks by the lake." },
          ],
          // Already-filtered scene — all facts that remain are selected.
          // originalFactIndex is present from filterCanonBySelection.
          facts: [
            { subject: "Selected", predicate: "is", object: "Kept", textForm: "Selected is Kept.", originalFactIndex: 2 } as any,
          ],
          rankScore: 0.9,
          provenance: { fromSummary: null, fromFact: null, fromUnit: null, fromLex: null },
        },
      ],
      memoryRerank: {
        selected: [
          { id: "fact_scene_1_2", source: "canon_fact", relevance: "required", usageInstruction: "must_use", reasonCode: "canon_required" },
        ],
        rejected: [],
        finalContextMode: "memory_and_canon",
        needsEvidenceFallback: false,
      },
    }).systemPrompt;

    assert.equal(prompt.includes("[CANON NARRATIVE]"), true, "CANON NARRATIVE should be present");
    assert.equal(prompt.includes("Selected is Kept"), true, "selected fact content should render in canon narrative");
    assert.equal(prompt.includes("湖畔"), true, "scene title should render for the fact-parent scene");
  });

  it("chunk-only selected canon does not re-expand full scenes", () => {
    // When reranker selected only a canon_chunk (no canon_fact), scenes are
    // cleared by filterCanonBySelection before reaching buildPromptContext.
    // buildPromptContext receives only canonChunks, never raw scenes for
    // chunk-only selections, proving no re-expansion occurs.
    const prompt = buildPromptContext({
      ...baseInput(),
      canonChunks: [
        { id: "chunk_1", textContent: "Selected chunk content.", sceneId: "s1", canonPriority: 1, contentType: "narrative", speaker: null, rankScore: 0.9 },
      ],
      canonScenes: [],
      memoryRerank: {
        selected: [
          { id: "chunk_1", source: "canon_chunk", relevance: "useful", usageInstruction: "use_subtly", reasonCode: "canon_required" },
        ],
        rejected: [],
        finalContextMode: "selected_canon",
        needsEvidenceFallback: false,
      },
    }).systemPrompt;

    assert.equal(prompt.includes("[CANON NARRATIVE]"), true, "CANON NARRATIVE should be present for chunk-only selection");
    assert.equal(prompt.includes("Selected chunk content"), true, "selected chunk should render via formatCanon");
    // No scenes passed in — no re-expansion into full scene context
    assert.equal(prompt.includes("湖畔"), false, "no scene content should appear for chunk-only selection");
  });

  it("preserves PromptContext.selectedMemorySources from non-empty rerank selection", () => {
    const ctx = buildPromptContext({
      ...baseInput(),
      memoryRerank: {
        selected: [
          { id: "mem_1", source: "interactive_memory", relevance: "useful", usageInstruction: "use_subtly", reasonCode: "direct_continuity" },
        ],
        rejected: [],
        finalContextMode: "selected_memory",
        needsEvidenceFallback: false,
      },
    });
    assert.ok(ctx.selectedMemorySources, "selectedMemorySources should be present");
    assert.equal(ctx.selectedMemorySources?.length, 1, "should have one selected memory source");
    assert.equal(ctx.selectedMemorySources?.[0]?.source, "interactive_memory");
  });
});

describe("buildPromptContext structured query label rules", () => {
  const labelRulesBlockHeader =
    "[STRUCTURED USER QUERY LABEL RULES]\n[STRUCTURED USER QUERY] 内部的各类标签并不等同";

  it("renders STRUCTURED USER QUERY LABEL RULES before STRUCTURED USER QUERY when structured query is shown", () => {
    const queryRewrite = structuredQueryRewrite();
    const prompt = buildPromptContext({
      ...baseInput(),
      queryRewrite,
    }).systemPrompt;

    const labelRulesIdx = prompt.indexOf(labelRulesBlockHeader);
    const structuredIdx = prompt.indexOf(
      `[STRUCTURED USER QUERY]\n${queryRewrite.combined_for_embedding}`,
    );
    assert.ok(labelRulesIdx >= 0, "LABEL RULES block should be present");
    assert.ok(structuredIdx >= 0, "STRUCTURED USER QUERY block should be present");
    assert.ok(
      labelRulesIdx < structuredIdx,
      "LABEL RULES should appear before STRUCTURED USER QUERY",
    );
  });

  it("omits STRUCTURED USER QUERY LABEL RULES when no structured query is shown", () => {
    const withoutRewrite = buildPromptContext(baseInput()).systemPrompt;
    assert.equal(withoutRewrite.includes(labelRulesBlockHeader), false);

    const parseFailed = buildPromptContext({
      ...baseInput(),
      queryRewrite: structuredQueryRewrite({ parseOk: false }),
    }).systemPrompt;
    assert.equal(parseFailed.includes(labelRulesBlockHeader), false);
  });

  it("includes [reply direction suggestion] prohibition in LABEL RULES", () => {
    const prompt = buildPromptContext({
      ...baseInput(),
      queryRewrite: structuredQueryRewrite(),
    }).systemPrompt;

    assert.ok(prompt.includes("[reply direction suggestion]"));
    assert.ok(
      prompt.includes(
        "角色绝不能推断 [reply direction suggestion] 是由 <user> 说出、发送、输入、知晓、意图表达或主动透露的内容",
      ),
    );
  });

  it("top [SYSTEM] block points to STRUCTURED USER QUERY LABEL RULES", () => {
    const prompt = buildPromptContext({
      ...baseInput(),
      queryRewrite: structuredQueryRewrite(),
    }).systemPrompt;

    const systemIdx = prompt.indexOf("[SYSTEM]");
    const labelRulesRefIdx = prompt.indexOf("[STRUCTURED USER QUERY LABEL RULES]");
    assert.ok(systemIdx >= 0);
    assert.ok(labelRulesRefIdx > systemIdx);
    assert.ok(
      prompt.includes(
        "并必须遵守 `[STRUCTURED USER QUERY LABEL RULES]`",
      ),
    );
  });

  // -------------------------------------------------------------------------
  // CHARACTER INTERNAL LOGIC block
  // -------------------------------------------------------------------------

  it("CHARACTER INTERNAL LOGIC block renders when internal_logic is provided", () => {
    const input = baseInput();
    input.characterDefaults = {
      ...input.characterDefaults,
      internal_logic: {
        core_belief: "真正的在意必须通过可靠的行动来证明。",
        core_motivation: "以可靠的方式守护所珍视的人。",
        core_fear: "辜负他人，造成无法弥补的后果。",
        defense_mechanism: "当他感到压力时会先沉默或转移话题。",
        transition_rule: "克制 → 停顿 → 回避 → 被追问 → 松动。",
        growth_environment: "在严格的环境中成长，习惯以克制应对压力。",
      },
    } as unknown as CharacterDefaults;

    const prompt = buildPromptContext(input).systemPrompt;
    assert.ok(
      prompt.includes("[CHARACTER INTERNAL LOGIC]"),
      "block should render when internal_logic is provided",
    );
  });

  it("CHARACTER INTERNAL LOGIC block is omitted when internal_logic is undefined", () => {
    const input = baseInput();
    // Ensure no internal_logic field
    const defaults = { ...input.characterDefaults };
    delete (defaults as any).internal_logic;
    input.characterDefaults = defaults as unknown as CharacterDefaults;

    const prompt = buildPromptContext(input).systemPrompt;
    assert.ok(
      !prompt.includes("[CHARACTER INTERNAL LOGIC]"),
      "block should be absent when internal_logic is undefined",
    );
  });

  it("CHARACTER INTERNAL LOGIC block is omitted when all internal_logic fields are empty", () => {
    const input = baseInput();
    input.characterDefaults = {
      ...input.characterDefaults,
      internal_logic: {
        growth_environment: "",
        core_belief: "",
        core_motivation: "",
        core_fear: "",
        defense_mechanism: "",
        transition_rule: "",
      },
    } as unknown as CharacterDefaults;

    const prompt = buildPromptContext(input).systemPrompt;
    assert.ok(
      !prompt.includes("[CHARACTER INTERNAL LOGIC]"),
      "block should be absent when all fields are empty",
    );
  });

  it("block ordering: CHARACTER INTERNAL LOGIC < BASE PERSONA < CONTINUITY OVERLAY", () => {
    const input = baseInput();
    input.characterDefaults = {
      ...input.characterDefaults,
      internal_logic: {
        core_belief: "真正的在意必须通过可靠的行动来证明。",
      },
    } as unknown as CharacterDefaults;

    const prompt = buildPromptContext(input).systemPrompt;
    const internalLogicIdx = prompt.indexOf("[CHARACTER INTERNAL LOGIC]");
    const basePersonaIdx = prompt.indexOf("[BASE PERSONA]");
    const continuityIdx = prompt.indexOf("[CONTINUITY OVERLAY]");

    assert.ok(internalLogicIdx >= 0, "[CHARACTER INTERNAL LOGIC] should exist");
    assert.ok(basePersonaIdx >= 0, "[BASE PERSONA] should exist");
    assert.ok(continuityIdx >= 0, "[CONTINUITY OVERLAY] should exist");
    assert.ok(
      internalLogicIdx < basePersonaIdx,
      "[CHARACTER INTERNAL LOGIC] should come before [BASE PERSONA]",
    );
    assert.ok(
      basePersonaIdx < continuityIdx,
      "[BASE PERSONA] should come before [CONTINUITY OVERLAY]",
    );
  });

  it("trace payload records CHARACTER INTERNAL LOGIC block presence when injected", () => {
    const input = baseInput();
    input.characterDefaults = {
      ...input.characterDefaults,
      internal_logic: { core_belief: "真正的在意必须通过可靠的行动来证明。" },
    } as unknown as CharacterDefaults;

    const { systemPrompt } = buildPromptContext(input);
    const payload = buildPromptTracePayload({
      systemPrompt,
      conversationHistory: [],
    });

    assert.strictEqual(
      payload.blockPresence["CHARACTER INTERNAL LOGIC"],
      true,
      "trace payload should record CHARACTER INTERNAL LOGIC as present",
    );
  });

  // -------------------------------------------------------------------------
  // STYLE SALIENCE REMINDER block
  // -------------------------------------------------------------------------

  it("STYLE SALIENCE REMINDER appears after CANON NARRATIVE when canon renders", () => {
    const input = baseInput();
    input.canonChunks = [{ id: "c1", textContent: "Some canon text.", sceneId: "s1", canonPriority: 1 }] as any;

    const prompt = buildPromptContext(input).systemPrompt;
    const canonIdx = prompt.indexOf("[CANON NARRATIVE]");
    const reminderIdx = prompt.indexOf("[STYLE SALIENCE REMINDER]");

    assert.ok(canonIdx >= 0, "[CANON NARRATIVE] should exist");
    assert.ok(reminderIdx >= 0, "[STYLE SALIENCE REMINDER] should exist when canon renders");
    assert.ok(
      canonIdx < reminderIdx,
      "[STYLE SALIENCE REMINDER] should appear after [CANON NARRATIVE]",
    );
  });

  it("TEMPORAL PREMISE HANDLING block appears between CANON NARRATIVE and STYLE SALIENCE REMINDER when canon renders", () => {
    const input = baseInput();
    input.canonChunks = [{ id: "c1", textContent: "Some canon text.", sceneId: "s1", canonPriority: 1 }] as any;

    const prompt = buildPromptContext(input).systemPrompt;
    const canonIdx = prompt.indexOf("[CANON NARRATIVE]");
    const temporalIdx = prompt.indexOf("[TEMPORAL PREMISE HANDLING]");
    const reminderIdx = prompt.indexOf("[STYLE SALIENCE REMINDER]");

    assert.ok(temporalIdx >= 0, "[TEMPORAL PREMISE HANDLING] should exist when canon renders");
    assert.ok(canonIdx < temporalIdx, "[TEMPORAL PREMISE HANDLING] should appear after [CANON NARRATIVE]");
    assert.ok(temporalIdx < reminderIdx, "[TEMPORAL PREMISE HANDLING] should appear before [STYLE SALIENCE REMINDER]");
  });

  it("TEMPORAL PREMISE HANDLING block is absent when no canon renders", () => {
    const prompt = buildPromptContext(baseInput()).systemPrompt;
    assert.equal(prompt.includes("[TEMPORAL PREMISE HANDLING]"), false);
  });

  it("STYLE SALIENCE REMINDER is absent when canon does not render", () => {
    const input = baseInput();
    input.canonChunks = [];

    const prompt = buildPromptContext(input).systemPrompt;
    assert.ok(
      !prompt.includes("[STYLE SALIENCE REMINDER]"),
      "style reminder should be absent when canon does not render",
    );
  });

  it("STYLE SALIENCE REMINDER body is ≤ 300 characters", () => {
    const input = baseInput();
    input.canonChunks = [{ id: "c1", textContent: "Some canon text.", sceneId: "s1", canonPriority: 1 }] as any;

    const prompt = buildPromptContext(input).systemPrompt;
    const match = prompt.match(/\[STYLE SALIENCE REMINDER\]\n([\s\S]*?)(?:\n\[|$)/);
    assert.ok(match, "should find STYLE SALIENCE REMINDER block body");
    const body = match[1].trim();
    assert.ok(
      body.length <= 300,
      `STYLE SALIENCE REMINDER body length ${body.length} should be ≤ 300`,
    );
  });

  // -------------------------------------------------------------------------
  // Anti-sycophancy correction instruction
  // -------------------------------------------------------------------------

  it("[纠正方式] appears in BASE PERSONA when canon_correction is set", () => {
    const input = baseInput();
    input.characterDefaults = {
      ...input.characterDefaults,
      canon_correction: "如果用户提出错误前提，角色会平静地纠正。",
    } as unknown as CharacterDefaults;

    const prompt = buildPromptContext(input).systemPrompt;
    assert.ok(
      prompt.includes("[纠正方式]"),
      "[纠正方式] should appear when canon_correction is set",
    );
    assert.ok(
      prompt.includes("如果用户提出错误前提"),
      "canon_correction body text should be present",
    );
  });

  it("[纠正方式] is absent when canon_correction is not set", () => {
    const prompt = buildPromptContext(baseInput()).systemPrompt;
    assert.ok(
      !prompt.includes("[纠正方式]"),
      "[纠正方式] should be absent when canon_correction is not set",
    );
  });

  it("no hedge-on-uncertainty instruction is present", () => {
    const prompt = buildPromptContext(baseInput()).systemPrompt;
    assert.ok(
      !prompt.includes("当你不确定"),
      "hedge-on-uncertainty instruction must NOT be present",
    );
  });

  // -------------------------------------------------------------------------
  // propagate-yaml-v2 TG2: core_traits, format_resistance, relationship_scope_gate
  // -------------------------------------------------------------------------

  it("[核心特征] is absent when core_traits is not set (TG2 Test A)", () => {
    const input = baseInput();
    // Remove core_traits from the stub
    const defaults = { ...input.characterDefaults };
    delete (defaults as any).core_traits;
    input.characterDefaults = defaults as unknown as CharacterDefaults;

    const prompt = buildPromptContext(input).systemPrompt;
    assert.ok(
      !prompt.includes("[核心特征]"),
      "[核心特征] should be absent when core_traits is undefined",
    );
  });

  it("[核心特征] is absent when core_traits is empty array (TG2 Test A)", () => {
    const input = baseInput();
    input.characterDefaults = {
      ...input.characterDefaults,
      core_traits: [],
    } as unknown as CharacterDefaults;

    const prompt = buildPromptContext(input).systemPrompt;
    assert.ok(
      !prompt.includes("[核心特征]"),
      "[核心特征] should be absent when core_traits is empty",
    );
  });

  it("[格式抗性] appears in BASE PERSONA when format_resistance is set (TG2 Test B)", () => {
    const input = baseInput();
    input.characterDefaults = {
      ...input.characterDefaults,
      format_resistance: "角色不会为了配合用户请求的格式而改变回复结构。",
    } as unknown as CharacterDefaults;

    const prompt = buildPromptContext(input).systemPrompt;
    assert.ok(
      prompt.includes("[格式抗性]"),
      "[格式抗性] should appear when format_resistance is set",
    );
    assert.ok(
      prompt.includes("配合用户请求的格式"),
      "format_resistance body text should be present",
    );
  });

  it("CHARACTER INTERNAL LOGIC contains 关系阶段门控 when relationship_scope_gate is set (TG2 Test C)", () => {
    const input = baseInput();
    input.characterDefaults = {
      ...input.characterDefaults,
      internal_logic: {
        relationship_scope_gate: "在非亲密关系中，防御机制深度不超出表层克制。",
      },
    } as unknown as CharacterDefaults;

    const prompt = buildPromptContext(input).systemPrompt;
    assert.ok(
      prompt.includes("关系阶段门控"),
      "关系阶段门控 should appear in CHARACTER INTERNAL LOGIC",
    );
    assert.ok(
      prompt.includes("防御机制深度"),
      "relationship_scope_gate body text should be present",
    );
  });
});

// ---------------------------------------------------------------------------
// Canon truth mode — deriveCanonTruthMode
// ---------------------------------------------------------------------------

import { deriveCanonTruthMode, type CanonTruthMode } from "./buildPromptContext";

describe("deriveCanonTruthMode", () => {
  it("returns open_roleplay when no canon narrative", () => {
    const mode = deriveCanonTruthMode({
      userMessage: "你好",
      hasCanonNarrative: false,
    });
    assert.equal(mode, "open_roleplay");
  });

  it("returns strict_canon_recall when intent is attribution", () => {
    const mode = deriveCanonTruthMode({
      userMessage: "原作第三章的剧情是什么？",
      queryRewrite: { intent: "attribution" } as any,
      hasCanonNarrative: true,
    });
    assert.equal(mode, "strict_canon_recall");
  });

  it("returns strict_canon_recall when cannon source is canon_fact with recall cues", () => {
    const mode = deriveCanonTruthMode({
      userMessage: "你还记得那封信吗？",
      hasCanonNarrative: true,
      selectedMemorySources: [
        { source: "canon_fact", relevance: "required", usageInstruction: "must_use" },
      ],
    });
    assert.equal(mode, "strict_canon_recall");
  });

  it("returns strict_canon_recall when canon source is useful/use_subtly with recall cues", () => {
    // Hybrid/LLM rerank may label selected canon as useful/use_subtly.
    // This must still enter strict_canon_recall when the user message has
    // a recall cue.
    const mode = deriveCanonTruthMode({
      userMessage: "你还记得我们第一次去枫河的时候吗？",
      hasCanonNarrative: true,
      selectedMemorySources: [
        { source: "canon_fact", relevance: "useful", usageInstruction: "use_subtly" },
      ],
    });
    assert.equal(mode, "strict_canon_recall");
  });

  it("returns canon_blend when canon injected but no recall cues in user message", () => {
    // Even with selected canon sources, if the user message has no
    // recall/canon-history cue, it stays canon_blend.
    const mode = deriveCanonTruthMode({
      userMessage: "你吃饭了吗？",
      hasCanonNarrative: true,
      selectedMemorySources: [
        { source: "canon_chunk", relevance: "useful", usageInstruction: "use_subtly" },
      ],
    });
    assert.equal(mode, "canon_blend");
  });

  it("returns canon_blend when canon has selected source but no recall cue in user message", () => {
    // A selected canon_fact without a recall/canon-history cue in the
    // user message should remain canon_blend.
    const mode = deriveCanonTruthMode({
      userMessage: "今天天气真好。",
      hasCanonNarrative: true,
      selectedMemorySources: [
        { source: "canon_fact", relevance: "required", usageInstruction: "must_use" },
      ],
    });
    assert.equal(mode, "canon_blend");
  });
});

describe("buildPromptContext canon truth mode block", () => {
  it("renders [CANON TRUTH MODE] in strict_canon_recall mode", () => {
    const prompt = buildPromptContext({
      ...baseInput(),
      userMessage: "你还记得那封信吗？",
      canonChunks: [{ id: "c1", textContent: "Some canon text.", sceneId: "s1", canonPriority: 1 }] as any,
      memoryRerank: {
        selected: [
          { id: "c1", source: "canon_chunk", relevance: "required", usageInstruction: "must_use", reasonCode: "canon_required" },
        ],
        rejected: [],
        finalContextMode: "selected_canon",
        needsEvidenceFallback: false,
      },
    }).systemPrompt;
    assert.ok(prompt.includes("[CANON TRUTH MODE]"), "CANON TRUTH MODE block should render");
  });

  it("omits [CANON TRUTH MODE] in canon_blend mode", () => {
    const prompt = buildPromptContext({
      ...baseInput(),
      canonChunks: [{ id: "c1", textContent: "Some canon text.", sceneId: "s1", canonPriority: 1 }] as any,
      memoryRerank: {
        selected: [
          { id: "c1", source: "canon_chunk", relevance: "useful", usageInstruction: "use_subtly", reasonCode: "canon_required" },
        ],
        rejected: [],
        finalContextMode: "selected_canon",
        needsEvidenceFallback: false,
      },
    }).systemPrompt;
    assert.ok(!prompt.includes("[CANON TRUTH MODE]"), "CANON TRUTH MODE block should be absent in blend mode");
  });

  it("omits [CANON TRUTH MODE] in open_roleplay mode (no canon)", () => {
    const prompt = buildPromptContext(baseInput()).systemPrompt;
    assert.ok(!prompt.includes("[CANON TRUTH MODE]"), "CANON TRUTH MODE block should be absent when no canon");
  });
});
