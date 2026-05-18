import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildPromptContext } from "./buildPromptContext";
import type { ChatSession } from "../db/schema/chat";
import type { CharacterDefaults, PersonaOverlayDefaults } from "../character/characterDefaults";

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
          { id: "session_summary", source: "session_summary", reason: "irrelevant_to_current_turn" },
          { id: "latest_turn_delta", source: "latest_turn_delta", reason: "irrelevant_to_current_turn" },
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
    assert.equal(prompt.includes("[SELECTED CONTEXT USAGE]"), false, "SELECTED CONTEXT USAGE should be absent when selected is empty");
  });
});
