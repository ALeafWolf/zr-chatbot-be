import { v4 as uuidv4 } from "uuid";
import { db } from "../../db/client";
import { chatMessages, chatSessions, sessionState } from "../../db/schema/chat";
import {
  interactiveMemoryEvents,
  sessionMemoryChunks,
  sessionSummaries,
} from "../../db/schema/memory";
import {
  structmemConsolidations,
  structmemEntries,
  structmemEvents,
} from "../../db/schema/structmem";
import { env } from "../../config/env";
import { buildMemoryNamespace } from "../../memory/shared/memoryNamespace";
import { embedText } from "../../llm/embeddings/embedText";
import type {
  AgentEvalInput,
  EvalSeedMessage,
  EvalSeededSession,
  EvalStructMemEntrySeed,
} from "./evalTypes";

function safeIdPart(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9_-]+/g, "_").slice(0, 48);
}

async function embeddingFor(text: string, provided?: number[]): Promise<number[]> {
  return provided ?? (await embedText(text));
}

function normalizedMessages(messages: EvalSeedMessage[] | undefined): Array<
  Required<Pick<EvalSeedMessage, "role" | "content" | "turnIndex">> & {
    id: string;
  }
> {
  return (messages ?? []).map((message, index) => ({
    id: message.id ?? uuidv4(),
    role: message.role,
    content: message.content,
    turnIndex: message.turnIndex ?? index + 1,
  }));
}

function defaultDerivedState(): Record<string, string> {
  return {
    inferredMood: "neutral",
    inferredActivity: "chatting",
    conversationalStance: "present",
  };
}

async function seedStructMemEntries(input: {
  sessionId: string;
  characterId: string;
  playerId: string;
  memoryNamespace: string;
  continuityScope: string;
  continuityFamily: string;
  mode: string;
  entries: EvalStructMemEntrySeed[];
}): Promise<void> {
  if (input.entries.length === 0) return;
  const eventId = input.entries[0]?.eventId ?? uuidv4();
  const latestTurn = Math.max(
    1,
    ...input.entries.map((entry) => entry.turnIndex ?? 1),
  );
  await db.insert(structmemEvents).values({
    id: eventId,
    sessionId: input.sessionId,
    characterId: input.characterId,
    playerId: input.playerId,
    memoryNamespace: input.memoryNamespace,
    continuityScope: input.continuityScope,
    continuityFamily: input.continuityFamily,
    turnIndex: latestTurn,
    mode: input.mode,
    metadata: { source: "eval_seed" },
  });

  for (const entry of input.entries) {
    await db.insert(structmemEntries).values({
      id: entry.id ?? uuidv4(),
      eventId,
      sessionId: input.sessionId,
      characterId: input.characterId,
      playerId: input.playerId,
      memoryNamespace: input.memoryNamespace,
      turnIndex: entry.turnIndex ?? latestTurn,
      entryType: entry.entryType ?? "scene_moment",
      text: entry.text,
      embedding: await embeddingFor(entry.text, entry.embedding),
      importanceScore: entry.importanceScore ?? 0.7,
      confidenceScore: entry.confidenceScore ?? 0.8,
      metadata: { source: "eval_seed", ...(entry.metadata ?? {}) },
    });
  }
}

