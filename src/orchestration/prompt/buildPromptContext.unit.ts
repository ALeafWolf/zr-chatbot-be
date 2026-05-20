import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildPromptContext } from "./buildPromptContext";
import type { ChatSession } from "../../db/schema/chat";
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

  it("renders selected canon chunks and excludes unselected canon when memoryRerank selects specific canon", () => {
    // Regression: the buildPromptContext safety filter previously matched canon chunks
    // by c.sceneId ?? c.id. For tier3 chunks where sceneId is set (e.g. "scene_1"),
    // this caused selected chunks (selected by chunk id like "scene_1_0") to be dropped.
    // The filter must match by c.id to align with how resolveContext pre-filters canon.
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
        {
          id: "scene_2_0",
          textContent: "unselected canon text that must not appear",
          contentType: "narrative",
          speaker: null,
          canonPriority: null,
          rankScore: 0.1,
          sceneId: "scene_2",
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
    assert.equal(prompt.includes("unselected canon text that must not appear"), false, "unselected canon chunk text should be absent");
    assert.equal(prompt.includes("[CANON NARRATIVE]"), true, "CANON NARRATIVE block should be present");
  });

  it("omits [CANON NARRATIVE] when no canon chunks or scenes exist", () => {
    // regression: formatCanon([]) returns placeholder text "(无相关剧情内容)",
    // which previously still rendered [CANON NARRATIVE].
    const prompt = buildPromptContext({
      ...baseInput(),
      canonChunks: [],
      memoryRerank: {
        selected: [],
        rejected: [],
        finalContextMode: "recent_only",
        needsEvidenceFallback: false,
      },
    }).systemPrompt;
    assert.equal(prompt.includes("[CANON NARRATIVE]"), false, "CANON NARRATIVE should be absent when no canon exists");
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
});
