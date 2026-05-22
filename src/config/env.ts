import dotenv from "dotenv";
import { z } from "zod";

dotenv.config();

/**
 * Shared flag parser used by ROLEPLAY_GRAPH_STREAM_ENABLED and available for
 * unit tests to verify parsing logic against the same code path.
 */
export function parseEnabledFlag(value: string | undefined): boolean {
  const s = (value ?? "false").trim().toLowerCase();
  return s === "1" || s === "true";
}

const envSchema = z.object({
  // Database
  // Connection string for the chatbot backend database.
  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),

  // Server
  // HTTP port and browser client origin.
  PORT: z
    .string()
    .default("4000")
    .transform((v) => parseInt(v, 10)),
  FRONTEND_ORIGIN: z.string().default("http://localhost:5173"),

  // App Defaults
  // Used when session creation omits player, character, thinking, or temperature.
  DEFAULT_PLAYER_ID: z.string().default("local_dev"),
  DEFAULT_CHARACTER_ID: z.string().default("zuo_ran"),
  DEFAULT_SESSION_THINKING: z
    .string()
    .default("true")
    .transform((v) => v.trim().toLowerCase() !== "false" && v !== "0"),
  DEFAULT_SESSION_TEMPERATURE: z
    .string()
    .default("1")
    .transform((v) => {
      const n = parseFloat(v.trim());
      if (Number.isNaN(n)) return 1;
      return Math.min(2, Math.max(0, n));
    }),

  // Provider Keys
  // Required model provider keys plus optional web-search key.
  OPENAI_API_KEY: z.string().min(1, "OPENAI_API_KEY is required"),
  ANTHROPIC_API_KEY: z.string().min(1, "ANTHROPIC_API_KEY is required"),
  DEEPSEEK_API_KEY: z.string().min(1, "DEEPSEEK_API_KEY is required"),
  TAVILY_API_KEY: z.string().optional(),

  // Model Bindings
  // Provider:model values used by generation, validation, extraction, and embeddings.
  GENERATION_MODEL: z.string().default("anthropic:claude-sonnet-4-5"),

  // Generation
  // Foreground response-generation output-token budget (draft + rewrite).
  // Raised above the previous hard-coded 4096 to accommodate reasoning-heavy models.
  GENERATION_MAX_TOKENS: z
    .string()
    .default("8192")
    .transform((v) => {
      const n = parseInt(v.trim(), 10);
      if (Number.isNaN(n) || n < 1) return 8192;
      if (n <= 4096) return 8192;
      return Math.min(16384, n);
    }),

  // Roleplay Graph Stream
  // Disabled by default. When true, roleplay turns use the Phase A graph-backed
  // stream adapter (runRoleplayTurnStreamViaGraph) instead of the existing
  // direct stream path. The graph path preserves the same SSE event order,
  // recall thought behavior, and persistence semantics.
  ROLEPLAY_GRAPH_STREAM_ENABLED: z
    .string()
    .default("false")
    .transform((v) => parseEnabledFlag(v)),

  // DeepSeek V4 Thinking Marker
  // Optional generation-only thinking-mode marker for deepseek:deepseek-v4-pro.
  // Allowed values: default, inner_os, no_inner_os.
  DEEPSEEK_V4_THINKING_MODE: z
    .string()
    .default("default")
    .transform((v) => {
      const s = v.trim().toLowerCase();
      if (s === "inner_os" || s === "no_inner_os") return s;
      return "default";
    }),
  SHOW_NATIVE_REASONING_EVENTS: z
    .string()
    .default("false")
    .transform((v) => v.trim().toLowerCase() === "true" || v.trim() === "1"),

  // DeepSeek V4 Thinking Marker Scope
  // When to inject the thinking marker. Allowed values: first_turn_only, every_generation.
  DEEPSEEK_V4_THINKING_MARKER_SCOPE: z
    .string()
    .default("every_generation")
    .transform((v) => {
      const s = v.trim().toLowerCase();
      if (s === "first_turn_only") return s;
      return "every_generation";
    }),
  VALIDATOR_MODEL: z.string().default("anthropic:claude-haiku-4-5"),
  EXTRACTOR_MODEL: z.string().default("deepseek:deepseek-v4-flash"),
  EMBEDDING_MODEL: z.string().default("openai:text-embedding-3-small"),
  EMBEDDING_DIMENSIONS: z
    .string()
    .default("1536")
    .transform((v) => parseInt(v, 10)),

  // Retrieval And Validation
  // Optional override knobs for canon retrieval, query rewriting, and evals.
  CANON_RETRIEVAL_PIPELINE: z
    .string()
    .default("tier3")
    .transform((v) => {
      const s = v.trim().toLowerCase();
      if (s === "tier1" || s === "tier3") return s;
      return "tier3";
    }),
  CANON_QUERY_HYDE: z
    .string()
    .default("0")
    .transform((v) => v.trim() === "1" || v.trim().toLowerCase() === "true"),
  USE_REWRITTEN_QUERY_FOR_MEMORY_EMBEDDING: z
    .string()
    .default("0")
    .transform((v) => v.trim() === "1" || v.trim().toLowerCase() === "true"),
  ANNOTATION_RULES_ALWAYS: z
    .string()
    .default("0")
    .transform((v) => v.trim() === "1" || v.trim().toLowerCase() === "true"),
  REWRITE_CONFIDENCE_THRESHOLD: z
    .string()
    .default("0.6")
    .transform((v) => {
      const n = parseFloat(v.trim());
      if (Number.isNaN(n)) return 0.6;
      return Math.min(1, Math.max(0, n));
    }),
  VALIDATOR_STRICT_ATTRIBUTION: z
    .string()
    .default("0")
    .transform((v) => v.trim() === "1" || v.trim().toLowerCase() === "true"),
  VALIDATOR_ATTRIBUTION_JUDGE_MODEL: z.string().optional(),
  EVAL_ENABLE_LLM_JUDGE: z
    .string()
    .default("0")
    .transform((v) => v.trim() === "1" || v.trim().toLowerCase() === "true"),

  // StructMem: Events And Entries
  // Per-turn structured memory writes, entry retrieval, and prompt injection.
  STRUCTMEM_ENABLED: z
    .string()
    .default("false")
    .transform((v) => {
      const s = v.trim().toLowerCase();
      return s === "1" || s === "true";
    }),
  STRUCTMEM_SUPPRESS_EXTRACTOR_SESSION_CHUNKS: z
    .string()
    .default("false")
    .transform((v) => {
      const s = v.trim().toLowerCase();
      return s === "1" || s === "true";
    }),
  STRUCTMEM_NATIVE_EXTRACTOR: z
    .string()
    .default("false")
    .transform((v) => {
      const s = v.trim().toLowerCase();
      return s === "1" || s === "true";
    }),
  STRUCTMEM_ENTRY_RETRIEVAL_TOP_K: z
    .string()
    .default("6")
    .transform((v) => {
      const n = parseInt(v.trim(), 10);
      if (Number.isNaN(n) || n < 1) return 6;
      return Math.min(40, n);
    }),

  // StructMem: Current-Session Consolidation
  // In-process consolidation worker thresholds, caps, retry limits, and model binding.
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

  // StructMem: Cross-Session Retrieval And Writeback
  // Direct cross-session synthesis retrieval plus conservative writeback/promotion gates.
  STRUCTMEM_CROSS_SESSION_RETRIEVAL_ENABLED: z
    .string()
    .default("false")
    .transform((v) => {
      const s = v.trim().toLowerCase();
      return s === "1" || s === "true";
    }),
  STRUCTMEM_CROSS_SESSION_RETRIEVAL_TOP_K: z
    .string()
    .default("4")
    .transform((v) => {
      const n = parseInt(v.trim(), 10);
      if (Number.isNaN(n) || n < 1) return 4;
      return Math.min(20, n);
    }),
  STRUCTMEM_CROSS_SESSION_WRITE_ENABLED: z
    .string()
    .default("false")
    .transform((v) => {
      const s = v.trim().toLowerCase();
      return s === "1" || s === "true";
    }),
  STRUCTMEM_PROMOTION_TO_IME_ENABLED: z
    .string()
    .default("false")
    .transform((v) => {
      const s = v.trim().toLowerCase();
      return s === "1" || s === "true";
    }),
  STRUCTMEM_CROSS_SESSION_MIN_CONFIDENCE: z
    .string()
    .default("0.75")
    .transform((v) => {
      const n = parseFloat(v.trim());
      if (Number.isNaN(n)) return 0.75;
      return Math.min(1, Math.max(0, n));
    }),

  // Memory Rerank
  // Model binding for the LLM that judges which retrieved context to inject.
  // Use EXTRACTOR_MODEL to reuse the extractor binding (same sentinel as STRUCTMEM_CONSOLIDATION_MODEL).
  MEMORY_RERANK_MODEL: z.string().default("EXTRACTOR_MODEL"),
  MEMORY_RERANK_MAX_CANDIDATES: z
    .string()
    .default("24")
    .transform((v) => {
      const n = parseInt(v.trim(), 10);
      if (Number.isNaN(n) || n < 1) return 24;
      return Math.min(50, Math.max(8, n));
    }),
  MEMORY_RERANK_MAX_SELECTED: z
    .string()
    .default("8")
    .transform((v) => {
      const n = parseInt(v.trim(), 10);
      if (Number.isNaN(n) || n < 1) return 8;
      return Math.min(24, Math.max(1, n));
    }),
  MEMORY_RERANK_TIMEOUT_MS: z
    .string()
    .default("30000")
    .transform((v) => {
      const n = parseInt(v.trim(), 10);
      if (Number.isNaN(n) || n < 1000) return 60000;
      return Math.min(300000, Math.max(1000, n));
    }),

  // StructMem: Motif Probe
  // Deterministic repeated-relationship-gesture detection and optional StructMem probe.
  STRUCTMEM_MOTIF_PROBE_ENABLED: z
    .string()
    .default("false")
    .transform((v) => {
      const s = v.trim().toLowerCase();
      return s === "1" || s === "true";
    }),
  STRUCTMEM_MOTIF_PROBE_TOP_K: z
    .string()
    .default("3")
    .transform((v) => {
      const n = parseInt(v.trim(), 10);
      if (Number.isNaN(n) || n < 1) return 3;
      return Math.min(10, n);
    }),
  STRUCTMEM_MOTIF_PROBE_MIN_SCORE: z
    .string()
    .default("0.5")
    .transform((v) => {
      const n = parseFloat(v.trim());
      if (Number.isNaN(n)) return 0.5;
      return Math.min(1, Math.max(0, n));
    }),
  STRUCTMEM_MOTIF_INJECT_MODE: z
    .string()
    .default("synthesis_only")
    .transform((v) => {
      const s = v.trim().toLowerCase();
      if (s === "entries_and_synthesis") return s;
      return "synthesis_only";
    }),

  // Background Jobs
  // Post-turn worker polling, lock TTL, and retry behavior.
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

  // LangSmith
  // Optional tracing, project metadata, and eval dataset name.
  TRACE_ENVIRONMENT: z.string().default(process.env.NODE_ENV ?? "development"),
  APP_VERSION: z.string().default("dev"),
  GIT_SHA: z.string().default("unknown"),
  TRACE_PLAYER_HASH_SALT: z.string().default("zuoran-local-trace-salt"),
  LANGSMITH_TRACING: z
    .string()
    .default("false")
    .transform((v) => v === "true"),
  LANGSMITH_API_KEY: z.string().optional(),
  LANGSMITH_PROJECT: z.string().default("zuoran-chatbot-phase1"),
  LANGSMITH_ENDPOINT: z
    .string()
    .default("https://api.smith.langchain.com"),
  LANGSMITH_EVAL_DATASET: z.string().default("zuoran-phase1-eval"),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error("Invalid environment variables:");
  for (const [field, issues] of Object.entries(
    parsed.error.flatten().fieldErrors,
  )) {
    console.error(`  ${field}: ${(issues as string[]).join(", ")}`);
  }
  process.exit(1);
}

export const env = parsed.data;
export type Env = typeof env;
