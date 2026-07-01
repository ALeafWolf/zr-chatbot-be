import Fastify from "fastify";
import cors from "@fastify/cors";
import { env } from "../config/env";
import { handleHttpError } from "./errorHandler";
import { chatRoutes } from "./routes/chatRoutes";
import { sessionRoutes } from "./routes/sessionRoutes";

export async function createApp() {
  const server = Fastify({ logger: { level: "info" } });

  server.setErrorHandler(handleHttpError);

  await server.register(cors, {
    origin: env.frontendOrigins,
    methods: ["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
  });

  await server.register(sessionRoutes);
  await server.register(chatRoutes);

  server.get("/health", async () => ({ status: "ok" }));

  return server;
}
