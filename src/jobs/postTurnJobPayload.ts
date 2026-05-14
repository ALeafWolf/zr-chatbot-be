import { z } from "zod";
import type { ChatSession } from "../db/schema/chat";
import type { DerivedState } from "../state/sessionStateRepo";
import type { PostTurnSignals } from "../llm/extraction/extractPostTurnSignals";

export const POST_TURN_STEP_NAMES = [
  "raw_chunk",
  "extract_signals",
  "structmem",
  "session_chunks",
  "durable_memory",
  "summary_compact",
] as const;

export type PostTurnStepName = (typeof POST_TURN_STEP_NAMES)[number];
export type PostTurnStepState = "pending" | "completed" | "failed";
export type PostTurnStepStatus = Record<PostTurnStepName, PostTurnStepState>;

export const INITIAL_POST_TURN_STEP_STATUS: PostTurnStepStatus = {
  raw_chunk: "pending",
  extract_signals: "pending",
  structmem: "pending",
  session_chunks: "pending",
  durable_memory: "pending",
  summary_compact: "pending",
};

export interface PostTurnSessionSnapshot {
  sessionId: string;
  characterId: string;
  playerId: string;
  mode: string;
  continuityScope: string;
  continuityFamily: string;
  personaOverlayId: string | null;
  memoryNamespace: string;
  pinnedTime: string | null;
  pinnedLocation: string | null;
  writebackPolicy: string;
  sessionSummary: string | null;
  displayTitle: string | null;
  thinking: boolean;
  temperature: number;
}

export interface PostTurnJobPayloadV1 {
  version: 1;
  sessionId: string;
  userMessage: string;
  assistantReply: string;
  session: PostTurnSessionSnapshot;
  derivedState: DerivedState;
  shouldWriteMemory: boolean;
  userTurnIndex: number;
  assistantTurnIndex: number;
  userMessageId: string;
  assistantMessageId: string;
  recentMemorySummaries: string[];
  signals?: PostTurnSignals;
}

const DerivedStateSchema = z.object({
  inferredMood: z.string(),
  inferredActivity: z.string(),
  conversationalStance: z.string(),
});

const SessionSnapshotSchema = z.object({
  sessionId: z.string(),
  characterId: z.string(),
  playerId: z.string(),
  mode: z.string(),
  continuityScope: z.string(),
  continuityFamily: z.string(),
  personaOverlayId: z.string().nullable(),
  memoryNamespace: z.string(),
  pinnedTime: z.string().nullable(),
  pinnedLocation: z.string().nullable(),
  writebackPolicy: z.string(),
  sessionSummary: z.string().nullable(),
  displayTitle: z.string().nullable(),
  thinking: z.boolean(),
  temperature: z.number(),
});

export const PostTurnJobPayloadV1Schema: z.ZodType<PostTurnJobPayloadV1> =
  z.object({
    version: z.literal(1),
    sessionId: z.string(),
    userMessage: z.string(),
    assistantReply: z.string(),
    session: SessionSnapshotSchema,
    derivedState: DerivedStateSchema,
    shouldWriteMemory: z.boolean(),
    userTurnIndex: z.number().int(),
    assistantTurnIndex: z.number().int(),
    userMessageId: z.string(),
    assistantMessageId: z.string(),
    recentMemorySummaries: z.array(z.string()),
    signals: z.unknown().optional() as z.ZodType<PostTurnSignals | undefined>,
  });

export function sessionSnapshotFromChatSession(
  session: ChatSession,
): PostTurnSessionSnapshot {
  return {
    sessionId: session.sessionId,
    characterId: session.characterId,
    playerId: session.playerId,
    mode: session.mode,
    continuityScope: session.continuityScope,
    continuityFamily: session.continuityFamily,
    personaOverlayId: session.personaOverlayId,
    memoryNamespace: session.memoryNamespace,
    pinnedTime: session.pinnedTime,
    pinnedLocation: session.pinnedLocation,
    writebackPolicy: session.writebackPolicy,
    sessionSummary: session.sessionSummary,
    displayTitle: session.displayTitle,
    thinking: session.thinking,
    temperature: session.temperature,
  };
}

export function chatSessionFromSnapshot(
  session: PostTurnSessionSnapshot,
): ChatSession {
  const now = new Date();
  return {
    ...session,
    deletedAt: null,
    createdAt: now,
    updatedAt: now,
  };
}

export function parsePostTurnJobPayload(raw: unknown): PostTurnJobPayloadV1 {
  return PostTurnJobPayloadV1Schema.parse(raw);
}

export function normalizeStepStatus(raw: unknown): PostTurnStepStatus {
  const out = { ...INITIAL_POST_TURN_STEP_STATUS };
  if (raw && typeof raw === "object") {
    const rec = raw as Record<string, unknown>;
    for (const step of POST_TURN_STEP_NAMES) {
      const v = rec[step];
      if (v === "pending" || v === "completed" || v === "failed") {
        out[step] = v;
      }
    }
  }
  return out;
}

export function isStepComplete(
  status: PostTurnStepStatus,
  step: PostTurnStepName,
): boolean {
  return status[step] === "completed";
}

export function markStepCompleted(
  status: PostTurnStepStatus,
  step: PostTurnStepName,
): PostTurnStepStatus {
  return { ...status, [step]: "completed" };
}
