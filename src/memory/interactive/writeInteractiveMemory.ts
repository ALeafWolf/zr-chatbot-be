import { v4 as uuidv4 } from "uuid";
import { db } from "../../db/client";
import { interactiveMemoryEvents } from "../../db/schema/memory";
import type { NewInteractiveMemoryEvent } from "../../db/schema/memory";
import {
  type MemoryNamespace,
  assertNamespaceMatchesFamily,
} from "../shared/memoryNamespace";
import { deduplicateMemory } from "./deduplicateMemory";
import { MEMORY_IMPORTANCE_THRESHOLD } from "../../character/canonRules";

export type MemoryScope = "cross_session" | "current_session";

/** When `memoryScope` is `current_session`, written to session_memory_chunks instead of IME. */
export type ExtractorSessionChunkType =
  | "scene_moment"
  | "decision"
  | "emotional_shift"
  | "open_thread";

export interface MemoryCandidate {
  memoryType: "promise" | "relationship_transition" | "preference" | "habit" | "banter";
  summary: string;
  importanceScore: number;
  emotionScore: number;
  tags?: string[];
  embedding: number[];
  /** Routing (Phase 4). Durable writes require explicit cross_session. */
  memoryScope?: MemoryScope;
  /** Per-turn session chunk subtype when routed to session_memory_chunks. */
  sessionChunkType?: ExtractorSessionChunkType;
}

export interface WriteMemoryInput {
  candidate: MemoryCandidate;
  characterId: string;
  playerId: string;
  sessionId: string;
  continuityScope: string;
  continuityFamily: "main_world" | "au";
  memoryNamespace: MemoryNamespace;
}

/**
 * Persists a memory candidate if it clears the importance threshold.
 * Runs deduplication first — updates existing row if near-identical.
 *
 * Repository guard: throws if the namespace does not match the
 * session's continuity family, preventing AU/main-world cross-writes.
 */
export async function writeInteractiveMemory(
  input: WriteMemoryInput,
): Promise<"written" | "deduplicated" | "below_threshold"> {
  const {
    candidate,
    characterId,
    playerId,
    sessionId,
    continuityScope,
    continuityFamily,
    memoryNamespace,
  } = input;

  // Repository guard — compile-time branded type enforces path; runtime guard adds defence-in-depth
  assertNamespaceMatchesFamily(memoryNamespace, continuityFamily);

  if (candidate.importanceScore < MEMORY_IMPORTANCE_THRESHOLD) {
    return "below_threshold";
  }

  const deduped = await deduplicateMemory({
    embedding: candidate.embedding,
    namespace: memoryNamespace,
    characterId,
  });

  if (deduped) {
    return "deduplicated";
  }

  const row: NewInteractiveMemoryEvent = {
    id: uuidv4(),
    characterId,
    playerId,
    sessionId,
    continuityScope,
    continuityFamily,
    memoryNamespace,
    isInheritable: false,
    memoryType: candidate.memoryType,
    summary: candidate.summary,
    importanceScore: candidate.importanceScore,
    emotionScore: candidate.emotionScore,
    recencyScore: 1.0,
    tags: candidate.tags ?? null,
    embedding: candidate.embedding,
    canonicalToChat: false,
  };

  await db.insert(interactiveMemoryEvents).values(row);
  return "written";
}
