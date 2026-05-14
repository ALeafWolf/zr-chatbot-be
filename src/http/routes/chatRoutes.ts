import type { FastifyInstance } from "fastify";
import {
  sendMessageHandler,
  streamMessageHandler,
} from "../../features/chat/chatHandlers";

export async function chatRoutes(server: FastifyInstance): Promise<void> {
  server.post<{ Params: { id: string } }>(
    "/api/sessions/:id/messages",
    sendMessageHandler,
  );
  server.post<{ Params: { id: string } }>(
    "/api/sessions/:id/messages/stream",
    streamMessageHandler,
  );
}
