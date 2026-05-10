import type { FastifyRequest, FastifyReply } from "fastify";
import { v4 as uuidv4 } from "uuid";
import { db } from "../db/client";
import { chatSessions, chatMessages, sessionState } from "../db/schema/chat";
import { eq, and, isNull, desc } from "drizzle-orm";
import { z } from "zod";
import { env } from "../config/env";
import { buildMemoryNamespace } from "../memory/memoryNamespace";
import { WRITEBACK_POLICY_BY_MODE } from "../character/canonRules";
import { AVAILABLE_SCOPES } from "../retrieval/resolveContinuityScope";
import { listCharacters } from "../character/characterProfiles";
import { loadPersonaOverlay } from "../character/characterDefaults";

const MainWorldScopeZodEnum = AVAILABLE_SCOPES as unknown as [string, ...string[]];

const DISPLAY_TITLE_MAX_LEN = 120;

const optionalDisplayTitleField = z
  .string()
  .optional()
  .transform((val) => {
    if (val === undefined) return undefined;
    const t = val.trim();
    return t.length === 0 ? null : t;
  })
  .pipe(
    z
      .union([
        z.undefined(),
        z.null(),
        z.string().max(DISPLAY_TITLE_MAX_LEN),
      ])
      .optional(),
  );

const CreateSessionBody = z.object({
  character_id: z.string().default(env.DEFAULT_CHARACTER_ID),
  mode: z.enum(["canonical_live", "pinned_scenario", "sandbox"]),
  continuity_scope: z.enum(MainWorldScopeZodEnum).default("main_married"),
  pinned_time: z.string().optional(),
  pinned_location: z.string().optional(),
  thinking: z.boolean().optional(),
  display_title: optionalDisplayTitleField,
  temperature: z.number().min(0).max(2).optional(),
});

const GetSessionParams = z.object({ id: z.string() });
const PatchSessionBody = z
  .object({
    display_title: z
      .union([z.string(), z.null()])
      .optional()
      .transform((val) => {
        if (val === undefined) return undefined;
        if (val === null) return null;
        const t = val.trim();
        return t.length === 0 ? null : t;
      })
      .pipe(
        z
          .union([z.undefined(), z.null(), z.string().max(DISPLAY_TITLE_MAX_LEN)])
          .optional(),
      ),
    thinking: z.boolean().optional(),
    temperature: z.number().min(0).max(2).optional(),
  })
  .refine(
    (d) =>
      d.display_title !== undefined ||
      d.thinking !== undefined ||
      d.temperature !== undefined,
    {
      message:
        "At least one of display_title, thinking, or temperature is required",
    },
  );
const GetMessagesQuery = z.object({
  page: z
    .string()
    .default("0")
    .transform(Number)
    .pipe(z.number().int().min(0)),
  page_size: z
    .string()
    .default("50")
    .transform(Number)
    .pipe(z.number().int().min(1).max(200)),
});

export const sessionController = {
  async getCharacters(_req: FastifyRequest, reply: FastifyReply) {
    const chars = await listCharacters();
    reply.send(chars.map((c) => ({ character_id: c.characterId, name: c.name })));
  },

  async getScopes(_req: FastifyRequest, reply: FastifyReply) {
    reply.send(AVAILABLE_SCOPES.map((s) => ({ scope: s })));
  },

  async getModes(_req: FastifyRequest, reply: FastifyReply) {
    reply.send(["canonical_live", "pinned_scenario", "sandbox"]);
  },

  async createSession(req: FastifyRequest, reply: FastifyReply) {
    const body = CreateSessionBody.parse(req.body);
    const playerId = env.DEFAULT_PLAYER_ID;

    const memoryNamespace = buildMemoryNamespace({
      continuityFamily: "main_world",
      scope: body.continuity_scope,
      playerId,
    });

    // Resolve persona overlay — try scope-named overlay, fall back gracefully
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

    reply.status(201).send({ session_id: sessionId });
  },

  async listSessions(req: FastifyRequest, reply: FastifyReply) {
    const playerId = env.DEFAULT_PLAYER_ID;
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
          eq(chatSessions.playerId, playerId),
          isNull(chatSessions.deletedAt),
        ),
      )
      .orderBy(desc(chatSessions.updatedAt))
      .limit(100);

    reply.send(sessions.map((s) => ({
      session_id: s.sessionId,
      character_id: s.characterId,
      mode: s.mode,
      continuity_scope: s.continuityScope,
      session_summary: s.sessionSummary,
      display_title: s.displayTitle,
      thinking: s.thinking,
      temperature: s.temperature,
      created_at: s.createdAt,
      updated_at: s.updatedAt,
    })));
  },

  async patchSession(req: FastifyRequest, reply: FastifyReply) {
    const { id } = GetSessionParams.parse((req as FastifyRequest<{ Params: { id: string } }>).params);
    const body = PatchSessionBody.parse(req.body);

    const existing = await db
      .select({ sessionId: chatSessions.sessionId })
      .from(chatSessions)
      .where(and(eq(chatSessions.sessionId, id), isNull(chatSessions.deletedAt)))
      .limit(1);

    if (!existing[0]) {
      reply.status(404).send({ error: "Session not found" });
      return;
    }

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

    await db.update(chatSessions).set(setVals).where(eq(chatSessions.sessionId, id));

    const [row] = await db
      .select({
        displayTitle: chatSessions.displayTitle,
        thinking: chatSessions.thinking,
        temperature: chatSessions.temperature,
      })
      .from(chatSessions)
      .where(eq(chatSessions.sessionId, id))
      .limit(1);

    reply.send({
      session_id: id,
      display_title: row?.displayTitle ?? null,
      thinking: row?.thinking ?? true,
      temperature: row?.temperature ?? 1,
    });
  },

  async getSession(req: FastifyRequest, reply: FastifyReply) {
    const { id } = GetSessionParams.parse((req as FastifyRequest<{ Params: { id: string } }>).params);
    const query = GetMessagesQuery.parse(req.query);

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

    /** Chronological order for the client (newest page fetched first; offset advances into older history). */
    const messages = [...messageRowsNewestFirst].reverse();

    if (!sessionRows[0]) {
      reply.status(404).send({ error: "Session not found" });
      return;
    }
    const s = sessionRows[0];
    reply.send({
      session_id: s.sessionId,
      character_id: s.characterId,
      mode: s.mode,
      continuity_scope: s.continuityScope,
      pinned_time: s.pinnedTime,
      pinned_location: s.pinnedLocation,
      session_summary: s.sessionSummary,
      display_title: s.displayTitle,
      thinking: s.thinking,
      temperature: s.temperature,
      created_at: s.createdAt,
      updated_at: s.updatedAt,
      messages: messages.map((m) => ({
        id: m.id,
        role: m.role,
        content: m.content,
        turn_index: m.turnIndex,
        created_at: m.createdAt,
        thoughts: Array.isArray(m.thoughts)
          ? (m.thoughts as unknown[])
          : [],
      })),
    });
  },

  async deleteSession(req: FastifyRequest, reply: FastifyReply) {
    const { id } = GetSessionParams.parse((req as FastifyRequest<{ Params: { id: string } }>).params);
    await db
      .update(chatSessions)
      .set({ deletedAt: new Date() })
      .where(eq(chatSessions.sessionId, id));
    reply.status(204).send();
  },
};
