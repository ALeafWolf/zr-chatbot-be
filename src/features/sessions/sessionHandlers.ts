import type { FastifyReply, FastifyRequest } from "fastify";
import {
  CreateSessionBody,
  GetMessagesQuery,
  PatchSessionBody,
  SessionIdParams,
} from "./sessionSchemas";
import {
  createSession,
  deleteSession,
  getSession,
  listCharacterOptions,
  listModeOptions,
  listScopeOptions,
  listSessions,
  patchSession,
} from "./sessionService";

type IdParamsRequest = FastifyRequest<{ Params: { id: string } }>;

export async function getCharactersHandler(
  _req: FastifyRequest,
  reply: FastifyReply,
) {
  reply.send(await listCharacterOptions());
}

export async function getScopesHandler(
  _req: FastifyRequest,
  reply: FastifyReply,
) {
  reply.send(listScopeOptions());
}

export async function getModesHandler(
  _req: FastifyRequest,
  reply: FastifyReply,
) {
  reply.send(listModeOptions());
}

export async function createSessionHandler(
  req: FastifyRequest,
  reply: FastifyReply,
) {
  const body = CreateSessionBody.parse(req.body);
  reply.status(201).send(await createSession(body));
}

export async function listSessionsHandler(
  _req: FastifyRequest,
  reply: FastifyReply,
) {
  reply.send(await listSessions());
}

export async function patchSessionHandler(
  req: IdParamsRequest,
  reply: FastifyReply,
) {
  const { id } = SessionIdParams.parse(req.params);
  const body = PatchSessionBody.parse(req.body);
  const result = await patchSession(id, body);
  if (!result) {
    reply.status(404).send({ error: "Session not found" });
    return;
  }
  reply.send(result);
}

export async function getSessionHandler(
  req: IdParamsRequest,
  reply: FastifyReply,
) {
  const { id } = SessionIdParams.parse(req.params);
  const query = GetMessagesQuery.parse(req.query);
  const result = await getSession(id, query);
  if (!result) {
    reply.status(404).send({ error: "Session not found" });
    return;
  }
  reply.send(result);
}

export async function deleteSessionHandler(
  req: IdParamsRequest,
  reply: FastifyReply,
) {
  const { id } = SessionIdParams.parse(req.params);
  await deleteSession(id);
  reply.status(204).send();
}
