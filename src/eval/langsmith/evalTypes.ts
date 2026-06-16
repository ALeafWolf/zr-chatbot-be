import type { MemoryCandidate } from "../../memory/interactive/writeInteractiveMemory";
import type { SessionChunkTypePersisted } from "../../memory/session/writeSessionMemoryChunk";

import type { PersistedAxisState } from "../../state/emotionalEngine/types";

export interface AgentEvalInput {
  scenarioId: string;
  userMessage: string;
  description?: string;
  sessionSeed: EvalSessionSeed;
  recentMessages?: EvalSeedMessage[];
  sessionSummary?: string;
  sessionState?: Record<string, unknown>;
  /** TG1: Deterministic axis state seed written to session_state.local_relationship_delta.axis_state before runCharacterTurn. */
  seedAxisState?: PersistedAxisState;
  durableMemories?: EvalDurableMemorySeed[];
  sessionChunks?: EvalSessionChunkSeed[];
  structMemEntries?: EvalStructMemEntrySeed[];
  structMemConsolidations?: EvalStructMemConsolidationSeed[];
  canonReferenceIds?: string[];
  configOverrides?: Record<string, unknown>;
}

export interface EvalSessionSeed {
  characterId?: string;
  mode: string;
  continuityScope: string;
  continuityFamily?: "main_world" | "au";
  auWorldKey?: string;
  writebackPolicy?: string;
  thinking?: boolean;
  temperature?: number;
  personaOverlayId?: string | null;
  displayTitle?: string | null;
  pinnedTime?: string | null;
  pinnedLocation?: string | null;
}

export interface EvalSeedMessage {
  id?: string;
  role: "user" | "assistant";
  content: string;
  turnIndex?: number;
}

export interface EvalDurableMemorySeed {
  id?: string;
  memoryType?: MemoryCandidate["memoryType"];
  summary: string;
  importanceScore?: number;
  emotionScore?: number;
  tags?: string[];
  embedding?: number[];
}

export interface EvalSessionChunkSeed {
  id?: string;
  turnStart?: number;
  turnEnd?: number;
  chunkText: string;
  chunkType?: SessionChunkTypePersisted;
  metadata?: Record<string, unknown>;
  embedding?: number[];
}

export interface EvalStructMemEntrySeed {
  id?: string;
  eventId?: string;
  turnIndex?: number;
  entryType?: string;
  text: string;
  importanceScore?: number | null;
  confidenceScore?: number | null;
  metadata?: Record<string, unknown>;
  embedding?: number[];
}

export interface EvalStructMemConsolidationSeed {
  id?: string;
  scope?: "current_session" | "cross_session";
  summaryText: string;
  summaryJson?: Record<string, unknown>;
  turnStart?: number | null;
  turnEnd?: number | null;
  confidenceScore?: number | null;
  embedding?: number[];
}

export interface EvalSeededSession {
  scenarioId: string;
  sessionId: string;
  playerId: string;
  memoryNamespace: string;
  maxSeededTurnIndex: number;
  seededMessageIds: string[];
}

export interface EvalCleanupResult {
  attempted: boolean;
  completed: boolean;
  error?: string;
}
