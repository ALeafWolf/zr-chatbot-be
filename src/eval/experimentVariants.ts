/**
 * Experiment variant metadata helper.
 *
 * Provides normalized env-var parsing, alias resolution, and metadata/tag
 * builders so LangSmith experiments carry stable variant labels.
 *
 * Default values preserve current runtime behavior.
 */

// ---------------------------------------------------------------------------
// Type definitions
// ---------------------------------------------------------------------------

export const GRAPH_VERSIONS = ["turnGraph.v1"] as const;
export type GraphVersion = (typeof GRAPH_VERSIONS)[number];

export const RERANK_VARIANTS = [
  "llm_rerank_v1",
  "llm_rerank_smaller_model",
  "hybrid_score",
  "deterministic_only",
] as const;
export type RerankVariant = (typeof RERANK_VARIANTS)[number];

export const CONTEXT_PLANNER_VARIANTS = [
  "current",
  "structured_query",
  "no_rewrite",
] as const;
export type ContextPlannerVariant = (typeof CONTEXT_PLANNER_VARIANTS)[number];

export const RETRIEVAL_VARIANTS = [
  "tier3_current",
  "hyde_enabled",
  "motif_probe_enabled",
] as const;
export type RetrievalVariant = (typeof RETRIEVAL_VARIANTS)[number];

export const VALIDATOR_VARIANTS = [
  "current",
  "strict_attribution",
  "lightweight",
] as const;
export type ValidatorVariant = (typeof VALIDATOR_VARIANTS)[number];

export interface ExperimentVariantDescriptor {
  graphVersion: GraphVersion;
  rerankVariant: RerankVariant;
  contextPlannerVariant: ContextPlannerVariant;
  retrievalVariant: RetrievalVariant;
  validatorVariant: ValidatorVariant;
}

// ---------------------------------------------------------------------------
// Env var defaults
// ---------------------------------------------------------------------------

export const DEFAULT_GRAPH_VERSION: GraphVersion = "turnGraph.v1";
export const DEFAULT_RERANK_VARIANT: RerankVariant = "llm_rerank_v1";
export const DEFAULT_CONTEXT_PLANNER_VARIANT: ContextPlannerVariant = "current";
export const DEFAULT_RETRIEVAL_VARIANT: RetrievalVariant = "tier3_current";
export const DEFAULT_VALIDATOR_VARIANT: ValidatorVariant = "current";

// ---------------------------------------------------------------------------
// Env var names
// ---------------------------------------------------------------------------

export const ENV_GRAPH_VERSION = "LANGSMITH_EXPERIMENT_GRAPH_VERSION";
export const ENV_RERANK_VARIANT = "RERANK_VARIANT";
export const ENV_CONTEXT_PLANNER_VARIANT = "CONTEXT_PLANNER_VARIANT";
export const ENV_RETRIEVAL_VARIANT = "RETRIEVAL_VARIANT";
export const ENV_VALIDATOR_VARIANT = "VALIDATOR_VARIANT";

// ---------------------------------------------------------------------------
// Alias normalization maps
// ---------------------------------------------------------------------------

const RERANK_ALIASES: Record<string, RerankVariant> = {
  llm_v1: "llm_rerank_v1",
  smaller_model: "llm_rerank_smaller_model",
  hybrid: "hybrid_score",
  deterministic: "deterministic_only",
};

const CONTEXT_PLANNER_ALIASES: Record<string, ContextPlannerVariant> = {};

const RETRIEVAL_ALIASES: Record<string, RetrievalVariant> = {};

const VALIDATOR_ALIASES: Record<string, ValidatorVariant> = {};

// ---------------------------------------------------------------------------
// Normalization helpers
// ---------------------------------------------------------------------------

function normalizeVariant<T extends string>(
  raw: string | undefined,
  defaults: T,
  valid: readonly T[],
  aliases: Record<string, T>,
  envName: string,
): T {
  const value = (raw ?? "").trim().toLowerCase();
  if (!value) return defaults;

  // Direct match
  if ((valid as readonly string[]).includes(value)) return value as T;

  // Alias match
  const alias = aliases[value];
  if (alias !== undefined) return alias;

  // Also try removing underscores for alias lookup (for common misspellings)
  const noUnderscore = value.replace(/_/g, "");
  for (const [aliasKey, aliasValue] of Object.entries(aliases)) {
    if (aliasKey.replace(/_/g, "") === noUnderscore) return aliasValue;
  }

  throw new Error(
    `Unsupported ${envName}: "${raw?.trim() ?? ""}". ` +
      `Valid values: ${valid.join(", ")}`,
  );
}

