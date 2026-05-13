import { z } from "zod";
import { models } from "../config/models";
import { env } from "../config/env";
import { chatJson } from "./providers";
import { scoreMemoryImportance } from "../memory/scoreMemoryImportance";
import type { MemoryCandidate } from "../memory/writeInteractiveMemory";
import type { RawImportanceComponents } from "../memory/scoreMemoryImportance";
import { embedText } from "./embedText";
import type { StructMemPersistRow } from "../memory/structmemMapping";

export interface PostTurnSignals {
  memoryFacts: MemoryCandidate[];
  /**
   * Native StructMem rows (current_session only, embedded) when STRUCTMEM_NATIVE_EXTRACTOR is on.
   * Empty when the flag is off (Phase 1) to avoid extra embed calls.
   */
  structMemEntries: StructMemPersistRow[];
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

const StructMemEntryTypeSchema = z.enum([
  "factual",
  "relational",
  "scene_moment",
  "decision",
  "emotional_shift",
  "open_thread",
]);

const StructMemMetadataSchema = z
  .record(z.string(), z.unknown())
  .optional()
  .refine((m) => m == null || Object.keys(m).length <= 24, {
    message: "metadata has at most 24 keys",
  });

const StructMemEntryItemSchema = z.object({
  entry_type: StructMemEntryTypeSchema,
  text: z
    .string()
    .transform((s) => s.trim())
    .pipe(z.string().min(1, "structmem text must be non-empty")),
  memory_scope: z.enum(["cross_session", "current_session"]),
  emotional_weight: z.coerce.number().min(0).max(1).optional(),
  plot_relevance: z.coerce.number().min(0).max(1).optional(),
  cross_session_durability: z.coerce.number().min(0).max(1).optional(),
  confidence_score: z.coerce.number().min(0).max(1).optional(),
  embedding: z.array(z.number()).optional(),
  metadata: StructMemMetadataSchema,
});

export const ExtractorOutputSchema = z.object({
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
  structmem_entries: z.array(StructMemEntryItemSchema).max(6).default([]),
  confidence: z.coerce.number().default(0),
});

const EXTRACTOR_SYSTEM = `You are a memory extraction classifier for a character roleplay system.
Given the last user message and the character's reply, extract any notable events worth persisting.

Grounding rules (must follow for every memory candidate summary and every structmem_entries line):
- Each "summary" / structmem "text" must describe ONLY what is supported by the quoted User message and Character reply below. Do not add people, activities, objects, or outcomes that do not appear in those two strings (e.g. do not substitute 看电影 if they only discussed 演唱会 or a vague 去看).
- The blocks "Recent memories" and "Session state" are optional context for judging durability and tone. They MUST NOT be copied into outputs and MUST NOT introduce facts. If a detail exists only there, omit it.
- Write in Chinese. Attribute actions clearly: use "用户" for the human player line and 角色名 (如 左然) for the playable character line (the Character reply). Do not swap who did what. Refusals, deflections, or policy lines spoken in the Character reply belong to 角色, not to 用户, unless the User message shows 用户 refusing.
- Prefer concrete wording from the two quoted messages when available (names, 门票, 演唱会, etc.).

## memory_candidates (IME + legacy session chunks)
For EACH candidate choose memory_scope:
- "cross_session" — preference / promise / relationship milestone / recurring pattern likely to matter in future chats (stored in durable interactive_memory_events namespace).
- "current_session" — scene beat, motif, unresolved thread, emotion shift meaningful only INSIDE THIS SESSION.

Also set session_chunk_type when memory_scope is "current_session":
"scene_moment" | "decision" | "emotional_shift" | "open_thread" (omit for cross_session).

## structmem_entries (structured session recall; at most 6 items)
Add zero or more objects for this-session structured memory. Each item:
- "entry_type": "factual" | "relational" | "scene_moment" | "decision" | "emotional_shift" | "open_thread"
  - factual: what happened, stated preference, explicit decision, promise wording (one short grounded line).
  - relational: trust, reassurance dynamic, tension, intimacy shift, dependency (one short grounded line).
  - scene_moment | decision | emotional_shift | open_thread: same meaning as session_chunk_type above.
- "text": one short Chinese line, same grounding as summaries.
- "memory_scope": use "current_session" for anything that should be stored in StructMem tables. Use "cross_session" only to echo durable-worthy notes — those durable facts MUST still appear in memory_candidates with memory_scope "cross_session"; the server ignores cross_session structmem_entries for DB (you may omit cross_session structmem_entries entirely; preferred).

Optional per-item scores (0–1): emotional_weight, plot_relevance, cross_session_durability, confidence_score. Optional metadata object (≤24 keys).

Return ONLY valid JSON in this shape:
{
  "memory_candidates": [ ... ],
  "structmem_entries": [
    {
      "entry_type": "factual" | "relational" | "scene_moment" | "decision" | "emotional_shift" | "open_thread",
      "text": "…",
      "memory_scope": "current_session" | "cross_session",
      "emotional_weight": 0.0-1.0,
      "plot_relevance": 0.0-1.0,
      "cross_session_durability": 0.0-1.0,
      "confidence_score": 0.0-1.0,
      "metadata": {}
    }
  ],
  "confidence": 0.0-1.0
}

Prefer cross_session in memory_candidates only when justified by durability. Use current_session in structmem_entries for rich this-session retrieval.

If nothing worth storing occurred, return empty memory_candidates and structmem_entries arrays.`;

/** Default importance components when the model omits per-item scores (Phase 2 native path). */
const NATIVE_STRUCTMEM_DEFAULT_COMPONENTS: RawImportanceComponents = {
  emotionalWeight: 0.45,
  plotRelevance: 0.45,
  crossSessionDurability: 0.2,
  memoryType: "banter",
};

async function buildNativeStructMemPersistRows(
  items: z.infer<typeof StructMemEntryItemSchema>[],
): Promise<StructMemPersistRow[]> {
  const currentOnly = items.filter((r) => r.memory_scope === "current_session");
  const rows: StructMemPersistRow[] = [];
  for (const raw of currentOnly) {
    const components: RawImportanceComponents = {
      emotionalWeight:
        raw.emotional_weight ?? NATIVE_STRUCTMEM_DEFAULT_COMPONENTS.emotionalWeight,
      plotRelevance:
        raw.plot_relevance ?? NATIVE_STRUCTMEM_DEFAULT_COMPONENTS.plotRelevance,
      crossSessionDurability:
        raw.cross_session_durability ??
        NATIVE_STRUCTMEM_DEFAULT_COMPONENTS.crossSessionDurability,
      memoryType: "banter",
    };
    const importanceScore = scoreMemoryImportance(components);

    let embedding: number[];
    const dim = env.EMBEDDING_DIMENSIONS;
    if (
      raw.embedding &&
      raw.embedding.length === dim &&
      raw.embedding.every((n) => Number.isFinite(n))
    ) {
      embedding = raw.embedding;
    } else {
      embedding = await embedText(raw.text);
    }

    const confidenceScore =
      raw.confidence_score !== undefined && raw.confidence_score !== null
        ? raw.confidence_score
        : null;

    const meta =
      raw.metadata && typeof raw.metadata === "object"
        ? { ...raw.metadata }
        : undefined;

    rows.push({
      entryType: raw.entry_type,
      text: raw.text,
      embedding,
      importanceScore,
      confidenceScore,
      metadata: meta,
    });
  }
  return rows;
}

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
      structMemEntries: [],
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

  const structMemEntries =
    env.STRUCTMEM_NATIVE_EXTRACTOR && env.STRUCTMEM_ENABLED
      ? await buildNativeStructMemPersistRows(
          parsed.structmem_entries ?? [],
        )
      : [];

  return {
    memoryFacts,
    structMemEntries,
    emotionalDelta: null,
    modelReportedConfidence: {
      memoryFacts: parsed.confidence ?? 0,
      emotionalDelta: 0,
    },
  };
}
