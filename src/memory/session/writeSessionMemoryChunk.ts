import { v4 as uuidv4 } from "uuid";
import { db } from "../../db/client";
import {
  sessionMemoryChunks,
  type SessionMemoryChunk,
} from "../../db/schema/memory";
import { and, eq, sql } from "drizzle-orm";
import { embedText } from "../../llm/embeddings/embedText";
import { traceStage } from "../../observability/langsmithTracing";
import type { ChatSession } from "../../db/schema/chat";
import { incrementSessionChunkWrite } from "../../eval/evalSnapshots";

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
  incrementSessionChunkWrite("written");
  return { id, chunk: row };
}

export async function sessionMemoryChunkExists(input: {
  sessionId: string;
  turnStart: number;
  turnEnd: number;
  chunkType: SessionChunkTypePersisted;
  metadataContains?: Record<string, unknown>;
}): Promise<boolean> {
  const { sessionId, turnStart, turnEnd, chunkType, metadataContains } = input;
  if (metadataContains && Object.keys(metadataContains).length > 0) {
    const metadataJson = JSON.stringify(metadataContains);
    const rows = await db.execute(sql`
      SELECT id
      FROM session_memory_chunks
      WHERE session_id = ${sessionId}
        AND turn_start = ${turnStart}
        AND turn_end = ${turnEnd}
        AND chunk_type = ${chunkType}
        AND metadata @> ${metadataJson}::jsonb
      LIMIT 1
    `);
    return rows.rows.length > 0;
  }

  const rows = await db
    .select({ id: sessionMemoryChunks.id })
    .from(sessionMemoryChunks)
    .where(
      and(
        eq(sessionMemoryChunks.sessionId, sessionId),
        eq(sessionMemoryChunks.turnStart, turnStart),
        eq(sessionMemoryChunks.turnEnd, turnEnd),
        eq(sessionMemoryChunks.chunkType, chunkType),
      ),
    )
    .limit(1);
  return rows.length > 0;
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

  const alreadyWritten = await sessionMemoryChunkExists({
    sessionId,
    turnStart: userTurnIndex,
    turnEnd: assistantTurnIndex,
    chunkType: "raw_turn_pair",
  });
  if (alreadyWritten) {
    incrementSessionChunkWrite("skipped");
    return {
      status: "skipped",
      reason: "raw_turn_pair_chunk_already_exists",
      sessionId,
      userTurnIndex,
      assistantTurnIndex,
    };
  }

  const chunkText = [
    `[turn ${userTurnIndex}-${assistantTurnIndex}]`,
    `User: ${userMessage}`,
    `Character: ${assistantReply}`,
  ].join("\n");
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
