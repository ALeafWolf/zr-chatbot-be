import { eq, sql } from "drizzle-orm";
import { v4 as uuidv4 } from "uuid";
import { env } from "../config/env";
import { db } from "../db/client";
import { chatMessages, chatSessions, sessionState } from "../db/schema/chat";
import type { ChatSession } from "../db/schema/chat";
import { postTurnJobs } from "../db/schema/jobs";
import {
  INITIAL_POST_TURN_STEP_STATUS,
  newPostTurnJobId,
} from "../jobs/postTurnRunner";
import {
  sessionSnapshotFromChatSession,
  type PostTurnJobPayloadV1,
} from "../jobs/postTurnJobPayload";
import type { RetrievedMemory } from "../retrieval/memory/retrieveInteractiveMemories";
import type { DerivedState } from "../state/sessionStateRepo";
import type { Thought } from "./thoughtTypes";
import { calculateNextTurnIndexes } from "./turnIndexAllocator";
import { deriveTurnDelta } from "./turnDelta";

export interface PersistCompletedTurnInput {
  session: ChatSession;
  userMessage: string;
  assistantReply: string;
  validatorResult: unknown;
  derivedState: DerivedState;
  memories: RetrievedMemory[];
  thoughts: Thought[];
}

export interface PersistCompletedTurnResult {
  userMessageId: string;
  assistantMessageId: string;
  assistantTurnIndex: number;
  jobId: string;
}

export async function persistCompletedTurn(
  input: PersistCompletedTurnInput,
): Promise<PersistCompletedTurnResult> {
  const { session } = input;
  const sessionId = session.sessionId;

  return db.transaction(async (tx) => {
    await tx
      .insert(sessionState)
      .values({
        sessionId,
        lastTurnIndex: 0,
        updatedAt: new Date(),
      })
      .onConflictDoNothing();

    const stateRows = await tx.execute(sql`
      SELECT last_turn_index AS "lastTurnIndex"
      FROM session_state
      WHERE session_id = ${sessionId}
      FOR UPDATE
    `);
    const maxRows = await tx.execute(sql`
      SELECT MAX(turn_index) AS "maxTurnIndex"
      FROM chat_messages
      WHERE session_id = ${sessionId}
    `);

    const stateLastRaw = stateRows.rows[0]?.lastTurnIndex;
    const maxRaw = maxRows.rows[0]?.maxTurnIndex;
    const { userTurnIndex, assistantTurnIndex } = calculateNextTurnIndexes({
      sessionStateLastTurnIndex:
        typeof stateLastRaw === "number"
          ? stateLastRaw
          : stateLastRaw === null || stateLastRaw === undefined
            ? null
            : Number(stateLastRaw),
      maxMessageTurnIndex:
        typeof maxRaw === "number"
          ? maxRaw
          : maxRaw === null || maxRaw === undefined
            ? null
            : Number(maxRaw),
    });

    const userMsgId = uuidv4();
    const assistantMsgId = uuidv4();
    const now = new Date();

    await tx.insert(chatMessages).values([
      {
        id: userMsgId,
        sessionId,
        turnIndex: userTurnIndex,
        role: "user",
        content: input.userMessage,
        validatorResult: null,
        thoughts: null,
      },
      {
        id: assistantMsgId,
        sessionId,
        turnIndex: assistantTurnIndex,
        role: "assistant",
        content: input.assistantReply,
        validatorResult: input.validatorResult as unknown as Record<
          string,
          unknown
        >,
        thoughts: input.thoughts.length > 0 ? input.thoughts : null,
      },
    ]);

    await tx
      .insert(sessionState)
      .values({
        sessionId,
        derivedState: input.derivedState,
        temporaryAssumptions: deriveTurnDelta({
          userMessage: input.userMessage,
          assistantReply: input.assistantReply,
          userTurnIndex,
          assistantTurnIndex,
        }),
        lastTurnIndex: assistantTurnIndex,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: sessionState.sessionId,
        set: {
          derivedState: input.derivedState,
          temporaryAssumptions: deriveTurnDelta({
            userMessage: input.userMessage,
            assistantReply: input.assistantReply,
            userTurnIndex,
            assistantTurnIndex,
          }),
          lastTurnIndex: assistantTurnIndex,
          updatedAt: now,
        },
      });

    await tx
      .update(chatSessions)
      .set({ updatedAt: now })
      .where(eq(chatSessions.sessionId, sessionId));

    const shouldWriteMemory = session.writebackPolicy !== "no_writeback";
    const jobId = newPostTurnJobId();
    const payload: PostTurnJobPayloadV1 = {
      version: 1,
      sessionId,
      userMessage: input.userMessage,
      assistantReply: input.assistantReply,
      session: sessionSnapshotFromChatSession(session),
      derivedState: input.derivedState,
      shouldWriteMemory,
      userTurnIndex,
      assistantTurnIndex,
      userMessageId: userMsgId,
      assistantMessageId: assistantMsgId,
      recentMemorySummaries: input.memories.slice(0, 3).map((m) => m.summary),
    };

    await tx.insert(postTurnJobs).values({
      id: jobId,
      sessionId,
      userMessageId: userMsgId,
      assistantMessageId: assistantMsgId,
      status: "pending",
      attempts: 0,
      maxAttempts: env.POST_TURN_JOB_MAX_ATTEMPTS,
      runAfter: now,
      stepStatus: { ...INITIAL_POST_TURN_STEP_STATUS },
      payload: payload as unknown as Record<string, unknown>,
      createdAt: now,
      updatedAt: now,
    });

    return {
      userMessageId: userMsgId,
      assistantMessageId: assistantMsgId,
      assistantTurnIndex,
      jobId,
    };
  });
}
