import { getProvider } from "./providers";
import { models } from "../config/models";
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

interface RawMemoryCandidate {
  memory_type: MemoryCandidate["memoryType"];
  summary: string;
  emotional_weight: number;
  plot_relevance: number;
  cross_session_durability: number;
  emotion_score: number;
  tags?: string[];
}

interface ExtractorOutput {
  memory_candidates: RawMemoryCandidate[];
  confidence: number;
}

const EXTRACTOR_SYSTEM = `You are a memory extraction classifier for a character roleplay system.
Given the last user message and the character's reply, extract any events worth storing as long-term memories.

Return ONLY valid JSON in this shape:
{
  "memory_candidates": [
    {
      "memory_type": "promise" | "relationship_transition" | "preference" | "habit" | "banter",
      "summary": "One-sentence description of the memory (in Chinese)",
      "emotional_weight": 0.0-1.0,
      "plot_relevance": 0.0-1.0,
      "cross_session_durability": 0.0-1.0,
      "emotion_score": 0.0-1.0,
      "tags": ["optional", "tags"]
    }
  ],
  "confidence": 0.0-1.0
}

Only include memories that meet at least one of these criteria:
- High emotional importance
- Changes what the character knows or has agreed to
- Reveals a stable user preference
- Involves a promise, confession, betrayal, or relationship transition
- Creates a durable shared event likely to matter across sessions

If nothing worth storing occurred, return an empty memory_candidates array.`;

export async function extractPostTurnSignals(
  input: ExtractSignalsInput,
): Promise<PostTurnSignals> {
  const provider = getProvider(models.extractor);

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

  const response = await provider.chat(
    [
      { role: "system", content: EXTRACTOR_SYSTEM },
      { role: "user", content: userMessage },
    ],
    { maxTokens: 1024, temperature: 0.3, jsonMode: true },
  );

  let parsed: ExtractorOutput = { memory_candidates: [], confidence: 0 };
  try {
    parsed = JSON.parse(response.content) as ExtractorOutput;
  } catch {
    // silently discard parse failures — no memory written
  }

  const memoryFacts: MemoryCandidate[] = await Promise.all(
    (parsed.memory_candidates ?? []).map(async (raw) => {
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
