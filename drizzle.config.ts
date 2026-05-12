import { defineConfig } from "drizzle-kit";
import dotenv from "dotenv";
dotenv.config();

export default defineConfig({
  // Only include chatbot-owned tables — canon tables stay owned by script-extractor
  schema: [
    "./src/db/schema/chat.ts",
    "./src/db/schema/memory.ts",
    "./src/db/schema/persona.ts",
    "./src/db/schema/structmem.ts",
  ],
  out: "./drizzle/migrations",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL ?? "",
  },
});
