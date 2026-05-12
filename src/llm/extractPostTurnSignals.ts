import { z } from "zod";
import { models } from "../config/models";
import { chatJson } from "./providers";
import { scoreMemoryImportance } from "../memory/scoreMemoryImportance";
import type { MemoryCandidate } from "../memory/writeInteractiveMemory";
import type { RawImportanceComponents } from "../memory/scoreMemoryImportance";
import { embedText } from "./embedText";

export interface PostTurnSignals {
  memoryFacts: MemoryCandidate[];
  emotionalDelta: null; // Phase 1: always null (Phase 3 adds delta)
  modelReportedConfidence: {
    memoryFacts: number;
    emotionalDelta: number;
  };
}

export interface ExtractSignalsInput {
  userMessage: string;
  assistantReply: string;
  sessionMode: string;
  recentMemories: string;
  sessionState: string;
}

const MemoryTypeSchema = z.enum([
  "promise",
  "relationship_transition",
  "preference",
  "habit",
  "banter",
]);

const SessionChunkExtractorTypeSchema = z.enum([
  "scene_moment",
  "decision",
  "emotional_shift",
  "open_thread",
]);

const ExtractorOutputSchema = z.object({
  memory_candidates: z.array(
    z.object({
      memory_type: MemoryTypeSchema,
      summary: z.string(),
      emotional_weight: z.coerce.number().default(0),
      plot_relevance: z.coerce.number().default(0),
      cross_session_durability: z.coerce.number().default(0),
      emotion_score: z.coerce.number().default(0),
      tags: z.array(z.string()).optional(),
      memory_scope: z.enum(["cross_session", "current_session"]).optional(),
      session_chunk_type: SessionChunkExtractorTypeSchema.optional(),
    }),
  ),
  confidence: z.coerce.number().default(0),
});

const EXTRACTOR_SYSTEM = `You are a memory extraction classifier for a character roleplay system.
Given the last user message and the character's reply, extract any notable events worth persisting.

Grounding rules (must follow for every candidate):
- Each "summary" must describe ONLY what is supported by the quoted User message and Character reply below. Do not add people, activities, objects, or outcomes that do not appear in those two strings (e.g. do not substitute 看电影 if they only discussed 演唱会 or a vague 去看).
- The blocks "Recent memories" and "Session state" are optional context for judging durability and tone. They MUST NOT be copied into summaries and MUST NOT introduce facts into summaries. If a detail exists only there, omit it from the summary.
- Write summaries in Chinese. Attribute actions clearly: use "用户" for the human player line and 角色名 (如 左然) for the playable character line (the Character reply). Do not swap who did what. Refusals, deflections, or policy lines spoken in the Character reply belong to 角色, not to 用户, unless the User message shows 用户 refusing.
- Prefer concrete wording from the two quoted messages when available (names, 门票, 演唱会, etc.).

For EACH candidate choose memory_scope:
- "cross_session" — preference / promise / relationship milestone / recurring pattern likely to matter in future chats (stored in durable interactive_memory_events namespace).
- "current_session" — scene beat, motif, unresolved thread, emotion shift meaningful only INSIDE THIS SESSION (indexed as session-local recall chunks; do NOT spam cross_session).

Also set session_chunk_type when memory_scope is "current_session":
"scene_moment" | "decision" | "emotional_shift" | "open_thread" (omit for cross_session).

Return ONLY valid JSON in this shape:
{
  "memory_candidates": [
    {
      "memory_type": "promise" | "relationship_transition" | "preference" | "habit" | "banter",
      "summary": "One-sentence Chinese description; 用户/角色 attribution; grounded in the two quoted turns only",
      "emotional_weight": 0.0-1.0,
      "plot_relevance": 0.0-1.0,
      "cross_session_durability": 0.0-1.0,
      "emotion_score": 0.0-1.0,
      "tags": ["optional", "tags"],
      "memory_scope": "cross_session" | "current_session",
      "session_chunk_type": "scene_moment" | ...
    }
  ],
  "confidence": 0.0-1.0
}

Prefer cross_session only when justified by durability. Use current_session liberally for rich this-session retrieval without polluting durable memory.

If nothing worth storing occurred, return an empty memory_candidates array.`;


export async function extractPostTurnSignals(
  input: ExtractSignalsInput,
): Promise<PostTurnSignals> {
  const userMessage = `
Session mode: ${input.sessionMode}

Recent memories (retrieval context only — do not import their facts into summaries):
${input.recentMemories || "(none)"}

Session state (hints only — do not invent facts from it):
${input.sessionState}

User message (this turn — primary source for 用户):
"${input.userMessage}"

Character reply (this turn — primary source for 角色):
"${input.assistantReply}"

Extract memory candidates; summaries must follow the grounding rules.`.trim();

  const result = await chatJson(
    models.extractor,
    [
      { role: "system", content: EXTRACTOR_SYSTEM },
      { role: "user", content: userMessage },
    ],
    ExtractorOutputSchema,
    { maxTokens: 2048, temperature: 0.3 },
  );

  if (!result.ok) {
    console.warn(
      "[extractPostTurnSignals] chatJson failed; no memories extracted.",
      result.error,
    );
    return {
      memoryFacts: [],
      emotionalDelta: null,
      modelReportedConfidence: {
        memoryFacts: 0,
        emotionalDelta: 0,
      },
    };
  }

  const parsed = result.data;

  const memoryFacts: MemoryCandidate[] = await Promise.all(
    parsed.memory_candidates.map(async (raw) => {
      const components: RawImportanceComponents = {
        emotionalWeight: raw.emotional_weight ?? 0,
        plotRelevance: raw.plot_relevance ?? 0,
        crossSessionDurability: raw.cross_session_durability ?? 0,
        memoryType: raw.memory_type ?? "banter",
      };
      const importanceScore = scoreMemoryImportance(components);
      const embedding = await embedText(raw.summary);
      return {
        memoryType: raw.memory_type,
        summary: raw.summary,
        importanceScore,
        emotionScore: raw.emotion_score ?? 0,
        tags: raw.tags,
        embedding,
        memoryScope:
          (raw.memory_scope ?? "cross_session") === "current_session"
            ? "current_session"
            : "cross_session",
        ...((raw.memory_scope ?? "cross_session") === "current_session" &&
        raw.session_chunk_type
          ? { sessionChunkType: raw.session_chunk_type }
          : {}),
      };
    }),
  );

  return {
    memoryFacts,
    emotionalDelta: null,
    modelReportedConfidence: {
      memoryFacts: parsed.confidence ?? 0,
      emotionalDelta: 0,
    },
  };
}
