import { and, desc, eq, isNull } from "drizzle-orm";
import { v4 as uuidv4 } from "uuid";
import { env } from "../../config/env";
import { db } from "../../db/client";
import { chatMessages, chatSessions, sessionState } from "../../db/schema/chat";
import { loadPersonaOverlay } from "../../character/characterDefaults";
import { listCharacters } from "../../character/characterProfiles";
import { WRITEBACK_POLICY_BY_MODE } from "../../character/canonRules";
import { buildMemoryNamespace } from "../../memory/shared/memoryNamespace";
import { AVAILABLE_SCOPES } from "../../retrieval/scope/resolveContinuityScope";
import type {
  CreateSessionInput,
  GetMessagesQueryInput,
  PatchSessionInput,
} from "./sessionSchemas";
import {
  serializeSessionDetail,
  serializeSessionListItem,
} from "./sessionSerializers";

export async function listCharacterOptions() {
  const chars = await listCharacters();
  return chars.map((c) => ({ character_id: c.characterId, name: c.name }));
}

export function listScopeOptions() {
  return AVAILABLE_SCOPES.map((scope) => ({ scope }));
}

export function listModeOptions() {
  return ["canonical_live", "pinned_scenario", "sandbox"];
}

export async function createSession(body: CreateSessionInput) {
  const playerId = env.DEFAULT_PLAYER_ID;
  const memoryNamespace = buildMemoryNamespace({
    continuityFamily: "main_world",
    scope: body.continuity_scope,
    playerId,
  });

  let personaOverlayId: string | null = null;
  try {
    loadPersonaOverlay(body.continuity_scope);
    personaOverlayId = body.continuity_scope;
  } catch {
    personaOverlayId = null;
  }

  const sessionId = uuidv4();
  const writebackPolicy =
    WRITEBACK_POLICY_BY_MODE[body.mode] ?? "no_writeback";
  const now = new Date();

  await db.insert(chatSessions).values({
    sessionId,
    characterId: body.character_id,
    playerId,
    mode: body.mode,
    continuityScope: body.continuity_scope,
    continuityFamily: "main_world",
    personaOverlayId,
    memoryNamespace,
    pinnedTime: body.pinned_time ?? null,
    pinnedLocation: body.pinned_location ?? null,
    writebackPolicy,
    displayTitle: body.display_title ?? null,
    thinking: body.thinking ?? env.DEFAULT_SESSION_THINKING,
    temperature: body.temperature ?? env.DEFAULT_SESSION_TEMPERATURE,
    createdAt: now,
    updatedAt: now,
  });

  await db.insert(sessionState).values({
    sessionId,
    lastTurnIndex: 0,
    updatedAt: now,
  });

  return { session_id: sessionId };
}

export async function listSessions() {
  const sessions = await db
    .select({
      sessionId: chatSessions.sessionId,
      characterId: chatSessions.characterId,
      mode: chatSessions.mode,
      continuityScope: chatSessions.continuityScope,
      sessionSummary: chatSessions.sessionSummary,
      displayTitle: chatSessions.displayTitle,
      thinking: chatSessions.thinking,
      temperature: chatSessions.temperature,
      createdAt: chatSessions.createdAt,
      updatedAt: chatSessions.updatedAt,
    })
    .from(chatSessions)
    .where(
      and(
        eq(chatSessions.playerId, env.DEFAULT_PLAYER_ID),
        isNull(chatSessions.deletedAt),
      ),
    )
    .orderBy(desc(chatSessions.updatedAt))
    .limit(100);

  return sessions.map(serializeSessionListItem);
}

export async function patchSession(id: string, body: PatchSessionInput) {
  const existing = await db
    .select({ sessionId: chatSessions.sessionId })
    .from(chatSessions)
    .where(and(eq(chatSessions.sessionId, id), isNull(chatSessions.deletedAt)))
    .limit(1);

  if (!existing[0]) return null;

  const setVals: Partial<{
    displayTitle: string | null;
    thinking: boolean;
    temperature: number;
    updatedAt: Date;
  }> = { updatedAt: new Date() };
  if (body.display_title !== undefined) {
    setVals.displayTitle = body.display_title ?? null;
  }
  if (body.thinking !== undefined) setVals.thinking = body.thinking;
  if (body.temperature !== undefined) setVals.temperature = body.temperature;

  await db
    .update(chatSessions)
    .set(setVals)
    .where(eq(chatSessions.sessionId, id));

  const [row] = await db
    .select({
      displayTitle: chatSessions.displayTitle,
      thinking: chatSessions.thinking,
      temperature: chatSessions.temperature,
    })
    .from(chatSessions)
    .where(eq(chatSessions.sessionId, id))
    .limit(1);

  return {
    session_id: id,
    display_title: row?.displayTitle ?? null,
    thinking: row?.thinking ?? true,
    temperature: row?.temperature ?? 1,
  };
}

export async function getSession(id: string, query: GetMessagesQueryInput) {
  const [sessionRows, messageRowsNewestFirst] = await Promise.all([
    db
      .select()
      .from(chatSessions)
      .where(and(eq(chatSessions.sessionId, id), isNull(chatSessions.deletedAt)))
      .limit(1),
    db
      .select()
      .from(chatMessages)
      .where(eq(chatMessages.sessionId, id))
      .orderBy(desc(chatMessages.turnIndex))
      .limit(query.page_size)
      .offset(query.page * query.page_size),
  ]);

  const session = sessionRows[0];
  if (!session) return null;
  return serializeSessionDetail(session, [...messageRowsNewestFirst].reverse());
}

export async function deleteSession(id: string): Promise<void> {
  await db
    .update(chatSessions)
    .set({ deletedAt: new Date() })
    .where(eq(chatSessions.sessionId, id));
}
