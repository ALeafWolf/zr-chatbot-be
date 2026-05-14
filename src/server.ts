import Fastify from "fastify";
import cors from "@fastify/cors";
import { env } from "./config/env";
import { warmCharacterCache } from "./character/characterDefaults";
import { pool } from "./db/client";
import { postTurnRunner } from "./jobs/postTurnRunner";
import { structmemConsolidationRunner } from "./jobs/structmemConsolidationRunner";
import { sessionController } from "./api/sessionController";
import { chatController } from "./api/chatController";

const server = Fastify({ logger: { level: "info" } });

async function bootstrap(): Promise<void> {
  // CORS
  await server.register(cors, {
    origin: env.FRONTEND_ORIGIN,
    methods: ["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
  });

  // Routes — /api/characters, /api/scopes, /api/modes
  server.get("/api/characters", sessionController.getCharacters);
  server.get("/api/scopes", sessionController.getScopes);
  server.get("/api/modes", sessionController.getModes);

  // Session routes
  server.post("/api/sessions", sessionController.createSession);
  server.get("/api/sessions", sessionController.listSessions);
  server.get<{ Params: { id: string } }>("/api/sessions/:id", sessionController.getSession);
  server.patch<{ Params: { id: string } }>("/api/sessions/:id", sessionController.patchSession);
  server.delete<{ Params: { id: string } }>("/api/sessions/:id", sessionController.deleteSession);

  // Chat route
  server.post<{ Params: { id: string } }>(
    "/api/sessions/:id/messages",
    chatController.sendMessage,
  );
  server.post<{ Params: { id: string } }>(
    "/api/sessions/:id/messages/stream",
    chatController.streamMessage,
  );

  // Health check
  server.get("/health", async () => ({ status: "ok" }));

  // Pre-warm character YAML cache at startup
  warmCharacterCache();
  postTurnRunner.start();
  structmemConsolidationRunner.start();

  await server.listen({ port: env.PORT, host: "0.0.0.0" });
  server.log.info(`Chatbot backend listening on :${env.PORT}`);
}

async function shutdown(): Promise<void> {
  server.log.info("Shutting down — draining post-turn jobs...");
  postTurnRunner.stop();
  structmemConsolidationRunner.stop();
  await postTurnRunner.drain();
  await structmemConsolidationRunner.drain();
  await server.close();
  await pool.end();
  server.log.info("Shutdown complete");
  process.exit(0);
}

process.on("SIGTERM", () => void shutdown());
process.on("SIGINT", () => void shutdown());

bootstrap().catch((err) => {
  console.error("Failed to start server:", err);
  process.exit(1);
});
