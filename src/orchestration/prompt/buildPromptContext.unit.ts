import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildPromptContext, buildEmotionalRenderBlockFromInput, deriveCanonTruthMode } from "./buildPromptContext";
import type { ChatSession } from "../../db/schema/chat";
import { buildPromptTracePayload } from "../../observability/tracePayloads";
import type { CharacterDefaults, PersonaOverlayDefaults } from "../../character/characterDefaults";
import type { QueryRewriteResult } from "../../retrieval/query/rewriteQuery";
import { env } from "../../config/env";
import { createAgentEvalCapture, withAgentEvalCapture, buildAgentEvalOutput } from "../../eval/evalSnapshots";
import { getEmotionalAxisEvalConfig, setEmotionalAxisEvalConfig, resetEmotionalAxisEvalConfig } from "../../eval/emotionalAxisEvalConfig";

const characterDefaults = {
  name: "Test Character", identity: "A test character.",
  hard_rules: ["Stay in character."], core_traits: ["careful"],
  narrative_prose_guidelines: "",
  speech_style: { language: "Chinese", formality: "formal", emotionality: "restrained", preferred_patterns: [], avoid: [] },
  in_character_expression: "", emotional_core: "", values: [],
  private_habits_and_texture: [], relationship_expression: { general: "" },
  interaction_defaults: { default_continuity_scope: "main", default_emotional_baseline: "calm", default_relationship_baseline: "neutral" },
} as unknown as CharacterDefaults;

const personaOverlay = {
  continuity_scope: "main", relationship_status: "confirmed_relationship",
  baseline_warmth: "medium", baseline_nsfw_openness: "none", max_nsfw_level: "none",
  escalation_rule: "none", out_of_scope_chapter_behavior: "deflect", overlay_identity: "",
} as unknown as PersonaOverlayDefaults;

const session = {
  sessionId: "s1", characterId: "c1", playerId: "p1", mode: "canonical_live",
  continuityScope: "main", continuityFamily: "main_world", personaOverlayId: null,
  memoryNamespace: "main", pinnedTime: null, pinnedLocation: null,
  writebackPolicy: "full_writeback", sessionSummary: null, displayTitle: null,
  thinking: true, temperature: 1, deletedAt: null, createdAt: new Date(), updatedAt: new Date(),
} satisfies ChatSession;

function baseInput() {
  return {
    characterDefaults, personaOverlay, session,
    derivedState: { inferredMood: "calm", inferredActivity: "in_conversation", conversationalStance: "attentive" },
    memories: [], canonChunks: [], recentTurns: [], userMessage: "hello",
  };
}

