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

  /** When false, canon_lookup tool is not registered (kill-switch). */
  CANON_LOOKUP_TOOL_ENABLED: z
    .string()
    .default("1")
    .transform((v) => {
      const s = v.trim().toLowerCase();
      return s !== "0" && s !== "false" && s !== "off";
    }),

  /** Optional model for attribution judge; defaults to EXTRACTOR_MODEL. */
  VALIDATOR_ATTRIBUTION_JUDGE_MODEL: z.string().optional(),
  /** Optional LLM-as-judge for attribution evals. */
  EVAL_ENABLE_LLM_JUDGE: z
    .string()
    .default("0")
    .transform((v) => v.trim() === "1" || v.trim().toLowerCase() === "true"),

  /** When true: StructMem event/entry writes, retrieval, and STRUCTURED EVENT MEMORY prompt block. */
  STRUCTMEM_ENABLED: z
    .string()
    .default("false")
    .transform((v) => {
      const s = v.trim().toLowerCase();
      return s === "1" || s === "true";
    }),

  /** When StructMem enabled, skip extractor-based session_memory_chunks for current_session candidates. */
  STRUCTMEM_SUPPRESS_EXTRACTOR_SESSION_CHUNKS: z
    .string()
    .default("false")
    .transform((v) => {
      const s = v.trim().toLowerCase();
      return s === "1" || s === "true";
    }),

  /**
   * When true with STRUCTMEM_ENABLED: persist StructMem rows from extractor `structmem_entries`
   * (current_session only) instead of mapping Phase-1 `memory_candidates`.
   */
  STRUCTMEM_NATIVE_EXTRACTOR: z
    .string()
    .default("false")
    .transform((v) => {
      const s = v.trim().toLowerCase();
      return s === "1" || s === "true";
    }),

  /** Top-K for vector retrieval over structmem_entries (same recent-window cutoff as session recall). */
  STRUCTMEM_ENTRY_RETRIEVAL_TOP_K: z
    .string()
    .default("6")
    .transform((v) => {
      const n = parseInt(v.trim(), 10);
      if (Number.isNaN(n) || n < 1) return 6;
      return Math.min(40, n);
    }),

  /** Phase 3: in-process current-session consolidation worker. */
  STRUCTMEM_CONSOLIDATION_ENABLED: z
    .string()
    .default("false")
    .transform((v) => {
      const s = v.trim().toLowerCase();
      return s === "1" || s === "true";
    }),
  STRUCTMEM_CONSOLIDATION_MODEL: z.string().default("EXTRACTOR_MODEL"),
  STRUCTMEM_MIN_UNCONSOLIDATED_TURNS: z
    .string()
    .default("8")
    .transform((v) => {
      const n = parseInt(v.trim(), 10);
      if (Number.isNaN(n) || n < 1) return 8;
      return Math.min(100, n);
    }),
  STRUCTMEM_MIN_UNCONSOLIDATED_ENTRIES: z
    .string()
    .default("12")
    .transform((v) => {
      const n = parseInt(v.trim(), 10);
      if (Number.isNaN(n) || n < 1) return 12;
      return Math.min(200, n);
    }),
  STRUCTMEM_SEED_K: z
    .string()
    .default("5")
    .transform((v) => {
      const n = parseInt(v.trim(), 10);
      if (Number.isNaN(n) || n < 0) return 5;
      return Math.min(20, n);
    }),
  STRUCTMEM_MAX_SEED_EVENTS: z
    .string()
    .default("5")
    .transform((v) => {
      const n = parseInt(v.trim(), 10);
      if (Number.isNaN(n) || n < 0) return 5;
      return Math.min(20, n);
    }),
  STRUCTMEM_MAX_ENTRIES_PER_EVENT: z
    .string()
    .default("6")
    .transform((v) => {
      const n = parseInt(v.trim(), 10);
      if (Number.isNaN(n) || n < 1) return 6;
      return Math.min(20, n);
    }),
  STRUCTMEM_MAX_BUFFER_ENTRIES: z
    .string()
    .default("20")
    .transform((v) => {
      const n = parseInt(v.trim(), 10);
      if (Number.isNaN(n) || n < 1) return 20;
      return Math.min(100, n);
    }),
  STRUCTMEM_MAX_SYNTHESIS_INPUT_TOKENS: z
    .string()
    .default("5000")
    .transform((v) => {
      const n = parseInt(v.trim(), 10);
      if (Number.isNaN(n) || n < 500) return 5000;
      return Math.min(20000, n);
    }),
  STRUCTMEM_JOB_MAX_ATTEMPTS: z
    .string()
    .default("3")
    .transform((v) => {
      const n = parseInt(v.trim(), 10);
      if (Number.isNaN(n) || n < 1) return 3;
      return Math.min(10, n);
    }),

  POST_TURN_JOB_POLL_INTERVAL_MS: z
    .string()
    .default("5000")
    .transform((v) => {
      const n = parseInt(v.trim(), 10);
      if (Number.isNaN(n) || n < 500) return 5000;
      return Math.min(60_000, Math.max(500, n));
    }),
  POST_TURN_JOB_LOCK_TTL_MS: z
    .string()
    .default("600000")
    .transform((v) => {
      const n = parseInt(v.trim(), 10);
      if (Number.isNaN(n) || n < 30_000) return 600_000;
      return Math.min(3_600_000, Math.max(30_000, n));
    }),
  POST_TURN_JOB_MAX_ATTEMPTS: z
    .string()
    .default("3")
    .transform((v) => {
      const n = parseInt(v.trim(), 10);
      if (Number.isNaN(n) || n < 1) return 3;
      return Math.min(10, n);
    }),
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