/**
 * Read and normalize `RERANK_VARIANT` from the environment.
 */
export function readRerankVariant(
  overrides?: string,
): RerankVariant {
  return normalizeVariant(
    overrides ?? process.env[ENV_RERANK_VARIANT],
    DEFAULT_RERANK_VARIANT,
    RERANK_VARIANTS,
    RERANK_ALIASES,
    ENV_RERANK_VARIANT,
  );
}

/**
 * Read and normalize `CONTEXT_PLANNER_VARIANT` from the environment.
 */
export function readContextPlannerVariant(
  overrides?: string,
): ContextPlannerVariant {
  return normalizeVariant(
    overrides ?? process.env[ENV_CONTEXT_PLANNER_VARIANT],
    DEFAULT_CONTEXT_PLANNER_VARIANT,
    CONTEXT_PLANNER_VARIANTS,
    CONTEXT_PLANNER_ALIASES,
    ENV_CONTEXT_PLANNER_VARIANT,
  );
}

/**
 * Read and normalize `RETRIEVAL_VARIANT` from the environment.
 */
export function readRetrievalVariant(
  overrides?: string,
): RetrievalVariant {
  return normalizeVariant(
    overrides ?? process.env[ENV_RETRIEVAL_VARIANT],
    DEFAULT_RETRIEVAL_VARIANT,
    RETRIEVAL_VARIANTS,
    RETRIEVAL_ALIASES,
    ENV_RETRIEVAL_VARIANT,
  );
}

/**
 * Read and normalize `VALIDATOR_VARIANT` from the environment.
 */
export function readValidatorVariant(
  overrides?: string,
): ValidatorVariant {
  return normalizeVariant(
    overrides ?? process.env[ENV_VALIDATOR_VARIANT],
    DEFAULT_VALIDATOR_VARIANT,
    VALIDATOR_VARIANTS,
    VALIDATOR_ALIASES,
    ENV_VALIDATOR_VARIANT,
  );
}

/**
 * Read and normalize `LANGSMITH_EXPERIMENT_GRAPH_VERSION` from the environment.
 */
export function readGraphVersion(overrides?: string): GraphVersion {
  const raw = (overrides ?? process.env[ENV_GRAPH_VERSION] ?? "").trim().toLowerCase();
  if (!raw) return DEFAULT_GRAPH_VERSION;

  // Alias: "v1" -> "turnGraph.v1"
  if (raw === "v1") return "turnGraph.v1";

  // Case-insensitive match against valid versions
  const matched = GRAPH_VERSIONS.find(
    (v) => v.toLowerCase() === raw,
  );
  if (matched) return matched;

  throw new Error(
    `Unsupported ${ENV_GRAPH_VERSION}: "${overrides ?? process.env[ENV_GRAPH_VERSION] ?? ""}". ` +
      `Valid values: ${GRAPH_VERSIONS.join(", ")}`,
  );
}

// ---------------------------------------------------------------------------
// Composite readers
// ---------------------------------------------------------------------------

/**
 * Read all variant env vars and return a normalized descriptor.
 */
export function readExperimentVariants(): ExperimentVariantDescriptor {
  return {
    graphVersion: readGraphVersion(),
    rerankVariant: readRerankVariant(),
    contextPlannerVariant: readContextPlannerVariant(),
    retrievalVariant: readRetrievalVariant(),
    validatorVariant: readValidatorVariant(),
  };
}

// ---------------------------------------------------------------------------
// Guardrail validation
// ---------------------------------------------------------------------------

/**
 * Environment variable names checked by guardrails.
 * Reuses the same env vars already defined in src/config/env.ts.
 */
const ENV_CANON_QUERY_HYDE = "CANON_QUERY_HYDE";
const ENV_STRUCTMEM_MOTIF_PROBE_ENABLED = "STRUCTMEM_MOTIF_PROBE_ENABLED";
const ENV_VALIDATOR_STRICT_ATTRIBUTION = "VALIDATOR_STRICT_ATTRIBUTION";

