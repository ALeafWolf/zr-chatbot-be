import { v4 as uuidv4 } from "uuid";
import { db } from "../db/client";
import {
  structmemEntries,
  structmemEventMessages,
  structmemEvents,
} from "../db/schema/structmem";
import type { ChatSession } from "../db/schema/chat";
import { traceStage } from "../observability/langsmithTracing";
import type { StructMemPersistRow } from "./structmemMapping";

export interface StructMemTurnWriteInput {
  session: ChatSession;
  latestTurnIndex: number;
  userMessageId: string;
  assistantMessageId: string;
  rows: StructMemPersistRow[];
  extractorBatchConfidence: number;
  /** Merge `source: structmem_native_v2` into each entry metadata (native extractor path). */
  mergeNativeStructMemSource?: boolean;
}

export interface StructMemTurnWriteResult {
  eventId: string;
  entryIds: string[];
}

async function writeStructMemEventAndMessagesImpl(input: {
  eventId: string;
  session: ChatSession;
  latestTurnIndex: number;
  userMessageId: string;
  assistantMessageId: string;
  extractorBatchConfidence: number;
}): Promise<void> {
  const { eventId, session, latestTurnIndex, userMessageId, assistantMessageId } =
    input;
  await db.insert(structmemEvents).values({
    id: eventId,
    sessionId: session.sessionId,
    characterId: session.characterId,
    playerId: session.playerId,
    memoryNamespace: session.memoryNamespace,
    continuityScope: session.continuityScope,
    continuityFamily: session.continuityFamily,
    turnIndex: latestTurnIndex,
    mode: session.mode,
    metadata: {
      extractorBatchConfidence: input.extractorBatchConfidence,
    },
  });
  await db.insert(structmemEventMessages).values([
    {
      eventId,
      messageId: userMessageId,
      role: "user",
    },
    {
      eventId,
      messageId: assistantMessageId,
      role: "assistant",
    },
  ]);
}

async function writeStructMemEntriesImpl(input: {
  eventId: string;
  session: ChatSession;
  latestTurnIndex: number;
  rows: StructMemPersistRow[];
  extractorBatchConfidence: number;
  mergeNativeStructMemSource?: boolean;
}): Promise<string[]> {
  const { eventId, session, latestTurnIndex, rows } = input;
  const ids: string[] = [];
  for (const row of rows) {
    const id = uuidv4();
    ids.push(id);
    const baseMeta =
      typeof row.metadata === "object" && row.metadata !== null
        ? { ...row.metadata }
        : {};
    if (input.mergeNativeStructMemSource) {
      baseMeta.source = "structmem_native_v2";
    }
    const confidenceScore =
      row.confidenceScore !== null && row.confidenceScore !== undefined
        ? row.confidenceScore
        : input.extractorBatchConfidence;
    await db.insert(structmemEntries).values({
      id,
      eventId,
      sessionId: session.sessionId,
      characterId: session.characterId,
      playerId: session.playerId,
      memoryNamespace: session.memoryNamespace,
      turnIndex: latestTurnIndex,
      entryType: row.entryType,
      text: row.text,
      embedding: row.embedding,
      importanceScore: row.importanceScore,
      confidenceScore,
      metadata: baseMeta,
    });
  }
  return ids;
}

export const writeStructMemEventAndMessagesTraced = traceStage(
  "memory.write_structmem_event",
  writeStructMemEventAndMessagesImpl,
);

export const writeStructMemEntriesTraced = traceStage(
  "memory.write_structmem_entry",
  writeStructMemEntriesImpl,
);

/**
 * Persist one StructMem event, message links, and all entries for the given rows.
 * Skips callers that pass an empty rows list.
 */
export async function writeStructMemTurn(
  input: StructMemTurnWriteInput,
): Promise<StructMemTurnWriteResult | null> {
  if (input.rows.length === 0) {
    return null;
  }
  const eventId = uuidv4();
  await writeStructMemEventAndMessagesTraced({
    eventId,
    session: input.session,
    latestTurnIndex: input.latestTurnIndex,
    userMessageId: input.userMessageId,
    assistantMessageId: input.assistantMessageId,
    extractorBatchConfidence: input.extractorBatchConfidence,
  });
  const entryIds = await writeStructMemEntriesTraced({
    eventId,
    session: input.session,
    latestTurnIndex: input.latestTurnIndex,
    rows: input.rows,
    extractorBatchConfidence: input.extractorBatchConfidence,
    mergeNativeStructMemSource: input.mergeNativeStructMemSource,
  });
  return { eventId, entryIds };
}
