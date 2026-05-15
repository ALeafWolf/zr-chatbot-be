import { env } from "./config/env";
import { warmCharacterCache } from "./character/characterDefaults";
import { pool } from "./db/client";
import { postTurnRunner } from "./jobs/postTurnRunner";
import { structmemConsolidationRunner } from "./jobs/structmemConsolidationRunner";
import { createApp } from "./http/app";
import { warnStructMemFlagConfig } from "./config/structMemConfigValidation";

let server: Awaited<ReturnType<typeof createApp>> | null = null;

async function bootstrap(): Promise<void> {
  server = await createApp();

  warmCharacterCache();
  warnStructMemFlagConfig(env, (message) => server?.log.warn(message));
  postTurnRunner.start();
  if (env.STRUCTMEM_ENABLED && env.STRUCTMEM_CONSOLIDATION_ENABLED) {
    structmemConsolidationRunner.start();
  }

  await server.listen({ port: env.PORT, host: "0.0.0.0" });
  server.log.info(`Chatbot backend listening on :${env.PORT}`);
}

async function shutdown(): Promise<void> {
  server?.log.info("Shutting down - draining background jobs...");
  postTurnRunner.stop();
  structmemConsolidationRunner.stop();
  await postTurnRunner.drain();
  await structmemConsolidationRunner.drain();
  await server?.close();
  await pool.end();
  server?.log.info("Shutdown complete");
  process.exit(0);
}

process.on("SIGTERM", () => void shutdown());
process.on("SIGINT", () => void shutdown());

bootstrap().catch((err) => {
  console.error("Failed to start server:", err);
  process.exit(1);
});
