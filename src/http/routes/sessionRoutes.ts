import type { FastifyInstance } from "fastify";
import {
  createSessionHandler,
  deleteSessionHandler,
  getCharactersHandler,
  getModesHandler,
  getScopesHandler,
  getSessionHandler,
  listSessionsHandler,
  patchSessionHandler,
} from "../../features/sessions/sessionHandlers";

export async function sessionRoutes(server: FastifyInstance): Promise<void> {
  server.get("/api/characters", getCharactersHandler);
  server.get("/api/scopes", getScopesHandler);
  server.get("/api/modes", getModesHandler);

  server.post("/api/sessions", createSessionHandler);
  server.get("/api/sessions", listSessionsHandler);
  server.get<{ Params: { id: string } }>(
    "/api/sessions/:id",
    getSessionHandler,
  );
  server.patch<{ Params: { id: string } }>(
    "/api/sessions/:id",
    patchSessionHandler,
  );
  server.delete<{ Params: { id: string } }>(
    "/api/sessions/:id",
    deleteSessionHandler,
  );
}