function isEnvTruthy(key: string): boolean {
  const v = process.env[key] ?? "";
  return v.trim() === "1" || v.trim().toLowerCase() === "true";
}

/**
 * Guardrail error type with a stable error code.
 */
export class VariantGuardrailError extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "VariantGuardrailError";
    this.code = code;
  }
}

/**
 * Validate that the selected experiment variants are compatible with the
 * current environment configuration.
 *
 * Throws `VariantGuardrailError` when a variant requires an env var that is
 * not enabled, or when a variant is not yet implemented.
 *
 * Call this at experiment setup time (CLI or LangSmith experiment runner)
 * to catch misconfigurations early.
 */
export function validateExperimentVariants(
  descriptor?: ExperimentVariantDescriptor,
): void {
  const d = descriptor ?? readExperimentVariants();

  // retrievalVariant guardrails
  if (d.retrievalVariant === "hyde_enabled") {
    if (!isEnvTruthy(ENV_CANON_QUERY_HYDE)) {
      throw new VariantGuardrailError(
        "HYDE_NOT_ENABLED",
        `RETRIEVAL_VARIANT=hyde_enabled requires CANON_QUERY_HYDE=1. ` +
        `Set CANON_QUERY_HYDE=1 in your environment or use RETRIEVAL_VARIANT=tier3_current.`,
      );
    }
  }

  if (d.retrievalVariant === "motif_probe_enabled") {
    if (!isEnvTruthy(ENV_STRUCTMEM_MOTIF_PROBE_ENABLED)) {
      throw new VariantGuardrailError(
        "MOTIF_PROBE_NOT_ENABLED",
        `RETRIEVAL_VARIANT=motif_probe_enabled requires STRUCTMEM_MOTIF_PROBE_ENABLED=1. ` +
        `Set STRUCTMEM_MOTIF_PROBE_ENABLED=1 in your environment or use RETRIEVAL_VARIANT=tier3_current.`,
      );
    }
  }

  // validatorVariant guardrails
  if (d.validatorVariant === "strict_attribution") {
    if (!isEnvTruthy(ENV_VALIDATOR_STRICT_ATTRIBUTION)) {
      throw new VariantGuardrailError(
        "STRICT_ATTRIBUTION_NOT_ENABLED",
        `VALIDATOR_VARIANT=strict_attribution requires VALIDATOR_STRICT_ATTRIBUTION=1. ` +
        `Set VALIDATOR_STRICT_ATTRIBUTION=1 in your environment or use VALIDATOR_VARIANT=current.`,
      );
    }
  }

  if (d.validatorVariant === "lightweight") {
    throw new VariantGuardrailError(
      "LIGHTWEIGHT_VALIDATOR_NOT_IMPLEMENTED",
      `VALIDATOR_VARIANT=lightweight is not yet implemented. ` +
      `Use VALIDATOR_VARIANT=current until a lightweight validator path is available.`,
    );
  }

  // contextPlannerVariant guardrails
  if (d.contextPlannerVariant === "no_rewrite") {
    throw new VariantGuardrailError(
      "NO_REWRITE_PLANNER_NOT_IMPLEMENTED",
      `CONTEXT_PLANNER_VARIANT=no_rewrite is not yet implemented. ` +
      `Use CONTEXT_PLANNER_VARIANT=current until a no-rewrite planner path is available.`,
    );
  }
}

/**
 * Read all variant env vars and validate them.
 * Returns the normalized descriptor if validation passes.
 * Throws VariantGuardrailError if a variant is misconfigured.
 */
export function readAndValidateExperimentVariants(): ExperimentVariantDescriptor {
  const d = readExperimentVariants();
  validateExperimentVariants(d);
  return d;
}

// ---------------------------------------------------------------------------
// Variant run matrix helper
// ---------------------------------------------------------------------------

/**
 * Information about a single variant configuration option.
 */
