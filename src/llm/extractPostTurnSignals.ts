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
      "summary": "One-sentence description (in Chinese)",
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

Recent memories for context:
${input.recentMemories || "(none)"}

Session state:
${input.sessionState}

User message:
"${input.userMessage}"

Character reply:
"${input.assistantReply}"

Extract memory candidates.`.trim();

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
