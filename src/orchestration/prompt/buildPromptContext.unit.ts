import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildPromptContext, deriveCanonTruthMode, PromptContextSchema } from "./buildPromptContext";
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

// ---------------------------------------------------------------------------
// TG1 — Reply-direction isolation
// ---------------------------------------------------------------------------

describe("buildPromptContext — TG1 reply-direction isolation", () => {
  const base = baseInput;

  function mixedQueryRewrite(): QueryRewriteResult {
    return {
      segments: [
        { lane: "user_speech", text: "你好" },
        { lane: "reply_direction", text: "请温柔回应" },
      ],
      combined_for_embedding: "[user speech] 你好\n[reply direction suggestion]: 请温柔回应",
      entities: [], intent: "general", confidence: 0.9,
      structuralParseOk: true, labelOk: true, parseOk: true,
    };
  }

  function directionOnlyQueryRewrite(): QueryRewriteResult {
    return {
      segments: [
        { lane: "reply_direction", text: "请温柔回应" },
      ],
      combined_for_embedding: "[reply direction suggestion]: 请温柔回应",
      entities: [], intent: "general", confidence: 0.9,
      structuralParseOk: true, labelOk: true, parseOk: true,
    };
  }

  it("applies isolation when userMessage has 【】: generationUserMessage set, stripped, [REPLY DIRECTION] block present as final block", () => {
    const input = {
      ...base(),
      userMessage: "你好【请温柔回应】吗？",
      queryRewrite: mixedQueryRewrite(),
    };
    const ctx = buildPromptContext(input);

    // generationUserMessage should be the stripped message
    assert.equal(ctx.generationUserMessage, "你好吗？");

    const prompt = ctx.systemPrompt;

    // [REPLY DIRECTION] block present
    assert.ok(prompt.includes("[REPLY DIRECTION]"), "REPLY DIRECTION block present");

    // [REPLY DIRECTION] block contains the direction text
    assert.ok(prompt.includes("- 请温柔"), "REPLY DIRECTION — direction text");

    // [REPLY DIRECTION] is the FINAL block (nothing after it except end-of-string)
    const replyDirIdx = prompt.lastIndexOf("[REPLY DIRECTION]");
    const structuredIdx = prompt.lastIndexOf("[STRUCTURED USER QUERY]");
    const annotationsIdx = prompt.lastIndexOf("[USER MESSAGE ANNOTATIONS]");
    assert.ok(replyDirIdx > structuredIdx, "REPLY DIRECTION after STRUCTURED USER QUERY");
    assert.ok(replyDirIdx > annotationsIdx, "REPLY DIRECTION after USER MESSAGE ANNOTATIONS");

    // Nothing after REPLY DIRECTION except whitespace (no subsequent [ label)
    const afterBlock = prompt.slice(replyDirIdx);
    const lastBracket = afterBlock.lastIndexOf("[");
    assert.equal(lastBracket, 0, "REPLY DIRECTION is the final block — no [ after it");
  });

  it("no 【】 in userMessage ⇒ generationUserMessage undefined, no [REPLY DIRECTION] block", () => {
    const input = {
      ...base(),
      userMessage: "你好吗？",
      queryRewrite: structuredQueryRewrite(),
    };
    const ctx = buildPromptContext(input);

    assert.equal(ctx.generationUserMessage, undefined, "generationUserMessage undefined");
    assert.equal(ctx.systemPrompt.includes("[REPLY DIRECTION]"), false, "no REPLY DIRECTION block");
  });

  it("parse failure (unbalanced 【) ⇒ generationUserMessage undefined, no [REPLY DIRECTION] block", () => {
    const input = {
      ...base(),
      userMessage: "你好【不平衡",
      queryRewrite: structuredQueryRewrite(),
    };
    const ctx = buildPromptContext(input);

    assert.equal(ctx.generationUserMessage, undefined, "generationUserMessage undefined on parse fail");
    assert.equal(ctx.systemPrompt.includes("[REPLY DIRECTION]"), false, "no REPLY DIRECTION block on parse fail");
  });

  it("only-【】 message ⇒ generationUserMessage is placeholder", () => {
    const input = {
      ...base(),
      userMessage: "【请温柔回应】",
      queryRewrite: directionOnlyQueryRewrite(),
    };
    const ctx = buildPromptContext(input);

    assert.ok(ctx.generationUserMessage, "generationUserMessage is set");
    assert.ok(
      ctx.generationUserMessage!.includes("仅提供了场外指示"),
      "generationUserMessage is placeholder for direction-only message",
    );
    assert.ok(ctx.systemPrompt.includes("[REPLY DIRECTION]"), "REPLY DIRECTION block present");
  });

  it("[STRUCTURED USER QUERY] preserves order — includes reply_direction in original position (TG3)", () => {
    const input = {
      ...base(),
      userMessage: "你好【请温柔回应】吗？",
      queryRewrite: mixedQueryRewrite(),
    };
    const ctx = buildPromptContext(input);
    const prompt = ctx.systemPrompt;

    // Structured block must be present (TG3 enables it for direction-only too)
    assert.ok(prompt.includes("[STRUCTURED USER QUERY]"), "STRUCTURED USER QUERY block present");

    // Should contain user speech content
    assert.ok(prompt.includes("[user speech]: 你好"), "structured block contains user_speech");

    // Should NOW contain reply direction content (TG3 order preservation)
    assert.ok(prompt.includes("[reply direction suggestion]:"), "reply_direction included (TG3)");
    assert.ok(prompt.includes("请温柔回应"), "reply_direction text included");

    // Verify order: speech before direction (use lastIndexOf to find block header, not SYSTEM-block backtick refs)
    const suqHeader = prompt.indexOf("[STRUCTURED USER QUERY]\n");
    const bodyAfterHeader = prompt.slice(suqHeader);
    const speechIdx = bodyAfterHeader.indexOf("[user speech]: 你好");
    const dirIdx = bodyAfterHeader.indexOf("[reply direction suggestion]: 请温柔回应");
    assert.ok(speechIdx < dirIdx, "original order preserved — speech before direction");
  });

  it("direction-only message: structured block now includes reply_direction (TG3 order preservation)", () => {
    const input = {
      ...base(),
      userMessage: "【请温柔回应】",
      queryRewrite: directionOnlyQueryRewrite(),
    };
    const ctx = buildPromptContext(input);
    const prompt = ctx.systemPrompt;

    // TG3: structured block is now present because reply_direction lanes are
    // included in the serialized output (order preservation).
    const suqMatch = prompt.match(/\[STRUCTURED USER QUERY\]\n/);
    assert.ok(suqMatch, "STRUCTURED USER QUERY block present (TG3)");
    assert.ok(prompt.includes("[reply direction suggestion]: 请温柔回应"), "direction content in structured block");

    // LABEL RULES block also present
    const rulesMatch = prompt.match(/\[STRUCTURED USER QUERY LABEL RULES\]\n/);
    assert.ok(rulesMatch, "LABEL RULES block present (TG3)");

    // REPLY DIRECTION block should still be present (reinforcement)
    assert.ok(prompt.includes("[REPLY DIRECTION]"), "REPLY DIRECTION present");
  });

  it("fallback path (no 【】) — prompt unchanged, no REPLY DIRECTION block, generationUserMessage undefined", () => {
    // With query rewrite but no 【】 — should behave as before TG1
    const input = {
      ...base(),
      userMessage: "你好吗？",
      queryRewrite: structuredQueryRewrite(),
    };
    const ctx = buildPromptContext(input);

    assert.equal(ctx.generationUserMessage, undefined, "generationUserMessage undefined");
    assert.equal(ctx.systemPrompt.includes("[REPLY DIRECTION]"), false, "no REPLY DIRECTION block");

    // Structured query block uses combined_for_embedding as before
    assert.ok(
      ctx.systemPrompt.includes("[STRUCTURED USER QUERY]\n[user speech] 你好"),
      "structured block uses combined_for_embedding unchanged",
    );
  });

  it("no queryRewrite and no 【】 — baseline unchanged (no structured block, no REPLY DIRECTION)", () => {
    const ctx = buildPromptContext(base());

    assert.equal(ctx.generationUserMessage, undefined, "generationUserMessage undefined");
    assert.equal(ctx.systemPrompt.includes("[REPLY DIRECTION]"), false, "no REPLY DIRECTION block");
    // SYSTEM block has `[STRUCTURED USER QUERY]` in backtick refs, so match block header \n
    const suqMatch = ctx.systemPrompt.match(/\[STRUCTURED USER QUERY\]\n/);
    assert.equal(suqMatch, null, "no structured block");
  });

  it("direction-before-speech preserves order in structured block (TG3 live-sequencing fix)", () => {
    const input = {
      ...base(),
      userMessage: "【处理好葱姜后做菜】谢谢老公~（亲了口左然回去继续认真做菜）",
      queryRewrite: {
        segments: [
          { lane: "reply_direction" as const, text: "处理好葱姜后做菜" },
          { lane: "user_speech" as const, text: "谢谢老公~" },
          { lane: "user_action" as const, text: "亲了口左然回去继续认真做菜" },
        ],
        combined_for_embedding: "[reply direction suggestion]: 处理好葱姜后做菜\n[user speech]: 谢谢老公~\n[user action]: 亲了口左然回去继续认真做菜",
        entities: [], intent: "general" as const, confidence: 0.9,
        structuralParseOk: true, labelOk: true, parseOk: true,
      },
    };
    const ctx = buildPromptContext(input);
    const prompt = ctx.systemPrompt;

    const suqHeader = prompt.indexOf("[STRUCTURED USER QUERY]\n");
    assert.ok(suqHeader >= 0, "STRUCTURED USER QUERY block found");
    const bodyAfterHeader = prompt.slice(suqHeader);

    const lines = bodyAfterHeader.split("\n");
    // lines[0] is "[STRUCTURED USER QUERY]", lines[1] onwards is content
    assert.ok(lines[1]!.includes("[reply direction suggestion]:"), "direction first");
    assert.ok(lines[2]!.includes("[user speech]:"), "speech second");
    assert.ok(lines[3]!.includes("[user action]:"), "action third");

    // Generation-facing user turn still has 【】 stripped
    assert.equal(ctx.generationUserMessage, "谢谢老公~（亲了口左然回去继续认真做菜）");

    // combined_for_embedding is separate from the structured block — verify
    // the structured block uses segment data, not the combined string verbatim
    assert.ok(
      bodyAfterHeader.includes("[reply direction suggestion]: 处理好葱姜后做菜"),
      "structured block content from segments, not combined_for_embedding",
    );

    // REPLY DIRECTION block still present for reinforcement
    assert.ok(prompt.includes("[REPLY DIRECTION]"), "REPLY DIRECTION block present");
    assert.ok(prompt.includes("- 处理好葱姜后做菜"), "direction text in REPLY DIRECTION block");
  });

  it("generationUserMessage survives PromptContextSchema validation (included in schema)", () => {
    // This ensures the field propagates through graph state validation
    const { PromptContextSchema } = require("./buildPromptContext");
    const input = {
      ...base(),
      userMessage: "你好【请温柔回应】吗？",
      queryRewrite: mixedQueryRewrite(),
    };
    const ctx = buildPromptContext(input);
    const parsed = PromptContextSchema.parse(ctx);
    assert.equal(parsed.generationUserMessage, "你好吗？", "generationUserMessage survived Zod parse");
  });

  // ---------------------------------------------------------------------------
  // TG4 4.1 — History reply-direction relabel in conversationHistory
  // ---------------------------------------------------------------------------

  it("relabels 【】 in prior user turns in conversationHistory", () => {
    const input = {
      ...base(),
      userMessage: "test",
      recentTurns: [
        { role: "user" as const, content: "之前的消息【请温柔】哦", turnIndex: 0 },
        { role: "assistant" as const, content: "好的", turnIndex: 1 },
        { role: "user" as const, content: "【只有方向】", turnIndex: 2 },
      ],
    };
    const ctx = buildPromptContext(input);
    const hist = ctx.conversationHistory;

    // User turns: 【】 relabeled
    assert.equal(hist[0]!.role, "user");
    assert.equal(hist[0]!.content, "之前的消息（场外指示：请温柔）哦");

    // Assistant turn: untouched
    assert.equal(hist[1]!.role, "assistant");
    assert.equal(hist[1]!.content, "好的");

    // Direction-only user turn: becomes （场外指示：…）
    assert.equal(hist[2]!.role, "user");
    assert.equal(hist[2]!.content, "（场外指示：只有方向）");
  });

  it("user turn without 【】 unchanged in conversationHistory", () => {
    const input = {
      ...base(),
      userMessage: "test",
      recentTurns: [
        { role: "user" as const, content: "普通消息", turnIndex: 0 },
      ],
    };
    const ctx = buildPromptContext(input);
    assert.equal(ctx.conversationHistory[0]!.content, "普通消息");
  });

  // ---------------------------------------------------------------------------
  // TG1.3 — Generation-facing history sanitizer for assistant turns
  // ---------------------------------------------------------------------------

  it("TG1.3: sanitizes （心想：/（内心：） spans from assistant conversationHistory", () => {
    const input = {
      ...base(),
      userMessage: "test",
      recentTurns: [
        { role: "user" as const, content: "用户消息", turnIndex: 0 },
        { role: "assistant" as const, content: "（心想：分析模式）正文（停顿）继续", turnIndex: 1 },
        { role: "user" as const, content: "另一条用户消息", turnIndex: 2 },
      ],
    };
    const ctx = buildPromptContext(input);
    const hist = ctx.conversationHistory;

    // Assistant turn: 心想 span stripped, action paren preserved
    assert.equal(hist[1]!.role, "assistant");
    assert.equal(hist[1]!.content, "正文（停顿）继续");

    // User turn: unchanged
    assert.equal(hist[0]!.role, "user");
    assert.equal(hist[0]!.content, "用户消息");
  });

  it("TG1.3: preserves short action parentheticals in assistant history", () => {
    const input = {
      ...base(),
      userMessage: "test",
      recentTurns: [
        { role: "assistant" as const, content: "（停顿片刻）他垂下眼。", turnIndex: 0 },
      ],
    };
    const ctx = buildPromptContext(input);
    assert.equal(
      ctx.conversationHistory[0]!.content,
      "（停顿片刻）他垂下眼。",
    );
  });

  it("TG1.3: does not modify user turns — only assistant turns are sanitized", () => {
    const input = {
      ...base(),
      userMessage: "test",
      recentTurns: [
        { role: "user" as const, content: "用户【方向】消息", turnIndex: 0 },
        { role: "assistant" as const, content: "（心想：分析）回复", turnIndex: 1 },
      ],
    };
    const ctx = buildPromptContext(input);
    const hist = ctx.conversationHistory;

    // User turn: still gets the TG4 【】→（场外指示：…）relabel, NOT sanitized
    assert.equal(hist[0]!.role, "user");
    assert.equal(hist[0]!.content, "用户（场外指示：方向）消息");

    // Assistant turn: sanitized
    assert.equal(hist[1]!.role, "assistant");
    assert.equal(hist[1]!.content, "回复");
  });

  // ---------------------------------------------------------------------------
  // TG4 4.2 — TG2 PromptContext fields are populated (review-004 note)
  // ---------------------------------------------------------------------------

  it("TG2 PromptContext fields populate when emotional axis inputs present", () => {
    const savedRender = (env as any).EMOTIONAL_RENDER_ENABLED;
    const savedEngine = (env as any).EMOTIONAL_ENGINE_ENABLED;
    try {
      (env as any).EMOTIONAL_RENDER_ENABLED = true;
      (env as any).EMOTIONAL_ENGINE_ENABLED = true;

      const input = {
        ...base(),
        userMessage: "你好【请温柔回应】吗？",
        queryRewrite: mixedQueryRewrite(),
        emotionalAxisBands: { connection: "mid" as const, valence: "mid" as const, arousal: "low" as const, restraint: "high" as const },
        emotionalAxisLastTrace: {
          tick: 1,
          axesBefore: { connection: 0, valence: 0, arousal: 0, restraint: 0.7 },
          axesAfter: { connection: 0, valence: 0, arousal: -0.1, restraint: 0.7 },
          couplingsFired: [],
          effectiveBaselines: {},
          event: { type: "user_shows_warmth" as const, intensity: 0.6, reason: "用户表达了感谢" },
        },
        emotionalAxisHistory: [],
      };
      const ctx = buildPromptContext(input as any);

      assert.ok(Array.isArray(ctx.replyDirections), "replyDirections is array");
      assert.equal(ctx.replyDirections!.length, 1, "replyDirections has 1 entry");
      assert.equal(ctx.replyDirections![0], "请温柔回应", "replyDirections content");

      assert.ok(typeof ctx.emotionalBandLine === "string", "emotionalBandLine is string");
      assert.ok(ctx.emotionalBandLine!.length > 0, "emotionalBandLine non-empty");

      assert.ok(Array.isArray(ctx.emotionalRenderRuleTexts), "emotionalRenderRuleTexts is array");

      assert.equal(ctx.emotionalLastTraceEvent, "user_shows_warmth", "emotionalLastTraceEvent set");
    } finally {
      (env as any).EMOTIONAL_RENDER_ENABLED = savedRender;
      (env as any).EMOTIONAL_ENGINE_ENABLED = savedEngine;
    }
  });

  it("TG2 PromptContext fields are undefined when no emotional axis data", () => {
    const input = {
      ...base(),
      userMessage: "你好【请温柔回应】吗？",
      queryRewrite: mixedQueryRewrite(),
      // No emotionalAxisBands, emotionalAxisLastTrace, emotionalAxisHistory
    };
    const ctx = buildPromptContext(input);

    assert.ok(Array.isArray(ctx.replyDirections), "replyDirections still array (from extraction)");
    assert.equal(ctx.emotionalBandLine, undefined, "emotionalBandLine undefined without axis data");
    assert.equal(ctx.emotionalRenderRuleTexts, undefined, "emotionalRenderRuleTexts undefined without axis data");
    assert.equal(ctx.emotionalLastTraceEvent, undefined, "emotionalLastTraceEvent undefined without axis data");
  });

  // -----------------------------------------------------------------------
  // TG6 — directorSlimmable exported exact strings
  // -----------------------------------------------------------------------

  const TG6_BANDS = { connection: "high" as const, valence: "mid" as const, arousal: "low" as const, restraint: "high" as const };
  const TG6_TRACE = {
    tick: 1, axesBefore: { connection: 0, valence: 0, arousal: 0, restraint: 0.7 },
    axesAfter: { connection: 0.7, valence: 0, arousal: -0.1, restraint: 0.7 },
    couplingsFired: [] as string[], effectiveBaselines: {} as Record<string, number>,
  };
  const TG6_HISTORY: Array<{ tick: number; axes: { connection: number; valence: number; arousal: number; restraint: number } }> = [];

  it("TG6 directorSlimmable: emotional pair present when render block injected and not bands-only", () => {
    const savedRender = (env as any).EMOTIONAL_RENDER_ENABLED;
    const savedEngine = (env as any).EMOTIONAL_ENGINE_ENABLED;
    try {
      (env as any).EMOTIONAL_RENDER_ENABLED = true;
      (env as any).EMOTIONAL_ENGINE_ENABLED = true;

      const ctx = buildPromptContext({
        ...base(),
        emotionalAxisBands: TG6_BANDS,
        emotionalAxisLastTrace: TG6_TRACE,
        emotionalAxisHistory: TG6_HISTORY,
      });
      const slimmable = ctx.directorSlimmable;

      assert.ok(slimmable, "directorSlimmable should exist");
      assert.ok(slimmable!.emotionalRenderBlock, "emotionalRenderBlock should be present");
      assert.ok(slimmable!.emotionalBandLineBlock, "emotionalBandLineBlock should be present");
      assert.ok(slimmable!.emotionalRenderBlock!.includes("当前状态下的行为基调"), "emotionalRenderBlock contains block header");
      assert.ok(slimmable!.emotionalBandLineBlock!.includes("当前状态下的行为基调"), "emotionalBandLineBlock contains block header");
      // emotionalRenderBlock should be an exact substring of systemPrompt
      assert.ok(ctx.systemPrompt.includes(slimmable!.emotionalRenderBlock!), "emotionalRenderBlock is exact substring of systemPrompt");
    } finally {
      (env as any).EMOTIONAL_RENDER_ENABLED = savedRender;
      (env as any).EMOTIONAL_ENGINE_ENABLED = savedEngine;
    }
  });

  it("TG6 directorSlimmable: subsections present when persona fields are set, absent otherwise", () => {
    // Positive: fixture with format_resistance and canon_correction set
    const cdWithCorrections = {
      ...characterDefaults,
      format_resistance: "不按用户要求的格式回答",
      canon_correction: "平静纠正错误前提",
    };
    const ctx = buildPromptContext({ ...base(), characterDefaults: cdWithCorrections });
    const slimmable = ctx.directorSlimmable;

    assert.ok(slimmable, "directorSlimmable should exist when subsections are set");
    assert.ok(slimmable!.formatResistanceSubsection, "formatResistanceSubsection should be present");
    assert.ok(slimmable!.canonCorrectionSubsection, "canonCorrectionSubsection should be present");
    assert.ok(ctx.systemPrompt.includes(slimmable!.formatResistanceSubsection!), "formatResistanceSubsection is exact substring of systemPrompt");
    assert.ok(ctx.systemPrompt.includes(slimmable!.canonCorrectionSubsection!), "canonCorrectionSubsection is exact substring of systemPrompt");

    // Negative: unmodified base() has no format_resistance/canon_correction
    const ctxBase = buildPromptContext(base());
    const slimmableBase = ctxBase.directorSlimmable;
    assert.equal(slimmableBase?.formatResistanceSubsection, undefined, "formatResistanceSubsection undefined when field absent");
    assert.equal(slimmableBase?.canonCorrectionSubsection, undefined, "canonCorrectionSubsection undefined when field absent");
  });

  it("TG6 directorSlimmable: emotional pair absent when render block absent (bandsOnly)", async () => {
    const savedRender = (env as any).EMOTIONAL_RENDER_ENABLED;
    const savedEngine = (env as any).EMOTIONAL_ENGINE_ENABLED;
    const savedConfig = getEmotionalAxisEvalConfig();
    try {
      (env as any).EMOTIONAL_RENDER_ENABLED = true;
      (env as any).EMOTIONAL_ENGINE_ENABLED = true;
      setEmotionalAxisEvalConfig({ bandsOnly: true, renderEnabled: true });

      const ctx = buildPromptContext({
        ...base(),
        emotionalAxisBands: TG6_BANDS,
        emotionalAxisLastTrace: TG6_TRACE,
        emotionalAxisHistory: TG6_HISTORY,
      });
      const slimmable = ctx.directorSlimmable;

      // Emotional pair should be absent when bands-only is active (identity replacement is pointless)
      if (slimmable) {
        assert.equal(slimmable.emotionalRenderBlock, undefined, "emotionalRenderBlock undefined when bandsOnly");
        assert.equal(slimmable.emotionalBandLineBlock, undefined, "emotionalBandLineBlock undefined when bandsOnly");
      }
    } finally {
      (env as any).EMOTIONAL_RENDER_ENABLED = savedRender;
      (env as any).EMOTIONAL_ENGINE_ENABLED = savedEngine;
      resetEmotionalAxisEvalConfig();
    }
  });

  it("TG2 directorSlimmable: temporalPremiseBlock present when canon narrative injected, absent when no canon", () => {
    // Positive: explicitly set canon data so hasCanonNarrative is true
    const inputWithCanon = {
      ...base(),
      canonChunks: [{ id: "c1", textContent: "Some canon text.", sceneId: "s1", canonPriority: 1 }] as any,
    };
    const ctx = buildPromptContext(inputWithCanon);
    const slimmable = ctx.directorSlimmable;
    assert.ok(slimmable, "directorSlimmable should exist with canon");
    assert.ok(slimmable!.temporalPremiseBlock, "temporalPremiseBlock should be present with canon");
    assert.ok(ctx.systemPrompt.includes(slimmable!.temporalPremiseBlock!), "temporalPremiseBlock is exact substring of systemPrompt");
    assert.ok(slimmable!.temporalPremiseBlock!.startsWith("[TEMPORAL PREMISE HANDLING]"), "block header is TEMPORAL PREMISE HANDLING");

    // Negative: no canon → no temporalPremiseBlock
    const ctxNoCanon = buildPromptContext({ ...base(), canonChunks: [], canonScenes: [] });
    const slimmableNoCanon = ctxNoCanon.directorSlimmable;
    assert.equal(slimmableNoCanon?.temporalPremiseBlock, undefined, "temporalPremiseBlock undefined when no canon");
  });

  it("TG6 directorSlimmable: survives PromptContextSchema validation round-trip", () => {
    const sample: any = {
      systemPrompt: "test",
      conversationHistory: [],
      directorSlimmable: {
        emotionalRenderBlock: "[当前状态下的行为基调]\ntest",
        emotionalBandLineBlock: "[当前状态下的行为基调]\nband line",
        formatResistanceSubsection: "[格式抗性]\ntest",
      },
      directorSlimmedBlocks: ["emotional_render"],
    };
    const parsed = PromptContextSchema.parse(sample);
    assert.ok(parsed.directorSlimmable, "directorSlimmable survives schema");
    assert.equal(parsed.directorSlimmable.emotionalRenderBlock, "[当前状态下的行为基调]\ntest");
    assert.ok(parsed.directorSlimmedBlocks, "directorSlimmedBlocks survives schema");
    assert.equal(parsed.directorSlimmedBlocks![0], "emotional_render");
  });
});