export interface VariantOption {
  /** The env var name. */
  envVar: string;
  /** The variant value. */
  value: string;
  /** Human-readable summary of what this variant does. */
  description: string;
  /** Whether this is the default value. */
  isDefault: boolean;
  /** Env var dependencies required for this variant (empty = none). */
  requiredEnvVars: string[];
  /** Whether this variant is fully implemented. */
  implemented: boolean;
}

/**
 * Return a table of all supported variant configurations for documentation
 * and the variant run matrix.
 */
export function getVariantRunMatrix(): Record<string, VariantOption[]> {
  return {
    graphVersion: [
      {
        envVar: "LANGSMITH_EXPERIMENT_GRAPH_VERSION",
        value: "turnGraph.v1",
        description: "Current turn graph version (default).",
        isDefault: true,
        requiredEnvVars: [],
        implemented: true,
      },
    ],
    rerankVariant: [
      {
        envVar: "RERANK_VARIANT",
        value: "llm_rerank_v1",
        description: "Current LLM-based reranker (default).",
        isDefault: true,
        requiredEnvVars: ["MEMORY_RERANK_MODEL"],
        implemented: true,
      },
      {
        envVar: "RERANK_VARIANT",
        value: "llm_rerank_smaller_model",
        description: "LLM rerank with smaller/cheaper model (controlled by MEMORY_RERANK_MODEL).",
        isDefault: false,
        requiredEnvVars: ["MEMORY_RERANK_MODEL"],
        implemented: true,
      },
      {
        envVar: "RERANK_VARIANT",
        value: "hybrid_score",
        description: "Non-LLM hybrid score-based selector (score + source priority + planner intent).",
        isDefault: false,
        requiredEnvVars: [],
        implemented: true,
      },
      {
        envVar: "RERANK_VARIANT",
        value: "deterministic_only",
        description: "Deterministic context selector only (skips LLM rerank entirely).",
        isDefault: false,
        requiredEnvVars: [],
        implemented: true,
      },
    ],
    retrievalVariant: [
      {
        envVar: "RETRIEVAL_VARIANT",
        value: "tier3_current",
        description: "Current Tier-3 retrieval pipeline (default).",
        isDefault: true,
        requiredEnvVars: [],
        implemented: true,
      },
      {
        envVar: "RETRIEVAL_VARIANT",
        value: "hyde_enabled",
        description: "Tier-3 retrieval with HyDE query expansion enabled. Requires CANON_QUERY_HYDE=1.",
        isDefault: false,
        requiredEnvVars: ["CANON_QUERY_HYDE=1"],
        implemented: true,
      },
      {
        envVar: "RETRIEVAL_VARIANT",
        value: "motif_probe_enabled",
        description: "Tier-3 retrieval with StructMem motif probing enabled. Requires STRUCTMEM_MOTIF_PROBE_ENABLED=1.",
        isDefault: false,
        requiredEnvVars: ["STRUCTMEM_MOTIF_PROBE_ENABLED=1"],
        implemented: true,
      },
    ],
    contextPlannerVariant: [
      {
        envVar: "CONTEXT_PLANNER_VARIANT",
        value: "current",
        description: "Current context planner (default).",
        isDefault: true,
        requiredEnvVars: [],
        implemented: true,
      },
      {
        envVar: "CONTEXT_PLANNER_VARIANT",
        value: "structured_query",
        description: "Structured-query planner path (explicitly labeled).",
        isDefault: false,
        requiredEnvVars: [],
        implemented: false,
      },
      {
        envVar: "CONTEXT_PLANNER_VARIANT",
        value: "no_rewrite",
        description: "No-rewrite planner (not yet implemented).",
        isDefault: false,
        requiredEnvVars: [],
        implemented: false,
      },
    ],
    validatorVariant: [
      {
        envVar: "VALIDATOR_VARIANT",
        value: "current",
        description: "Current response validator (default).",
        isDefault: true,
        requiredEnvVars: [],
        implemented: true,
      },
      {
        envVar: "VALIDATOR_VARIANT",
        value: "strict_attribution",
        description: "Validator with strict attribution checks. Requires VALIDATOR_STRICT_ATTRIBUTION=1.",
        isDefault: false,
        requiredEnvVars: ["VALIDATOR_STRICT_ATTRIBUTION=1"],
        implemented: true,
      },
      {
        envVar: "VALIDATOR_VARIANT",
        value: "lightweight",
        description: "Lightweight validator (not yet implemented).",
        isDefault: false,
        requiredEnvVars: [],
        implemented: false,
      },
    ],
  };
}

