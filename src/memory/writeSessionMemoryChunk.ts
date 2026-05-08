import { v4 as uuidv4 } from "uuid";
import { db } from "../db/client";
import {
  sessionMemoryChunks,
  type SessionMemoryChunk,
} from "../db/schema/memory";
import { embedText } from "../llm/embedText";
import { traceStage } from "../observability/langsmithTracing";
import type { ChatSession } from "../db/schema/chat";

export type SessionChunkTypePersisted =
  | "raw_turn_pair"
  | "scene_moment"
  | "decision"
  | "emotional_shift"
  | "open_thread";

export async function persistSessionMemoryChunk(input: {
  sessionId: string;
  characterId: string;
  playerId: string;
  turnStart: number;
  turnEnd: number;
  chunkText: string;
  chunkType: SessionChunkTypePersisted;
  metadata?: Record<string, unknown>;
  /** When set (e.g. extractor-precomputed embedding), skips embedText round-trip. */
  embedding?: number[];
}): Promise<{ id: string; chunk: SessionMemoryChunk }> {
  const id = uuidv4();
  const embedding =
    input.embedding ??
    (await embedText(input.chunkText));
  const [row] = await db
    .insert(sessionMemoryChunks)
    .values({
      id,
      sessionId: input.sessionId,
      characterId: input.characterId,
      playerId: input.playerId,
      turnStart: input.turnStart,
      turnEnd: input.turnEnd,
      chunkText: input.chunkText,
      embedding,
      chunkType: input.chunkType,
      metadata: input.metadata ?? {},
    })
    .returning();
  if (!row) throw new Error("persistSessionMemoryChunk: insert returned no row");
  return { id, chunk: row };
}

export type WriteRawTurnChunkResult =
  | {
      status: "skipped";
      reason: string;
      sessionId: string;
      userTurnIndex: number;
      assistantTurnIndex: number;
    }
  | {
      status: "written";
      sessionId: string;
      chunkId: string;
      turnStart: number;
      turnEnd: number;
      chunkTextChars: number;
    };

async function writeRawTurnPairChunkImpl(input: {
  session: ChatSession;
  /** User row turn_index for this exchange. */
  userTurnIndex: number;
  assistantTurnIndex: number;
  userMessage: string;
  assistantReply: string;
}): Promise<WriteRawTurnChunkResult> {
  const { session, userTurnIndex, assistantTurnIndex, userMessage, assistantReply } =
    input;
  const sessionId = session.sessionId;

  if (session.mode === "sandbox") {
    return {
      status: "skipped",
      reason: "sandbox_mode_no_session_chunks",
      sessionId,
      userTurnIndex,
      assistantTurnIndex,
    };
  }

  const chunkText = `[回合 ${userTurnIndex}-${assistantTurnIndex}]\n用户：${userMessage}\n对方：${assistantReply}`;
  const { id } = await persistSessionMemoryChunk({
    sessionId,
    characterId: session.characterId,
    playerId: session.playerId,
    turnStart: userTurnIndex,
    turnEnd: assistantTurnIndex,
    chunkText,
    chunkType: "raw_turn_pair",
    metadata: {},
  });

  return {
    status: "written",
    sessionId,
    chunkId: id,
    turnStart: userTurnIndex,
    turnEnd: assistantTurnIndex,
    chunkTextChars: chunkText.length,
  };
}

export const writeRawTurnPairSessionChunkTraced = traceStage(
  "memory.write_session_chunk",
  writeRawTurnPairChunkImpl,
);
