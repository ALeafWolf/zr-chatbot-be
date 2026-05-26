import { eq, sql } from "drizzle-orm";
import { v4 as uuidv4 } from "uuid";
import { env } from "../../config/env";
import { db } from "../../db/client";
import { chatMessages, chatSessions, sessionState } from "../../db/schema/chat";
import type { ChatSession } from "../../db/schema/chat";
import { postTurnJobs } from "../../db/schema/jobs";
import {
  INITIAL_POST_TURN_STEP_STATUS,
  newPostTurnJobId,
} from "../../jobs/postTurnRunner";
import {
  sessionSnapshotFromChatSession,
  type PostTurnJobPayloadV1,
} from "../../jobs/postTurnJobPayload";
import type { RetrievedMemory } from "../../retrieval/memory/retrieveInteractiveMemories";
import type { DerivedState } from "../../state/sessionStateRepo";
import type { Thought } from "../thought/thoughtTypes";
import { calculateNextTurnIndexes } from "../turn/turnIndexAllocator";
import { deriveTurnDelta } from "../turn/turnDelta";
import { traceStageWithIO } from "../../observability/langsmithTracing";
import {
  attachTracePayload,
  buildDurationPayload,
  getAttachedTracePayload,
} from "../../observability/tracePayloads";
import { recordMemoryWriteSnapshot } from "../../eval/evalSnapshots";
import {
  ROLEPLAY_TURN_ROUTE,
  type TurnRoute,
} from "../turn/turnRoutes";

export interface PersistCompletedTurnInput {
  session: ChatSession;
  userMessage: string;
  assistantReply: string;
  validatorResult: unknown;
  route: TurnRoute;
  derivedState?: DerivedState;
  memories?: RetrievedMemory[];
  thoughts: Thought[];
  usage?: {
    inputTokens: number;
    outputTokens: number;
    estimatedCostUsd: number | null;
  };
}

export interface PersistCompletedTurnResult {
  userMessageId: string;
  assistantMessageId: string;
  assistantTurnIndex: number;
  jobId: string | null;
}

async function persistCompletedTurnImpl(
  input: PersistCompletedTurnInput,
): Promise<PersistCompletedTurnResult> {
  const { session } = input;
  const sessionId = session.sessionId;
  const shouldRunPostTurn = input.route === ROLEPLAY_TURN_ROUTE;
  const transactionStartedAt = Date.now();

  const result = await db.transaction(async (tx) => {
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

    // Merge generation usage metadata into validator_result for roleplay
    // assistant rows so session status can aggregate tracked tokens/cost.
    const finalValidatorResult: unknown =
      input.usage && input.route === ROLEPLAY_TURN_ROUTE
        ? {
            ...(input.validatorResult as Record<string, unknown> | undefined),
            usage: {
              input_tokens: input.usage.inputTokens,
              output_tokens: input.usage.outputTokens,
              estimated_cost_usd: input.usage.estimatedCostUsd,
            },
          }
        : input.validatorResult;

    await tx.insert(chatMessages).values([
      {
        id: userMsgId,
        sessionId,
        turnIndex: userTurnIndex,
        role: "user",
        route: input.route,
        content: input.userMessage,
        validatorResult: null,
        thoughts: null,
      },
      {
        id: assistantMsgId,
        sessionId,
        turnIndex: assistantTurnIndex,
        role: "assistant",
        route: input.route,
        content: input.assistantReply,
        validatorResult: finalValidatorResult as unknown as Record<
          string,
          unknown
        >,
        thoughts: input.thoughts.length > 0 ? input.thoughts : null,
      },
    ]);

    if (shouldRunPostTurn && input.derivedState) {
      const temporaryAssumptions = deriveTurnDelta({
        userMessage: input.userMessage,
        assistantReply: input.assistantReply,
        userTurnIndex,
        assistantTurnIndex,
      });

      await tx
        .insert(sessionState)
        .values({
          sessionId,
          derivedState: input.derivedState,
          temporaryAssumptions,
          lastTurnIndex: assistantTurnIndex,
          updatedAt: now,
        })
        .onConflictDoUpdate({
          target: sessionState.sessionId,
          set: {
            derivedState: input.derivedState,
            temporaryAssumptions,
            lastTurnIndex: assistantTurnIndex,
            updatedAt: now,
          },
        });
    } else {
      await tx
        .insert(sessionState)
        .values({
          sessionId,
          lastTurnIndex: assistantTurnIndex,
          updatedAt: now,
        })
        .onConflictDoUpdate({
          target: sessionState.sessionId,
          set: {
            lastTurnIndex: assistantTurnIndex,
            updatedAt: now,
          },
        });
    }

    await tx
      .update(chatSessions)
      .set({ updatedAt: now })
      .where(eq(chatSessions.sessionId, sessionId));

    let jobId: string | null = null;
    if (shouldRunPostTurn && input.derivedState && session.writebackPolicy !== "no_writeback") {
      const shouldWriteMemory = true;
      jobId = newPostTurnJobId();
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
        recentMemorySummaries: (input.memories ?? [])
          .slice(0, 3)
          .map((m) => m.summary),
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
    }

    return {
      userMessageId: userMsgId,
      assistantMessageId: assistantMsgId,
      assistantTurnIndex,
      jobId,
    };
  });

  if (result.jobId) {
    recordMemoryWriteSnapshot({
      postTurnJobId: result.jobId,
    });
  }

  return attachTracePayload(
    result,
    buildCompletedTurnPersistenceTracePayload({
      result,
      session,
      route: input.route,
      transactionDurationMs: buildDurationPayload(transactionStartedAt).durationMs,
    }),
  );
}