function structuredQueryRewrite(overrides: Partial<QueryRewriteResult> = {}): QueryRewriteResult {
  return {
    segments: [{ lane: "user_speech", text: "你好" }], combined_for_embedding: "[user speech] 你好",
    entities: [], intent: "general", confidence: 0.9, structuralParseOk: true, labelOk: true, parseOk: true,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// buildPromptContext — simple conditional blocks
// ---------------------------------------------------------------------------

describe("buildPromptContext — conditional blocks", () => {
  it("renders/omits open threads, latest turn delta, memory corrections, StructMem expansions", () => {
    // Open threads — absent when none, present when provided
    let prompt = buildPromptContext(baseInput()).systemPrompt;
    assert.equal(prompt.includes("[ACTIVE OPEN THREADS]"), false, "no threads — absent");

    prompt = buildPromptContext({ ...baseInput(), openThreads: [{ id: "t1", source: "session_summary", text: "answer the pending question", status: "open", sourceTurnIndex: 2, score: 0.9 }] }).systemPrompt;
    assert.equal(prompt.includes("[ACTIVE OPEN THREADS]"), true, "with threads — present");
    assert.equal(prompt.includes("answer the pending question"), true, "with threads — content");

    // Latest turn delta
    prompt = buildPromptContext({ ...baseInput(), latestTurnDelta: { kind: "latest_turn_delta", sourceTurnStart: 2, sourceTurnEnd: 3, expiresAfterTurn: 7, facts: ["the user asked to resume the scene"], pendingActions: [], relationshipSignals: [] } }).systemPrompt;
    assert.equal(prompt.includes("[LATEST TURN DELTA]"), true, "delta — present");
    assert.equal(prompt.includes("the user asked to resume the scene"), true, "delta — content");

    // Memory corrections before latest turn delta
    prompt = buildPromptContext({
      ...baseInput(),
      memoryCorrections: [{ oldClaim: "the meeting is tomorrow", correctedClaim: "the meeting is Friday", sourceTurnIndex: 6 }],
      latestTurnDelta: { kind: "latest_turn_delta", sourceTurnStart: 7, sourceTurnEnd: 8, expiresAfterTurn: 10, facts: ["latest fact"], pendingActions: [], relationshipSignals: [] },
    }).systemPrompt;
    assert.equal(prompt.includes("[MEMORY CORRECTIONS]"), true, "corrections — present");
    assert.ok(prompt.indexOf("[MEMORY CORRECTIONS]") < prompt.indexOf("[LATEST TURN DELTA]"), "corrections — before delta");

    // StructMem expansions
    prompt = buildPromptContext({
      ...baseInput(), structMemEntries: [{ id: "entry-1", eventId: "event-1", turnIndex: 2, entryType: "decision", text: "They agreed to revisit the question.", importanceScore: 0.9, confidenceScore: 0.9, cosineSimilarity: 0.9, finalScore: 0.9 }],
      structMemEntryContextExpansions: [{ entryId: "entry-1", eventId: "event-1", messages: [{ turnIndex: 1, role: "user", content: "Later?" }, { turnIndex: 2, role: "assistant", content: "Later." }] }],
    }).systemPrompt;
    assert.equal(prompt.includes("Context:"), true, "structmem — Context:");
    assert.equal(prompt.includes("turn 1 user: Later?"), true, "structmem — context content");
  });
});

// ---------------------------------------------------------------------------
// buildPromptContext — reranker scenarios
// ---------------------------------------------------------------------------

describe("buildPromptContext — reranker scenarios", () => {
  it("omits SESSION SUMMARY / MEMORY CORRECTIONS / LATEST TURN DELTA when null/empty", () => {
    const p = buildPromptContext({ ...baseInput(), sessionSummary: null, memoryCorrections: [], latestTurnDelta: null }).systemPrompt;
    assert.equal(p.includes("[SESSION SUMMARY]"), false, "summary absent");
    assert.equal(p.includes("[MEMORY CORRECTIONS]"), false, "corrections absent");
    assert.equal(p.includes("[LATEST TURN DELTA]"), false, "delta absent");
  });

  it("omits all candidate-backed blocks when reranker selected is empty", () => {
    const prompt = buildPromptContext({
      ...baseInput(), sessionSummary: null, latestTurnDelta: null, memoryCorrections: [], openThreads: [],
      memories: [], sessionRecall: [], structMemEntries: [], structMemConsolidations: [],
      memoryRerank: { selected: [], rejected: [{ id: "session_summary", source: "session_summary", reasonCode: "irrelevant" }, { id: "latest_turn_delta", source: "latest_turn_delta", reasonCode: "irrelevant" }], finalContextMode: "recent_only", needsEvidenceFallback: false },
    }).systemPrompt;
    assert.equal(prompt.includes("[SESSION SUMMARY]"), false, "SESSION SUMMARY");
    assert.equal(prompt.includes("[MEMORY CORRECTIONS]"), false, "MEMORY CORRECTIONS");
    assert.equal(prompt.includes("[LATEST TURN DELTA]"), false, "LATEST TURN DELTA");
    assert.equal(prompt.includes("[ACTIVE OPEN THREADS]"), false, "ACTIVE OPEN THREADS");
    assert.equal(prompt.includes("[RELEVANT SESSION RECALL]"), false, "RELEVANT SESSION RECALL");
    assert.equal(prompt.includes("[STRUCTURED EVENT MEMORY]"), false, "STRUCTURED EVENT MEMORY");
    assert.equal(prompt.includes("[STRUCTURED MEMORY SYNTHESIS]"), false, "STRUCTURED MEMORY SYNTHESIS");
    assert.equal(prompt.includes("[INTERACTIVE MEMORY]"), false, "INTERACTIVE MEMORY");
    assert.equal(prompt.includes("[CANON NARRATIVE]"), false, "CANON NARRATIVE");
  });

  it("clears canon when no canon sources selected, preserves selectedMemorySources", () => {
    // Clear canon safety
    let prompt = buildPromptContext({
      ...baseInput(), canonChunks: [{ id: "canon_unused", textContent: "should not appear", contentType: "narrative", speaker: null, canonPriority: null, rankScore: 0.5, arcKey: "a", chapterName: "Ch1", sceneId: "scene_1" }],
      memoryRerank: { selected: [{ id: "mem_1", source: "interactive_memory", relevance: "useful", usageInstruction: "use_subtly", reasonCode: "direct_continuity" }], rejected: [], finalContextMode: "selected_memory", needsEvidenceFallback: false },
    }).systemPrompt;
    assert.equal(prompt.includes("[CANON NARRATIVE]"), false, "CANON absent when no canon selected");
    assert.equal(prompt.includes("should not appear"), false, "unselected canon content not leaked");

    // preserves selectedMemorySources
    const ctx = buildPromptContext({
      ...baseInput(), memoryRerank: { selected: [{ id: "mem_1", source: "interactive_memory", relevance: "useful", usageInstruction: "use_subtly", reasonCode: "direct_continuity" }], rejected: [], finalContextMode: "selected_memory", needsEvidenceFallback: false },
    });
    assert.ok(ctx.selectedMemorySources, "selectedMemorySources present");
    assert.equal(ctx.selectedMemorySources?.length, 1, "selectedMemorySources count");
    assert.equal(ctx.selectedMemorySources?.[0]?.source, "interactive_memory", "selectedMemorySources source");
  });

  it("renders selected canon chunks, facts, chunk-only, and filtered session_chunk scenarios", () => {
    // One selected session_chunk with all other sources filtered
    let prompt = buildPromptContext({
      ...baseInput(), sessionSummary: null, latestTurnDelta: null, memoryCorrections: [], openThreads: [],
      memories: [], structMemEntries: [], structMemConsolidations: [],
      canonChunks: [{ id: "canon_unused", textContent: "lakeside canon scene that should not appear", contentType: "narrative", speaker: null, canonPriority: null, rankScore: 0, arcKey: "main", chapterName: "", sceneId: "scene_99" }],
      sessionRecall: [{ id: "c7375a00-77db-4e40-a413-6cd046f374c6", chunkText: "user seemed interested in resuming the scene at the lakeside", turnStart: 10, turnEnd: 12, finalScore: 0.91, cosineSimilarity: 0.85, chunkType: "scene" }],
      memoryRerank: {
        selected: [{ id: "c7375a00-77db-4e40-a413-6cd046f374c6", source: "session_chunk", relevance: "useful", usageInstruction: "use_subtly", reasonCode: "direct_continuity" }],
        rejected: [{ id: "session_summary", source: "session_summary", reasonCode: "irrelevant" }, { id: "latest_turn_delta", source: "latest_turn_delta", reasonCode: "irrelevant" }],
        finalContextMode: "selected_memory", needsEvidenceFallback: false,
      },
    }).systemPrompt;
    assert.equal(prompt.includes("[RELEVANT SESSION RECALL]"), true, "session_chunk — selected recall appears");
    assert.equal(prompt.includes("[SELECTED CONTEXT USAGE]"), false, "session_chunk — no SELECTED CONTEXT USAGE");
    assert.equal(prompt.includes("lakeside"), true, "session_chunk — selected chunk text");
    assert.equal(prompt.includes("lakeside canon scene that should not appear"), false, "session_chunk — unselected canon absent");
    assert.equal(prompt.includes("[SESSION SUMMARY]"), false, "session_chunk — summary absent");
    assert.equal(prompt.includes("[MEMORY CORRECTIONS]"), false, "session_chunk — corrections absent");
    assert.equal(prompt.includes("[LATEST TURN DELTA]"), false, "session_chunk — delta absent");
    assert.equal(prompt.includes("[ACTIVE OPEN THREADS]"), false, "session_chunk — threads absent");
    assert.equal(prompt.includes("[STRUCTURED EVENT MEMORY]"), false, "session_chunk — event memory absent");
    assert.equal(prompt.includes("[STRUCTURED MEMORY SYNTHESIS]"), false, "session_chunk — synthesis absent");
    assert.equal(prompt.includes("[INTERACTIVE MEMORY]"), false, "session_chunk — interactive absent");
    assert.equal(prompt.includes("[CANON NARRATIVE]"), false, "session_chunk — canon absent");

    // Selected canon chunk
    prompt = buildPromptContext({
      ...baseInput(), canonChunks: [{ id: "scene_1_0", textContent: "selected canon text that must appear", contentType: "narrative", speaker: null, canonPriority: null, rankScore: 0.9, sceneId: "scene_1" }],
      memoryRerank: { selected: [{ id: "scene_1_0", source: "canon_chunk", relevance: "useful", usageInstruction: "use_subtly", reasonCode: "canon_required" }], rejected: [], finalContextMode: "memory_and_canon", needsEvidenceFallback: false },
    }).systemPrompt;
    assert.equal(prompt.includes("selected canon text that must appear"), true, "canon chunk — text renders");
    assert.equal(prompt.includes("[CANON NARRATIVE]"), true, "canon chunk — block present");

    // Selected canon fact
    prompt = buildPromptContext({
      ...baseInput(), canonChunks: [], canonScenes: [{ sceneId: "scene_1", arcKey: "a", chapterId: "ch1", episodeId: "ep1", chapterName: "第一章", episodeLabel: "第一幕", episodeSummary: null, episodeOpeningUnits: [], sceneTitle: "湖畔", sceneSummary: "两人在湖边散步。", units: [{ unitIndex: 0, speaker: "A", contentType: "narrative", textContent: "A walks by the lake." }], facts: [{ subject: "E", predicate: "loves", object: "F", textForm: "E loves F.", originalFactIndex: 2 }] as any, rankScore: 0.9, provenance: { fromSummary: null, fromFact: null, fromUnit: null, fromLex: null } }],
      memoryRerank: { selected: [{ id: "fact_scene_1_2", source: "canon_fact", relevance: "required", usageInstruction: "must_use", reasonCode: "canon_required" }], rejected: [], finalContextMode: "memory_and_canon", needsEvidenceFallback: false },
    }).systemPrompt;
    assert.equal(prompt.includes("[CANON NARRATIVE]"), true, "canon fact — block present");
    assert.equal(prompt.includes("- E loves F"), true, "canon fact — fact renders");
    assert.equal(prompt.includes("湖畔"), true, "canon fact — scene title renders");

    // Already-filtered selected fact scenes
    prompt = buildPromptContext({
      ...baseInput(), canonChunks: [], canonScenes: [{ sceneId: "scene_1", arcKey: "a", chapterId: "ch1", episodeId: "ep1", chapterName: "第一章", episodeLabel: "第一幕", episodeSummary: null, episodeOpeningUnits: [], sceneTitle: "湖畔", sceneSummary: "两人在湖边散步。", units: [{ unitIndex: 0, speaker: "A", contentType: "narrative", textContent: "A walks by the lake." }], facts: [{ subject: "Selected", predicate: "is", object: "Kept", textForm: "Selected is Kept.", originalFactIndex: 2 }] as any, rankScore: 0.9, provenance: { fromSummary: null, fromFact: null, fromUnit: null, fromLex: null } }],
      memoryRerank: { selected: [{ id: "fact_scene_1_2", source: "canon_fact", relevance: "required", usageInstruction: "must_use", reasonCode: "canon_required" }], rejected: [], finalContextMode: "memory_and_canon", needsEvidenceFallback: false },
    }).systemPrompt;
    assert.equal(prompt.includes("[CANON NARRATIVE]"), true, "filtered — block present");
    assert.equal(prompt.includes("Selected is Kept"), true, "filtered — fact renders");
    assert.equal(prompt.includes("湖畔"), true, "filtered — scene title");

    // Chunk-only selected canon (no scene re-expansion)
    prompt = buildPromptContext({
      ...baseInput(), canonChunks: [{ id: "chunk_1", textContent: "Selected chunk content.", sceneId: "s1", canonPriority: 1, contentType: "narrative", speaker: null, rankScore: 0.9 }], canonScenes: [],
      memoryRerank: { selected: [{ id: "chunk_1", source: "canon_chunk", relevance: "useful", usageInstruction: "use_subtly", reasonCode: "canon_required" }], rejected: [], finalContextMode: "selected_canon", needsEvidenceFallback: false },
    }).systemPrompt;
    assert.equal(prompt.includes("[CANON NARRATIVE]"), true, "chunk-only — block present");
    assert.equal(prompt.includes("Selected chunk content"), true, "chunk-only — chunk renders");
    assert.equal(prompt.includes("湖畔"), false, "chunk-only — no scene expansion");
  });
});

// ---------------------------------------------------------------------------
// buildPromptContext — structured query / label rules / character blocks
// ---------------------------------------------------------------------------

describe("buildPromptContext — structured query and character blocks", () => {
  const labelRulesBlockHeader = "[STRUCTURED USER QUERY LABEL RULES]\n[STRUCTURED USER QUERY] 内部的各类标签并不等同";

  it("renders LABEL RULES and [SYSTEM] block reference for structured queries", () => {
    // LABEL RULES before STRUCTURED USER QUERY
    const queryRewrite = structuredQueryRewrite();
    let prompt = buildPromptContext({ ...baseInput(), queryRewrite }).systemPrompt;
    const labelRulesIdx = prompt.indexOf(labelRulesBlockHeader);
    const structuredIdx = prompt.indexOf(`[STRUCTURED USER QUERY]\n${queryRewrite.combined_for_embedding}`);
    assert.ok(labelRulesIdx >= 0, "LABEL RULES — present");
    assert.ok(structuredIdx >= 0, "STRUCTURED USER QUERY — present");
    assert.ok(labelRulesIdx < structuredIdx, "LABEL RULES — before STRUCTURED USER QUERY");

    // Omits LABEL RULES when no query
    assert.equal(buildPromptContext(baseInput()).systemPrompt.includes(labelRulesBlockHeader), false, "no query — absent");

    // Omits when parse failed
    assert.equal(buildPromptContext({ ...baseInput(), queryRewrite: structuredQueryRewrite({ parseOk: false }) }).systemPrompt.includes(labelRulesBlockHeader), false, "parse failed — absent");

    // [reply direction suggestion] prohibition
    prompt = buildPromptContext({ ...baseInput(), queryRewrite: structuredQueryRewrite() }).systemPrompt;
    assert.ok(prompt.includes("[reply direction suggestion]"), "reply direction — present");
    assert.ok(prompt.includes("角色绝不能推断 [reply direction suggestion] 是由 <user> 说出、发送、输入、知晓、意图表达或主动透露的内容"), "reply direction — full text");

    // [SYSTEM] block points to LABEL RULES
    prompt = buildPromptContext({ ...baseInput(), queryRewrite: structuredQueryRewrite() }).systemPrompt;
    const systemIdx = prompt.indexOf("[SYSTEM]");
    const labelRulesRefIdx = prompt.indexOf("[STRUCTURED USER QUERY LABEL RULES]");
    assert.ok(systemIdx >= 0, "[SYSTEM] — present");
    assert.ok(labelRulesRefIdx > systemIdx, "[SYSTEM] — before LABEL RULES ref");
    assert.ok(prompt.includes("并必须遵守 `[STRUCTURED USER QUERY LABEL RULES]`"), "[SYSTEM] — reference text");
  });

  it("CHARACTER INTERNAL LOGIC: renders when provided, omits when undefined/empty, orders before BASE PERSONA before CONTINUITY OVERLAY, traces presence", () => {
    // Renders when internal_logic is provided
    let input = baseInput();
    input.characterDefaults = { ...input.characterDefaults, internal_logic: { core_belief: "真正的在意必须通过可靠的行动来证明。", core_motivation: "以可靠的方式守护所珍视的人。" } } as any;
    let prompt = buildPromptContext(input).systemPrompt;
    assert.ok(prompt.includes("[CHARACTER INTERNAL LOGIC]"), "renders — present");

    // Omitted when undefined
    input = baseInput();
    const defaults = { ...input.characterDefaults };
    delete (defaults as any).internal_logic;
    input.characterDefaults = defaults as any;
    prompt = buildPromptContext(input).systemPrompt;
    assert.ok(!prompt.includes("[CHARACTER INTERNAL LOGIC]"), "undefined — absent");

    // Omitted when all fields empty
    input = baseInput();
    input.characterDefaults = { ...input.characterDefaults, internal_logic: { growth_environment: "", core_belief: "", core_motivation: "", core_fear: "", defense_mechanism: "", transition_rule: "" } } as any;
    prompt = buildPromptContext(input).systemPrompt;
    assert.ok(!prompt.includes("[CHARACTER INTERNAL LOGIC]"), "empty — absent");

    // Block ordering: CHARACTER INTERNAL LOGIC < BASE PERSONA < CONTINUITY OVERLAY
    input = baseInput();
    input.characterDefaults = { ...input.characterDefaults, internal_logic: { core_belief: "真正的在意必须通过可靠的行动来证明。" } } as any;
    prompt = buildPromptContext(input).systemPrompt;
    const internalLogicIdx = prompt.indexOf("[CHARACTER INTERNAL LOGIC]");
    const basePersonaIdx = prompt.indexOf("[BASE PERSONA]");
    const continuityIdx = prompt.indexOf("[CONTINUITY OVERLAY]");
    assert.ok(internalLogicIdx >= 0, "order — internal logic exists");
    assert.ok(basePersonaIdx >= 0, "order — base persona exists");
    assert.ok(continuityIdx >= 0, "order — continuity overlay exists");
    assert.ok(internalLogicIdx < basePersonaIdx, "order — internal logic before base persona");
    assert.ok(basePersonaIdx < continuityIdx, "order — base persona before continuity overlay");

    // Trace payload records presence
    input = baseInput();
    input.characterDefaults = { ...input.characterDefaults, internal_logic: { core_belief: "真正的在意必须通过可靠的行动来证明。" } } as any;
    const { systemPrompt } = buildPromptContext(input);
    const payload = buildPromptTracePayload({ systemPrompt, conversationHistory: [] });
    assert.strictEqual(payload.blockPresence["CHARACTER INTERNAL LOGIC"], true, "trace — records present");
  });

  it("renders STYLE SALIENCE REMINDER and TEMPORAL PREMISE HANDLING blocks with correct order and bounds, absent when no canon", () => {
    const inputWithCanon = { ...baseInput(), canonChunks: [{ id: "c1", textContent: "Some canon text.", sceneId: "s1", canonPriority: 1 }] as any };

    // STYLE SALIENCE REMINDER after CANON NARRATIVE
    let prompt = buildPromptContext(inputWithCanon).systemPrompt;
    const canonIdx = prompt.indexOf("[CANON NARRATIVE]");
    const reminderIdx = prompt.indexOf("[STYLE SALIENCE REMINDER]");
    assert.ok(canonIdx >= 0, "style — CANON NARRATIVE exists");
    assert.ok(reminderIdx >= 0, "style — STYLE SALIENCE REMINDER exists when canon renders");
    assert.ok(canonIdx < reminderIdx, "style — after canon");

    // TEMPORAL PREMISE HANDLING between CANON NARRATIVE and STYLE SALIENCE REMINDER
    const temporalIdx = prompt.indexOf("[TEMPORAL PREMISE HANDLING]");
    assert.ok(temporalIdx >= 0, "temporal — exists when canon renders");
    assert.ok(canonIdx < temporalIdx, "temporal — after canon");
    assert.ok(temporalIdx < reminderIdx, "temporal — before style reminder");

    // TEMPORAL PREMISE HANDLING absent when no canon
    prompt = buildPromptContext(baseInput()).systemPrompt;
    assert.equal(prompt.includes("[TEMPORAL PREMISE HANDLING]"), false, "temporal — absent when no canon");

    // STYLE SALIENCE REMINDER absent when canon does not render
    const inputNoCanon = { ...baseInput(), canonChunks: [] };
    prompt = buildPromptContext(inputNoCanon).systemPrompt;
    assert.ok(!prompt.includes("[STYLE SALIENCE REMINDER]"), "style — absent when no canon");

    // STYLE SALIENCE REMINDER body ≤ 300 chars
    prompt = buildPromptContext(inputWithCanon).systemPrompt;
    const match = prompt.match(/\[STYLE SALIENCE REMINDER\]\n([\s\S]*?)(?:\n\[|$)/);
    assert.ok(match, "style — should find block body");
    const body = match[1].trim();
    assert.ok(body.length <= 300, `style — body length ${body.length} should be ≤ 300`);
  });

  it("renders/omits 纠正方式, 核心特征, 格式抗性, 关系阶段门控, and no hedge", () => {
    // [纠正方式] appears when canon_correction is set
    let input = baseInput();
    input.characterDefaults = { ...input.characterDefaults, canon_correction: "如果用户提出错误前提，角色会平静地纠正。" } as any;
    let prompt = buildPromptContext(input).systemPrompt;
    assert.ok(prompt.includes("[纠正方式]"), "纠正方式 — present");
    assert.ok(prompt.includes("如果用户提出错误前提"), "纠正方式 — body text");

    // [纠正方式] absent when not set
    prompt = buildPromptContext(baseInput()).systemPrompt;
    assert.ok(!prompt.includes("[纠正方式]"), "纠正方式 — absent when not set");

    // No hedge instruction
    prompt = buildPromptContext(baseInput()).systemPrompt;
    assert.ok(!prompt.includes("当你不确定"), "no hedge — absent");

    // [核心特征] absent when core_traits not set
    input = baseInput();
    const defaults = { ...input.characterDefaults };
    delete (defaults as any).core_traits;
    input.characterDefaults = defaults as any;
    prompt = buildPromptContext(input).systemPrompt;
    assert.ok(!prompt.includes("[核心特征]"), "核心特征 — absent when undefined");

    // [核心特征] absent when core_traits empty
    input = baseInput();
    input.characterDefaults = { ...input.characterDefaults, core_traits: [] } as any;
    prompt = buildPromptContext(input).systemPrompt;
    assert.ok(!prompt.includes("[核心特征]"), "核心特征 — absent when empty array");

    // [格式抗性] appears when format_resistance is set
    input = baseInput();
    input.characterDefaults = { ...input.characterDefaults, format_resistance: "角色不会为了配合用户请求的格式而改变回复结构。" } as any;
    prompt = buildPromptContext(input).systemPrompt;
    assert.ok(prompt.includes("[格式抗性]"), "格式抗性 — present");
    assert.ok(prompt.includes("配合用户请求的格式"), "格式抗性 — body text");

    // 关系阶段门控 in CHARACTER INTERNAL LOGIC when relationship_scope_gate set
    input = baseInput();
    input.characterDefaults = { ...input.characterDefaults, internal_logic: { relationship_scope_gate: "在非亲密关系中，防御机制深度不超出表层克制。" } } as any;
    prompt = buildPromptContext(input).systemPrompt;
    assert.ok(prompt.includes("关系阶段门控"), "关系阶段门控 — appears in internal logic");
    assert.ok(prompt.includes("防御机制深度"), "关系阶段门控 — body text");
  });
});

// ---------------------------------------------------------------------------
// deriveCanonTruthMode
// ---------------------------------------------------------------------------

describe("deriveCanonTruthMode", () => {
  it("returns correct mode for all combinations", () => {
    const cases = [
      { name: "open_roleplay when no canon", input: { userMessage: "你好", hasCanonNarrative: false }, expected: "open_roleplay" },
      { name: "strict_canon_recall when intent is attribution", input: { userMessage: "原作第三章的剧情是什么？", queryRewrite: { intent: "attribution" } as any, hasCanonNarrative: true }, expected: "strict_canon_recall" },
      { name: "strict_canon_recall when canon_fact with recall cues", input: { userMessage: "你还记得那封信吗？", hasCanonNarrative: true, selectedMemorySources: [{ source: "canon_fact", relevance: "required", usageInstruction: "must_use" }] }, expected: "strict_canon_recall" },
      { name: "strict_canon_recall when useful/use_subtly canon with recall cues", input: { userMessage: "你还记得我们第一次去枫河的时候吗？", hasCanonNarrative: true, selectedMemorySources: [{ source: "canon_fact", relevance: "useful", usageInstruction: "use_subtly" }] }, expected: "strict_canon_recall" },
      { name: "canon_blend when canon injected but no recall cues", input: { userMessage: "你吃饭了吗？", hasCanonNarrative: true, selectedMemorySources: [{ source: "canon_chunk", relevance: "useful", usageInstruction: "use_subtly" }] }, expected: "canon_blend" },
      { name: "canon_blend when canon_fact selected but no recall cues", input: { userMessage: "今天天气真好。", hasCanonNarrative: true, selectedMemorySources: [{ source: "canon_fact", relevance: "required", usageInstruction: "must_use" }] }, expected: "canon_blend" },
    ];
    for (const c of cases) {
      const mode = deriveCanonTruthMode(c.input);
      assert.equal(mode, c.expected, c.name);
    }
  });
});

// ---------------------------------------------------------------------------
// buildPromptContext — canon truth mode block
// ---------------------------------------------------------------------------

describe("buildPromptContext — canon truth mode block", () => {
  it("renders [CANON TRUTH MODE] in strict mode, omits in blend and open_roleplay", () => {
    const base = { ...baseInput(), canonChunks: [{ id: "c1", textContent: "Some canon text.", sceneId: "s1", canonPriority: 1 }] as any };

    // strict_canon_recall mode
    let prompt = buildPromptContext({
      ...base, userMessage: "你还记得那封信吗？",
      memoryRerank: { selected: [{ id: "c1", source: "canon_chunk", relevance: "required", usageInstruction: "must_use", reasonCode: "canon_required" }], rejected: [], finalContextMode: "selected_canon", needsEvidenceFallback: false },
    }).systemPrompt;
    assert.ok(prompt.includes("[CANON TRUTH MODE]"), "strict — block should render");

    // canon_blend mode
    prompt = buildPromptContext({
      ...base, memoryRerank: { selected: [{ id: "c1", source: "canon_chunk", relevance: "useful", usageInstruction: "use_subtly", reasonCode: "canon_required" }], rejected: [], finalContextMode: "selected_canon", needsEvidenceFallback: false },
    }).systemPrompt;
    assert.ok(!prompt.includes("[CANON TRUTH MODE]"), "blend — block should be absent");

    // open_roleplay mode (no canon)
    prompt = buildPromptContext(baseInput()).systemPrompt;
    assert.ok(!prompt.includes("[CANON TRUTH MODE]"), "open_roleplay — block should be absent");
  });
});

// ---------------------------------------------------------------------------
// buildPromptContext — internal-logic evidence block
// ---------------------------------------------------------------------------

import type { InternalLogicEvidenceHit } from "../../retrieval/internalLogic/searchInternalLogicEvidence";

describe("buildPromptContext — internal-logic evidence block", () => {
  const evidenceHit: InternalLogicEvidenceHit = {
    id: "ev_001", characterId: "zuo_ran", node: "core_fear",
    claimText: "左然害怕暴露不成熟的一面。",
    evidenceText: "六年级生日想要棉花糖却说要钢笔。",
    arcKey: null, chapterKey: null, episodeLabel: null,
    sceneOrder: null, unitIndex: null,
    scopeApplicability: {}, sourceKind: "canon",
    confidenceScore: null, metadata: {},
    cosineSimilarity: 0.5, finalScore: 0.5,
  };

  it("renders evidence block when selected, omits when empty/undefined, orders between INTERNAL LOGIC and BASE PERSONA", () => {
    // Renders when evidence is selected
    let prompt = buildPromptContext({ ...baseInput(), internalLogicEvidence: [evidenceHit] }).systemPrompt;
    assert.ok(prompt.includes("[CHARACTER INTERNAL LOGIC EVIDENCE]"), "selected — block renders");
    assert.ok(prompt.includes("core_fear"), "selected — node content");

    // Omitted when empty
    prompt = buildPromptContext({ ...baseInput(), internalLogicEvidence: [] }).systemPrompt;
    assert.ok(!prompt.includes("[CHARACTER INTERNAL LOGIC EVIDENCE]"), "empty — block absent");

    // Order: evidence after CHARACTER INTERNAL LOGIC, before BASE PERSONA
    prompt = buildPromptContext({ ...baseInput(), internalLogicEvidence: [evidenceHit] }).systemPrompt;
    const internalLogicPos = prompt.indexOf("[CHARACTER INTERNAL LOGIC]");
    const evidencePos = prompt.indexOf("[CHARACTER INTERNAL LOGIC EVIDENCE]");
    const basePersonaPos = prompt.indexOf("[BASE PERSONA]");
    assert.ok(evidencePos > internalLogicPos, "order — evidence after internal logic");
    assert.ok(basePersonaPos > evidencePos, "order — base persona after evidence");

    // Omitted by default when not provided
    prompt = buildPromptContext(baseInput()).systemPrompt;
    assert.ok(!prompt.includes("[CHARACTER INTERNAL LOGIC EVIDENCE]"), "undefined — block absent");
  });

  // ===================================================================
  // TG4 — Render block wiring (F12)
  // ===================================================================

  describe("buildPromptContext — render block fresh session (TG4b F15)", () => {
    it("F15: fresh session main_relationship with render+engine on produces expected band line", () => {
      const savedRender = (env as any).EMOTIONAL_RENDER_ENABLED;
      const savedEngine = (env as any).EMOTIONAL_ENGINE_ENABLED;
      try {
        (env as any).EMOTIONAL_RENDER_ENABLED = true;
        (env as any).EMOTIONAL_ENGINE_ENABLED = true;

        const cd = {
          ...characterDefaults,
          name: "左然",
          internal_logic: { core_belief: "test" },
          emotional_axes: {
            connection: { baseline: 0, driftRate: 0.02, min: -1, max: 1 },
            valence: { baseline: 0, driftRate: 0.02, min: -1, max: 1 },
            arousal: { baseline: 0, driftRate: 0.02, min: -1, max: 1 },
            restraint: { baseline: 0.7, driftRate: 0.02, min: -1, max: 1 },
          },
          emotional_axes_baseline_by_scope: {
            main_relationship: { connection: 0.15, valence: 0.05, arousal: 0.0, restraint: 0.7 },
          },
        };

        // No emotionalAxisBands passed ⇒ render-from-baselines via the helper
        // But since we're calling buildPromptContext directly (not via the adapter),
        // we pass the inputs directly as they would be computed by resolveEmotionalRenderInputs
        const prompt = buildPromptContext({
          ...baseInput(),
          characterDefaults: cd as any,
          internalLogicEvidence: [],
          // Fresh session: bands from main_relationship baselines with axis-aware thresholds
          emotionalAxisBands: { connection: "mid", valence: "mid", arousal: "mid", restraint: "high" },
          emotionalAxisLastTrace: {
            tick: 0,
            axesBefore: { connection: 0.15, valence: 0.05, arousal: 0, restraint: 0.7 },
            axesAfter: { connection: 0.15, valence: 0.05, arousal: 0, restraint: 0.7 },
            couplingsFired: [],
            effectiveBaselines: {},
          },
          emotionalAxisHistory: [],
        }).systemPrompt;

        assert.ok(prompt.includes("当前状态下的行为基调"), "render block present on fresh session");
        assert.ok(prompt.includes("克制：偏高"), "restraint 0.7 > 0.65 → 偏高");
        assert.ok(prompt.includes("亲近：中"), "connection 0.15 centered → 中");
        assert.ok(prompt.includes("情绪：中"), "valence 0.05 centered → 中");
        assert.ok(prompt.includes("唤起：中"), "arousal 0 centered → 中");
      } finally {
        (env as any).EMOTIONAL_RENDER_ENABLED = savedRender;
        (env as any).EMOTIONAL_ENGINE_ENABLED = savedEngine;
      }
    });

    it("F15: render-off prompt is byte-identical to baseline (no axis inputs, flags off)", () => {
      const savedRender = (env as any).EMOTIONAL_RENDER_ENABLED;
      const savedEngine = (env as any).EMOTIONAL_ENGINE_ENABLED;
      try {
        (env as any).EMOTIONAL_RENDER_ENABLED = false;
        (env as any).EMOTIONAL_ENGINE_ENABLED = false;

        const input = {
          ...baseInput(),
          characterDefaults: { ...characterDefaults, internal_logic: { core_belief: "test" } } as any,
        };

        // Baseline: no axis inputs at all
        const baseline = buildPromptContext({ ...input }).systemPrompt;

        // Render-off: with axis inputs but flags still off — must be byte-identical
        const withInputs = buildPromptContext({
          ...input,
          emotionalAxisBands: { connection: "mid", valence: "mid", arousal: "mid", restraint: "high" },
          emotionalAxisLastTrace: {
            tick: 0,
            axesBefore: { connection: 0.15, valence: 0.05, arousal: 0, restraint: 0.7 },
            axesAfter: { connection: 0.15, valence: 0.05, arousal: 0, restraint: 0.7 },
            couplingsFired: [],
            effectiveBaselines: {},
          },
          emotionalAxisHistory: [],
        }).systemPrompt;

        assert.equal(baseline, withInputs, "render-off prompt byte-identical to baseline");
      } finally {
        (env as any).EMOTIONAL_RENDER_ENABLED = savedRender;
        (env as any).EMOTIONAL_ENGINE_ENABLED = savedEngine;
      }
    });
  });

  describe("buildPromptContext — render block (TG4 F12)", () => {
    const RENDER_BANDS = { connection: "high" as const, valence: "mid" as const, arousal: "low" as const, restraint: "high" as const };
    const RENDER_TRACE = {
      tick: 1, axesBefore: { connection: 0, valence: 0, arousal: 0, restraint: 0.7 },
      axesAfter: { connection: 0.7, valence: 0, arousal: -0.1, restraint: 0.7 },
      couplingsFired: [] as string[], effectiveBaselines: {} as Record<string, number>,
    };
    const RENDER_HISTORY: Array<{ tick: number; axes: { connection: number; valence: number; arousal: number; restraint: number } }> = [];

    function baseWithInternalLogic() {
      const cd = {
        ...characterDefaults,
        internal_logic: { core_belief: "test" },
      } as any;
      return { ...baseInput(), characterDefaults: cd };
    }

    it("F12a: render flag off ⇒ no render block (byte-identical to baseline)", () => {
      const savedRender = (env as any).EMOTIONAL_RENDER_ENABLED;
      const savedEngine = (env as any).EMOTIONAL_ENGINE_ENABLED;
      try {
        (env as any).EMOTIONAL_RENDER_ENABLED = false;
        (env as any).EMOTIONAL_ENGINE_ENABLED = false;

        const baseline = buildPromptContext(baseWithInternalLogic()).systemPrompt;
        assert.ok(!baseline.includes("当前状态下的行为基调"), "baseline has no render block");
      } finally {
        (env as any).EMOTIONAL_RENDER_ENABLED = savedRender;
        (env as any).EMOTIONAL_ENGINE_ENABLED = savedEngine;
      }
    });

    it("F12b: render on + engine off ⇒ no render block (inert, same as baseline)", () => {
      const savedRender = (env as any).EMOTIONAL_RENDER_ENABLED;
      const savedEngine = (env as any).EMOTIONAL_ENGINE_ENABLED;
      try {
        (env as any).EMOTIONAL_RENDER_ENABLED = true;
        (env as any).EMOTIONAL_ENGINE_ENABLED = false;

        const prompt = buildPromptContext(baseWithInternalLogic()).systemPrompt;
        assert.ok(!prompt.includes("当前状态下的行为基调"), "render inert without engine");
      } finally {
        (env as any).EMOTIONAL_RENDER_ENABLED = savedRender;
        (env as any).EMOTIONAL_ENGINE_ENABLED = savedEngine;
      }
    });

    it("F12c: render on + engine on + bands absent ⇒ no render block (degradation)", () => {
      const savedRender = (env as any).EMOTIONAL_RENDER_ENABLED;
      const savedEngine = (env as any).EMOTIONAL_ENGINE_ENABLED;
      try {
        (env as any).EMOTIONAL_RENDER_ENABLED = true;
        (env as any).EMOTIONAL_ENGINE_ENABLED = true;

        // No emotionalAxisBands passed ⇒ absent state
        const prompt = buildPromptContext(baseWithInternalLogic()).systemPrompt;
        assert.ok(!prompt.includes("当前状态下的行为基调"), "no render block when axis state absent");
      } finally {
        (env as any).EMOTIONAL_RENDER_ENABLED = savedRender;
        (env as any).EMOTIONAL_ENGINE_ENABLED = savedEngine;
      }
    });

    it("F12d: render on + engine on + state present ⇒ block BETWEEN INTERNAL LOGIC and EVIDENCE", () => {
      const savedRender = (env as any).EMOTIONAL_RENDER_ENABLED;
      const savedEngine = (env as any).EMOTIONAL_ENGINE_ENABLED;
      try {
        (env as any).EMOTIONAL_RENDER_ENABLED = true;
        (env as any).EMOTIONAL_ENGINE_ENABLED = true;

        const prompt = buildPromptContext({
          ...baseWithInternalLogic(),
          internalLogicEvidence: [evidenceHit],
          emotionalAxisBands: RENDER_BANDS,
          emotionalAxisLastTrace: RENDER_TRACE,
          emotionalAxisHistory: RENDER_HISTORY,
        }).systemPrompt;

        // Block must be present
        assert.ok(prompt.includes("当前状态下的行为基调"), "render block present");

        // Block must appear between INTERNAL LOGIC and INTERNAL LOGIC EVIDENCE
        const internalLogicPos = prompt.indexOf("[CHARACTER INTERNAL LOGIC]");
        const renderBlockPos = prompt.indexOf("当前状态下的行为基调");
        const evidencePos = prompt.indexOf("[CHARACTER INTERNAL LOGIC EVIDENCE]");
        const basePersonaPos = prompt.indexOf("[BASE PERSONA]");

        assert.ok(renderBlockPos > internalLogicPos, "render block after INTERNAL LOGIC");
        assert.ok(evidencePos > renderBlockPos, "evidence after render block");
        assert.ok(basePersonaPos > evidencePos, "base persona after evidence");

        // Must contain the band line
        assert.ok(prompt.includes("当前状态"), "band line present");
      } finally {
        (env as any).EMOTIONAL_RENDER_ENABLED = savedRender;
        (env as any).EMOTIONAL_ENGINE_ENABLED = savedEngine;
      }
    });

    // -------------------------------------------------------------------
    // TG2 review-003 F1 — no render snapshot when render is gated/disabled
    // -------------------------------------------------------------------

    it("F1: render on + engine off + axis inputs present ⇒ no emotionalAxis.render snapshot", async () => {
      const savedRender = (env as any).EMOTIONAL_RENDER_ENABLED;
      const savedEngine = (env as any).EMOTIONAL_ENGINE_ENABLED;
      try {
        (env as any).EMOTIONAL_RENDER_ENABLED = true;
        (env as any).EMOTIONAL_ENGINE_ENABLED = false;

        const capture = createAgentEvalCapture({ scenarioId: "tg2_f1_render_gate" });
        await withAgentEvalCapture(capture, async () => {
          // Build prompt with axis inputs present but engine off (render inert)
          buildPromptContext({
            ...baseWithInternalLogic(),
            emotionalAxisBands: RENDER_BANDS,
            emotionalAxisLastTrace: RENDER_TRACE,
            emotionalAxisHistory: RENDER_HISTORY,
          });
        });
        const output = buildAgentEvalOutput({ capture, reply: "test", success: true, cleanup: { attempted: true, completed: true } });
        // When render is inert but engine off, the snapshot guard must skip
        // capture entirely — no emotionalAxis at all, not even a source-only stub.
        assert.equal(output.emotionalAxis, undefined, "no emotionalAxis snapshot when render is inert");
      } finally {
        (env as any).EMOTIONAL_RENDER_ENABLED = savedRender;
        (env as any).EMOTIONAL_ENGINE_ENABLED = savedEngine;
      }
    });

    // -------------------------------------------------------------------
    // TG5 — Behavioral per-variant checks (review-010 F3 / review-011 N1)
    // -------------------------------------------------------------------

    it("TG5 F3: bandsOnly=true produces band-line-only render block and empty renderRuleIds", async () => {
      const savedRender = (env as any).EMOTIONAL_RENDER_ENABLED;
      const savedEngine = (env as any).EMOTIONAL_ENGINE_ENABLED;
      const savedBandsOnly = getEmotionalAxisEvalConfig().bandsOnly;
      try {
        (env as any).EMOTIONAL_RENDER_ENABLED = true;
        (env as any).EMOTIONAL_ENGINE_ENABLED = true;
        setEmotionalAxisEvalConfig({ bandsOnly: true });

        const capture = createAgentEvalCapture({ scenarioId: "tg5_bands_only" });
        await withAgentEvalCapture(capture, async () => {
          buildPromptContext({
            ...baseWithInternalLogic(),
            emotionalAxisBands: RENDER_BANDS,
            emotionalAxisLastTrace: RENDER_TRACE,
            emotionalAxisHistory: RENDER_HISTORY,
          });
        });
        const output = buildAgentEvalOutput({ capture, reply: "test", success: true, cleanup: { attempted: true, completed: true } });
        // Render block should be band-line-only (no rule texts)
        assert.ok(output.emotionalAxis?.render, "render snapshot present");
        assert.ok(output.emotionalAxis!.render!.renderBlock?.includes("当前状态"), "band line present");
        assert.ok(!output.emotionalAxis!.render!.renderBlock?.includes("放松改变的是温度"), "no R1 rule text in bands-only");
        // renderRuleIds must be empty — snapshot must match what was injected
        assert.deepEqual(output.emotionalAxis!.render!.renderRuleIds, [], "empty renderRuleIds in bands-only mode");
      } finally {
        (env as any).EMOTIONAL_RENDER_ENABLED = savedRender;
        (env as any).EMOTIONAL_ENGINE_ENABLED = savedEngine;
        setEmotionalAxisEvalConfig({ bandsOnly: savedBandsOnly });
      }
    });

    it("TG5 F3: renderEnabled=false via eval config skips render block and snapshot", async () => {
      const savedRender = (env as any).EMOTIONAL_RENDER_ENABLED;
      const savedEngine = (env as any).EMOTIONAL_ENGINE_ENABLED;
      const savedRenderEnabled = getEmotionalAxisEvalConfig().renderEnabled;
      try {
        (env as any).EMOTIONAL_RENDER_ENABLED = true;
        (env as any).EMOTIONAL_ENGINE_ENABLED = true;
        setEmotionalAxisEvalConfig({ renderEnabled: false });

        const capture = createAgentEvalCapture({ scenarioId: "tg5_render_off" });
        await withAgentEvalCapture(capture, async () => {
          buildPromptContext({
            ...baseWithInternalLogic(),
            emotionalAxisBands: RENDER_BANDS,
            emotionalAxisLastTrace: RENDER_TRACE,
            emotionalAxisHistory: RENDER_HISTORY,
          });
        });
        const output = buildAgentEvalOutput({ capture, reply: "test", success: true, cleanup: { attempted: true, completed: true } });
        // No emotionalAxis render snapshot should be recorded
        assert.equal(output.emotionalAxis?.render, undefined, "no render snapshot when renderEnabled=false");
      } finally {
        (env as any).EMOTIONAL_RENDER_ENABLED = savedRender;
        (env as any).EMOTIONAL_ENGINE_ENABLED = savedEngine;
        setEmotionalAxisEvalConfig({ renderEnabled: savedRenderEnabled });
      }
    });
  });
});
