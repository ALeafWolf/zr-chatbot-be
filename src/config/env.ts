import dotenv from "dotenv";
import { z } from "zod";

dotenv.config();

const envSchema = z.object({
  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),

  OPENAI_API_KEY: z.string().min(1, "OPENAI_API_KEY is required"),
  ANTHROPIC_API_KEY: z.string().min(1, "ANTHROPIC_API_KEY is required"),
  DEEPSEEK_API_KEY: z.string().min(1, "DEEPSEEK_API_KEY is required"),

  /** Optional — web search tool degrades gracefully when unset. */
  TAVILY_API_KEY: z.string().optional(),

  GENERATION_MODEL: z.string().default("anthropic:claude-sonnet-4-5"),
  VALIDATOR_MODEL: z.string().default("anthropic:claude-haiku-4-5"),
  EXTRACTOR_MODEL: z.string().default("deepseek:deepseek-chat"),
  EMBEDDING_MODEL: z.string().default("openai:text-embedding-3-small"),
  EMBEDDING_DIMENSIONS: z
    .string()
    .default("1536")
    .transform((v) => parseInt(v, 10)),

  LANGSMITH_TRACING: z
    .string()
    .default("false")
    .transform((v) => v === "true"),
  LANGSMITH_API_KEY: z.string().optional(),
  LANGSMITH_PROJECT: z.string().default("zuoran-chatbot-phase1"),
  LANGSMITH_ENDPOINT: z
    .string()
    .default("https://api.smith.langchain.com"),

  /** LangSmith dataset name for Phase 1 regression examples (push + evaluate). */
  LANGSMITH_EVAL_DATASET: z.string().default("zuoran-phase1-eval"),

  PORT: z
    .string()
    .default("4000")
    .transform((v) => parseInt(v, 10)),
  FRONTEND_ORIGIN: z.string().default("http://localhost:5173"),

  DEFAULT_PLAYER_ID: z.string().default("local_dev"),
  DEFAULT_CHARACTER_ID: z.string().default("zuo_ran"),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error("❌ Invalid environment variables:");
  for (const [field, issues] of Object.entries(
    parsed.error.flatten().fieldErrors,
  )) {
    console.error(`  ${field}: ${(issues as string[]).join(", ")}`);
  }
  process.exit(1);
}

export const env = parsed.data;
export type Env = typeof env;