export function buildCompletedTurnPersistenceTracePayload(input: {
  result: PersistCompletedTurnResult;
  session: Pick<ChatSession, "sessionId" | "writebackPolicy">;
  route: TurnRoute;
  transactionDurationMs: number;
}): Record<string, unknown> {
  return {
    ...input.result,
    sessionId: input.session.sessionId,
    route: input.route,
    writebackEnabled:
      input.route === ROLEPLAY_TURN_ROUTE &&
      input.session.writebackPolicy !== "no_writeback",
    transactionDurationMs: input.transactionDurationMs,
  };
}

export const persistCompletedTurn = traceStageWithIO(
  "persistence.completed_turn",
  persistCompletedTurnImpl,
  {
    subsystem: "memory",
    turn: "foreground",
    processInputs: (inputs) => {
      const input = unwrapPersistCompletedTurnInput(inputs);
      return {
        sessionId: input.session.sessionId,
        characterId: input.session.characterId,
        route: input.route,
        writebackEnabled:
          input.route === ROLEPLAY_TURN_ROUTE &&
          input.session.writebackPolicy !== "no_writeback",
        userMessageChars: input.userMessage.length,
        assistantReplyChars: input.assistantReply.length,
        memoryCount: input.memories?.length ?? 0,
        thoughtCount: input.thoughts.length,
      };
    },
    processOutputs: (outputs) => getAttachedTracePayload(outputs) ?? outputs,
  },
);

function unwrapPersistCompletedTurnInput(
  inputs: Record<string, unknown>,
): PersistCompletedTurnInput {
  if ("input" in inputs && inputs.input) {
    return inputs.input as PersistCompletedTurnInput;
  }
  return inputs as unknown as PersistCompletedTurnInput;
}

export async function updateAssistantMessageThoughts(input: {
  assistantMessageId: string;
  thoughts: Thought[];
}): Promise<void> {
  await db
    .update(chatMessages)
    .set({
      thoughts: input.thoughts.length > 0 ? input.thoughts : null,
    })
    .where(eq(chatMessages.id, input.assistantMessageId));
}