/**
 * Format the variant run matrix as a Markdown table string.
 * Useful for including in generated documentation.
 */
export function formatVariantRunMatrixMarkdown(): string {
  const matrix = getVariantRunMatrix();
  const lines: string[] = [];

  lines.push("## Variant Run Matrix");
  lines.push("");

  for (const [category, options] of Object.entries(matrix)) {
    lines.push(`### ${category.replace(/([A-Z])/g, " $1").trim()}`);
    lines.push("");
    lines.push("| Env Var | Value | Description | Required Env Vars | Status |");
    lines.push("|---------|-------|-------------|-------------------|--------|");

    for (const opt of options) {
      const status = opt.implemented
        ? opt.isDefault
          ? "default"
          : "implemented"
        : "not implemented";
      lines.push(
        `| \`${opt.envVar}\` | \`${opt.value}\` | ${opt.description} | ${opt.requiredEnvVars.join(", ") || "—"} | ${status} |`,
      );
    }
    lines.push("");
  }

  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Metadata and tag builders
// ---------------------------------------------------------------------------

/**
 * Build a flat metadata object suitable for LangSmith trace/experiment metadata.
 *
 * The returned object omits fields that match their default values when
 * `compact` is true, keeping experiment metadata easy to scan.
 */
export function buildExperimentVariantMetadata(
  descriptor?: ExperimentVariantDescriptor,
  compact = false,
): Record<string, string> {
  const d = descriptor ?? readExperimentVariants();
  if (compact) {
    const meta: Record<string, string> = {};
    if (d.graphVersion !== DEFAULT_GRAPH_VERSION) {
      meta.graphVersion = d.graphVersion;
    }
    if (d.rerankVariant !== DEFAULT_RERANK_VARIANT) {
      meta.rerankVariant = d.rerankVariant;
    }
    if (d.contextPlannerVariant !== DEFAULT_CONTEXT_PLANNER_VARIANT) {
      meta.contextPlannerVariant = d.contextPlannerVariant;
    }
    if (d.retrievalVariant !== DEFAULT_RETRIEVAL_VARIANT) {
      meta.retrievalVariant = d.retrievalVariant;
    }
    if (d.validatorVariant !== DEFAULT_VALIDATOR_VARIANT) {
      meta.validatorVariant = d.validatorVariant;
    }
    return meta;
  }
  return {
    graphVersion: d.graphVersion,
    rerankVariant: d.rerankVariant,
    contextPlannerVariant: d.contextPlannerVariant,
    retrievalVariant: d.retrievalVariant,
    validatorVariant: d.validatorVariant,
  };
}

/**
 * Build variant tags suitable for LangSmith trace tagging.
 *
 * Example output:
 * ```txt
 * variant:rerank:llm_rerank_v1
 * variant:retrieval:tier3_current
 * variant:validator:current
 * ```
 *
 * Tags are compact and low-cardinality. Fields matching the default value are
 * omitted when `compact` is true.
 */
export function buildExperimentVariantTags(
  descriptor?: ExperimentVariantDescriptor,
  compact = true,
): string[] {
  const d = descriptor ?? readExperimentVariants();
  const tags: string[] = [];

  if (!compact || d.rerankVariant !== DEFAULT_RERANK_VARIANT) {
    tags.push(`variant:rerank:${d.rerankVariant}`);
  }
  if (!compact || d.contextPlannerVariant !== DEFAULT_CONTEXT_PLANNER_VARIANT) {
    tags.push(`variant:context_planner:${d.contextPlannerVariant}`);
  }
  if (!compact || d.retrievalVariant !== DEFAULT_RETRIEVAL_VARIANT) {
    tags.push(`variant:retrieval:${d.retrievalVariant}`);
  }
  if (!compact || d.validatorVariant !== DEFAULT_VALIDATOR_VARIANT) {
    tags.push(`variant:validator:${d.validatorVariant}`);
  }
  if (!compact || d.graphVersion !== DEFAULT_GRAPH_VERSION) {
    tags.push(`variant:graph:${d.graphVersion}`);
  }

  return tags;
}
