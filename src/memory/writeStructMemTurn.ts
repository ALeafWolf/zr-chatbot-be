import { v4 as uuidv4 } from "uuid";
import { db } from "../db/client";
import {
  structmemEntries,
  structmemEventMessages,
  structmemEvents,
} from "../db/schema/structmem";
import type { ChatSession } from "../db/schema/chat";
import { traceStage } from "../observability/langsmithTracing";
import type { MemoryCandidate } from "./writeInteractiveMemory";
import type { StructMemEntryTypePhase1 } from "./structmemMapping";

export interface StructMemTurnWriteInput {
  session: ChatSession;
  latestTurnIndex: number;
  userMessageId: string;
  assistantMessageId: string;
  mapped: Array<{
    candidate: MemoryCandidate;
    entryType: StructMemEntryTypePhase1;
  }>;
  extractorBatchConfidence: number;
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
  mapped: StructMemTurnWriteInput["mapped"];
  extractorBatchConfidence: number;
}): Promise<string[]> {
  const { eventId, session, latestTurnIndex, mapped } = input;
  const ids: string[] = [];
  for (const row of mapped) {
    const id = uuidv4();
    ids.push(id);
    await db.insert(structmemEntries).values({
      id,
      eventId,
      sessionId: session.sessionId,
      characterId: session.characterId,
      playerId: session.playerId,
      memoryNamespace: session.memoryNamespace,
      turnIndex: latestTurnIndex,
      entryType: row.entryType,
      text: row.candidate.summary,
      embedding: row.candidate.embedding,
      importanceScore: row.candidate.importanceScore,
      confidenceScore: input.extractorBatchConfidence,
      metadata: {
        memoryType: row.candidate.memoryType,
      },
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
 * Persist one StructMem event, message links, and all entries for mapped
 * current_session extractor candidates. Skips callers that pass an empty mapped list.
 */
export async function writeStructMemTurn(
  input: StructMemTurnWriteInput,
): Promise<StructMemTurnWriteResult | null> {
  if (input.mapped.length === 0) {
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
    mapped: input.mapped,
    extractorBatchConfidence: input.extractorBatchConfidence,
  });
  return { eventId, entryIds };
}