export async function seedEvalSession(
  input: AgentEvalInput,
): Promise<EvalSeededSession> {
  const scenarioId = input.scenarioId;
  const sessionId = `eval_${safeIdPart(scenarioId)}_${uuidv4()}`;
  const playerId = `eval_${safeIdPart(scenarioId)}_${uuidv4()}`;
  const continuityFamily = input.sessionSeed.continuityFamily ?? "main_world";
  const characterId = input.sessionSeed.characterId ?? env.DEFAULT_CHARACTER_ID;
  const memoryNamespace = buildMemoryNamespace({
    continuityFamily,
    scope: input.sessionSeed.continuityScope,
    auWorldKey: input.sessionSeed.auWorldKey,
    playerId,
  });
  const messages = normalizedMessages(input.recentMessages);
  const maxSeededTurnIndex = Math.max(0, ...messages.map((m) => m.turnIndex));
  const now = new Date();

  await db.insert(chatSessions).values({
    sessionId,
    characterId,
    playerId,
    mode: input.sessionSeed.mode,
    continuityScope: input.sessionSeed.continuityScope,
    continuityFamily,
    personaOverlayId:
      input.sessionSeed.personaOverlayId ??
      input.sessionSeed.continuityScope,
    memoryNamespace,
    pinnedTime: input.sessionSeed.pinnedTime ?? null,
    pinnedLocation: input.sessionSeed.pinnedLocation ?? null,
    writebackPolicy: input.sessionSeed.writebackPolicy ?? "no_writeback",
    sessionSummary: input.sessionSummary ?? null,
    displayTitle: input.sessionSeed.displayTitle ?? `eval:${scenarioId}`,
    thinking: input.sessionSeed.thinking ?? env.DEFAULT_SESSION_THINKING,
    temperature:
      input.sessionSeed.temperature ?? env.DEFAULT_SESSION_TEMPERATURE,
    createdAt: now,
    updatedAt: now,
  });

  await db.insert(sessionState).values({
    sessionId,
    derivedState: input.sessionState ?? defaultDerivedState(),
    lastTurnIndex: maxSeededTurnIndex,
    updatedAt: now,
  });

  if (messages.length > 0) {
    await db.insert(chatMessages).values(
      messages.map((message) => ({
        id: message.id,
        sessionId,
        turnIndex: message.turnIndex,
        role: message.role,
        content: message.content,
        thoughts: null,
        validatorResult: null,
      })),
    );
  }

  if (input.sessionSummary) {
    await db.insert(sessionSummaries).values({
      id: uuidv4(),
      sessionId,
      characterId,
      playerId,
      lastSummarizedTurnIndex: maxSeededTurnIndex,
      summaryJson: input.sessionState ?? {},
      summaryText: input.sessionSummary,
      createdAt: now,
      updatedAt: now,
    });
  }

  for (const memory of input.durableMemories ?? []) {
    await db.insert(interactiveMemoryEvents).values({
      id: memory.id ?? uuidv4(),
      characterId,
      playerId,
      sessionId,
      continuityScope: input.sessionSeed.continuityScope,
      continuityFamily,
      memoryNamespace,
      isInheritable: false,
      memoryType: memory.memoryType ?? "preference",
      summary: memory.summary,
      importanceScore: memory.importanceScore ?? 0.8,
      emotionScore: memory.emotionScore ?? 0,
      recencyScore: 1,
      tags: memory.tags ?? null,
      embedding: await embeddingFor(memory.summary, memory.embedding),
      canonicalToChat: false,
    });
  }

  for (const chunk of input.sessionChunks ?? []) {
    await db.insert(sessionMemoryChunks).values({
      id: chunk.id ?? uuidv4(),
      sessionId,
      characterId,
      playerId,
      turnStart: chunk.turnStart ?? Math.max(1, maxSeededTurnIndex - 1),
      turnEnd: chunk.turnEnd ?? Math.max(1, maxSeededTurnIndex),
      chunkText: chunk.chunkText,
      chunkType: chunk.chunkType ?? "scene_moment",
      metadata: { source: "eval_seed", ...(chunk.metadata ?? {}) },
      embedding: await embeddingFor(chunk.chunkText, chunk.embedding),
    });
  }

  await seedStructMemEntries({
    sessionId,
    characterId,
    playerId,
    memoryNamespace,
    continuityScope: input.sessionSeed.continuityScope,
    continuityFamily,
    mode: input.sessionSeed.mode,
    entries: input.structMemEntries ?? [],
  });

  for (const item of input.structMemConsolidations ?? []) {
    await db.insert(structmemConsolidations).values({
      id: item.id ?? uuidv4(),
      sessionId,
      characterId,
      playerId,
      memoryNamespace,
      scope: item.scope ?? "current_session",
      summaryText: item.summaryText,
      summaryJson: { source: "eval_seed", ...(item.summaryJson ?? {}) },
      embedding: await embeddingFor(item.summaryText, item.embedding),
      turnStart: item.turnStart ?? null,
      turnEnd: item.turnEnd ?? null,
      confidenceScore: item.confidenceScore ?? 0.8,
      promotionStatus: "none",
    });
  }

  return {
    scenarioId,
    sessionId,
    playerId,
    memoryNamespace,
    maxSeededTurnIndex,
    seededMessageIds: messages.map((message) => message.id),
  };
}
