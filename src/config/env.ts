import dotenv from "dotenv";
import { z } from "zod";

dotenv.config();

const envSchema = z.object({
  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),

  OPENAI_API_KEY: z.string().min(1, "OPENAI_API_KEY is required"),
  ANTHROPIC_API_KEY: z.string().min(1, "ANTHROPIC_API_KEY is required"),
  DEEPSEEK_API_KEY: z.string().min(1, "DEEPSEEK_API_KEY is required"),

  /** Default when `POST /sessions` omits `thinking` (generation reasoning mode for new chats). */
  DEFAULT_SESSION_THINKING: z
    .string()
    .default("true")
    .transform((v) => v.trim().toLowerCase() !== "false" && v !== "0"),

  /** Default when `POST /sessions` omits `temperature` (rewrite-path generation). */
  DEFAULT_SESSION_TEMPERATURE: z
    .string()
    .default("1")
    .transform((v) => {
      const n = parseFloat(v.trim());
      if (Number.isNaN(n)) return 1;
      return Math.min(2, Math.max(0, n));
    }),

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

  /** Legacy unit-window RRF pipeline vs coarse-to-fine Tier 3. */
  CANON_RETRIEVAL_PIPELINE: z
    .string()
    .default("tier3")
    .transform((v) => {
      const s = v.trim().toLowerCase();
      if (s === "tier1" || s === "tier3") return s;
      return "tier3";
    }),

  /** Optional second embedding branch from rewriter hypothetical (debug). */
  CANON_QUERY_HYDE: z
    .string()
    .default("0")
    .transform((v) => v.trim() === "1" || v.trim().toLowerCase() === "true"),

  /** When true, embed rewritten query for interactive memory + session recall too. */
  USE_REWRITTEN_QUERY_FOR_MEMORY_EMBEDDING: z
    .string()
    .default("0")
    .transform((v) => v.trim() === "1" || v.trim().toLowerCase() === "true"),

  /** Always inject full [USER MESSAGE ANNOTATIONS] alongside structured query. */
  ANNOTATION_RULES_ALWAYS: z
    .string()
    .default("0")
    .transform((v) => v.trim() === "1" || v.trim().toLowerCase() === "true"),

  /** Below this rewriter confidence, treat as low-trust and use annotation fallback. */
  REWRITE_CONFIDENCE_THRESHOLD: z
    .string()
    .default("0.6")
    .transform((v) => {
      const n = parseFloat(v.trim());
      if (Number.isNaN(n)) return 0.6;
      return Math.min(1, Math.max(0, n));
    }),

  /** Soft attribution penalty inside validator (Tier 4 prep). */
  VALIDATOR_STRICT_ATTRIBUTION: z
    .string()
    .default("0")
    .transform((v) => v.trim() === "1" || v.trim().toLowerCase() === "true"),

  /** Optional LLM-as-judge for attribution evals. */
  EVAL_ENABLE_LLM_JUDGE: z
    .string()
    .default("0")
    .transform((v) => v.trim() === "1" || v.trim().toLowerCase() === "true"),
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
