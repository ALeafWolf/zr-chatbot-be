import assert from "node:assert/strict";
import { describe, it } from "node:test";

// We test the functions by overriding env vars temporarily. Since the module
// reads process.env at call time (not at import time), we can set/unset env
// vars in each test.
import {
  ENV_RERANK_VARIANT,
  ENV_CONTEXT_PLANNER_VARIANT,
  ENV_RETRIEVAL_VARIANT,
  ENV_VALIDATOR_VARIANT,
  ENV_GRAPH_VERSION,
  readRerankVariant,
  readContextPlannerVariant,
  readRetrievalVariant,
  readValidatorVariant,
  readGraphVersion,
  readExperimentVariants,
  buildExperimentVariantMetadata,
  buildExperimentVariantTags,
  DEFAULT_RERANK_VARIANT,
  DEFAULT_CONTEXT_PLANNER_VARIANT,
  DEFAULT_RETRIEVAL_VARIANT,
  DEFAULT_VALIDATOR_VARIANT,
  DEFAULT_GRAPH_VERSION,
  RERANK_VARIANTS,
  CONTEXT_PLANNER_VARIANTS,
  RETRIEVAL_VARIANTS,
  VALIDATOR_VARIANTS,
  GRAPH_VERSIONS,
  validateExperimentVariants,
  readAndValidateExperimentVariants,
  getVariantRunMatrix,
} from "./experimentVariants";

describe("experiment variants", () => {
  // -----------------------------------------------------------------------
  // Default values (no env vars set)
  // -----------------------------------------------------------------------

  it("returns default values when no env vars are set", () => {
    // Clear all variant env vars
    const restore = withClearedEnv();

    const descriptor = readExperimentVariants();

    assert.equal(descriptor.graphVersion, DEFAULT_GRAPH_VERSION);
    assert.equal(descriptor.rerankVariant, DEFAULT_RERANK_VARIANT);
    assert.equal(descriptor.contextPlannerVariant, DEFAULT_CONTEXT_PLANNER_VARIANT);
    assert.equal(descriptor.retrievalVariant, DEFAULT_RETRIEVAL_VARIANT);
    assert.equal(descriptor.validatorVariant, DEFAULT_VALIDATOR_VARIANT);

    restore();
  });

  // -----------------------------------------------------------------------
  // Direct value parsing
  // -----------------------------------------------------------------------

  it("parses valid rerank variants directly", () => {
    for (const variant of RERANK_VARIANTS) {
      const restore = withEnv(ENV_RERANK_VARIANT, variant);
      assert.equal(readRerankVariant(), variant);
      restore();
    }
  });

  it("parses valid context planner variants directly", () => {
    for (const variant of CONTEXT_PLANNER_VARIANTS) {
      const restore = withEnv(ENV_CONTEXT_PLANNER_VARIANT, variant);
      assert.equal(readContextPlannerVariant(), variant);
      restore();
    }
  });

  it("parses valid retrieval variants directly", () => {
    for (const variant of RETRIEVAL_VARIANTS) {
      const restore = withEnv(ENV_RETRIEVAL_VARIANT, variant);
      assert.equal(readRetrievalVariant(), variant);
      restore();
    }
  });

  it("parses valid validator variants directly", () => {
    for (const variant of VALIDATOR_VARIANTS) {
      const restore = withEnv(ENV_VALIDATOR_VARIANT, variant);
      assert.equal(readValidatorVariant(), variant);
      restore();
    }
  });

  it("parses valid graph versions directly", () => {
    for (const version of GRAPH_VERSIONS) {
      const restore = withEnv(ENV_GRAPH_VERSION, version);
      assert.equal(readGraphVersion(), version);
      restore();
    }
  });

  // -----------------------------------------------------------------------
  // Alias normalization
  // -----------------------------------------------------------------------

  it("normalizes rerank alias llm_v1 to llm_rerank_v1", () => {
    const restore = withEnv(ENV_RERANK_VARIANT, "llm_v1");
    assert.equal(readRerankVariant(), "llm_rerank_v1");
    restore();
  });

  it("normalizes rerank alias smaller_model to llm_rerank_smaller_model", () => {
    const restore = withEnv(ENV_RERANK_VARIANT, "smaller_model");
    assert.equal(readRerankVariant(), "llm_rerank_smaller_model");
    restore();
  });

  it("normalizes rerank alias hybrid to hybrid_score", () => {
    const restore = withEnv(ENV_RERANK_VARIANT, "hybrid");
    assert.equal(readRerankVariant(), "hybrid_score");
    restore();
  });

  it("normalizes rerank alias deterministic to deterministic_only", () => {
    const restore = withEnv(ENV_RERANK_VARIANT, "deterministic");
    assert.equal(readRerankVariant(), "deterministic_only");
    restore();
  });

  // -----------------------------------------------------------------------
  // Graph version alias
  // -----------------------------------------------------------------------

  it("normalizes graph version alias v1 to turnGraph.v1", () => {
    const restore = withEnv(ENV_GRAPH_VERSION, "v1");
    assert.equal(readGraphVersion(), "turnGraph.v1");
    restore();
  });

  // -----------------------------------------------------------------------
  // Unsupported variant handling
  // -----------------------------------------------------------------------

  it("throws on unsupported rerank variant", () => {
    const restore = withEnv(ENV_RERANK_VARIANT, "bogus_rerank");
    assert.throws(() => readRerankVariant(), /Unsupported.*RERANK_VARIANT/);
    restore();
  });

  it("throws on unsupported context planner variant", () => {
    const restore = withEnv(ENV_CONTEXT_PLANNER_VARIANT, "bogus_planner");
    assert.throws(
      () => readContextPlannerVariant(),
      /Unsupported.*CONTEXT_PLANNER_VARIANT/,
    );
    restore();
  });

  it("throws on unsupported retrieval variant", () => {
    const restore = withEnv(ENV_RETRIEVAL_VARIANT, "bogus_retrieval");
    assert.throws(
      () => readRetrievalVariant(),
      /Unsupported.*RETRIEVAL_VARIANT/,
    );
    restore();
  });

  it("throws on unsupported validator variant", () => {
    const restore = withEnv(ENV_VALIDATOR_VARIANT, "bogus_validator");
    assert.throws(
      () => readValidatorVariant(),
      /Unsupported.*VALIDATOR_VARIANT/,
    );
    restore();
  });

  it("throws on unsupported graph version", () => {
    const restore = withEnv(ENV_GRAPH_VERSION, "v99");
    assert.throws(() => readGraphVersion(), /Unsupported.*GRAPH_VERSION/);
    restore();
  });

  // -----------------------------------------------------------------------
  // Override parameter takes precedence
  // -----------------------------------------------------------------------

  it("override parameter takes precedence over env var", () => {
    const restore = withEnv(ENV_RERANK_VARIANT, "hybrid_score");
    // Override with a different valid value
    assert.equal(readRerankVariant("llm_rerank_v1"), "llm_rerank_v1");
    restore();
  });

  // -----------------------------------------------------------------------
  // Metadata builder
  // -----------------------------------------------------------------------

  it("buildExperimentVariantMetadata includes all fields by default", () => {
    const restore = withClearedEnv();
    const meta = buildExperimentVariantMetadata();

    assert.equal(meta.graphVersion, DEFAULT_GRAPH_VERSION);
    assert.equal(meta.rerankVariant, DEFAULT_RERANK_VARIANT);
    assert.equal(meta.contextPlannerVariant, DEFAULT_CONTEXT_PLANNER_VARIANT);
    assert.equal(meta.retrievalVariant, DEFAULT_RETRIEVAL_VARIANT);
    assert.equal(meta.validatorVariant, DEFAULT_VALIDATOR_VARIANT);

    restore();
  });

  it("buildExperimentVariantMetadata compact mode omits defaults", () => {
    const restore = withClearedEnv();
    const meta = buildExperimentVariantMetadata(undefined, true);

    // All defaults → compact should return empty
    assert.equal(Object.keys(meta).length, 0);

    restore();
  });

  it("buildExperimentVariantMetadata compact mode includes non-default fields", () => {
    const restore = withEnv(ENV_RERANK_VARIANT, "deterministic_only");
    const meta = buildExperimentVariantMetadata(undefined, true);

    assert.equal(meta.rerankVariant, "deterministic_only");
    // Default fields should be omitted
    assert.equal(meta.graphVersion, undefined);
    assert.equal(meta.contextPlannerVariant, undefined);
    assert.equal(meta.retrievalVariant, undefined);
    assert.equal(meta.validatorVariant, undefined);

    restore();
  });

  it("buildExperimentVariantMetadata accepts explicit descriptor", () => {
    const meta = buildExperimentVariantMetadata(
      {
        graphVersion: "turnGraph.v1",
        rerankVariant: "hybrid_score",
        contextPlannerVariant: "structured_query",
        retrievalVariant: "hyde_enabled",
        validatorVariant: "strict_attribution",
      },
      false,
    );

    assert.equal(meta.rerankVariant, "hybrid_score");
    assert.equal(meta.contextPlannerVariant, "structured_query");
    assert.equal(meta.retrievalVariant, "hyde_enabled");
    assert.equal(meta.validatorVariant, "strict_attribution");
  });

  // -----------------------------------------------------------------------
  // Tag builder
  // -----------------------------------------------------------------------

  it("buildExperimentVariantTags compact mode omits default tags", () => {
    const restore = withClearedEnv();
    const tags = buildExperimentVariantTags();

    assert.deepEqual(tags, []);

    restore();
  });

  it("buildExperimentVariantTags compact mode includes non-default variant tags", () => {
    const restore = withEnv(ENV_RERANK_VARIANT, "deterministic_only");
    const tags = buildExperimentVariantTags();

    assert.ok(tags.includes("variant:rerank:deterministic_only"));
    // Default variants should not produce tags
    assert.ok(!tags.some((t) => t.startsWith("variant:retrieval:")));
    assert.ok(!tags.some((t) => t.startsWith("variant:validator:")));

    restore();
  });

  it("buildExperimentVariantTags non-compact mode includes all variant tags", () => {
    const restore = withClearedEnv();
    const tags = buildExperimentVariantTags(undefined, false);

    assert.ok(tags.includes(`variant:rerank:${DEFAULT_RERANK_VARIANT}`));
    assert.ok(
      tags.includes(
        `variant:context_planner:${DEFAULT_CONTEXT_PLANNER_VARIANT}`,
      ),
    );
    assert.ok(
      tags.includes(`variant:retrieval:${DEFAULT_RETRIEVAL_VARIANT}`),
    );
    assert.ok(
      tags.includes(`variant:validator:${DEFAULT_VALIDATOR_VARIANT}`),
    );
    assert.ok(tags.includes(`variant:graph:${DEFAULT_GRAPH_VERSION}`));

    restore();
  });

  // -----------------------------------------------------------------------
  // Edge cases: whitespace and case insensitivity
  // -----------------------------------------------------------------------

  it("handles whitespace around env var values", () => {
    const restore = withEnv(ENV_RERANK_VARIANT, "  HYBRID_SCORE  ");
    assert.equal(readRerankVariant(), "hybrid_score");
    restore();
  });

  it("handles case-insensitive env var values", () => {
    const restore = withEnv(ENV_RERANK_VARIANT, "DETERMINISTIC_ONLY");
    assert.equal(readRerankVariant(), "deterministic_only");
    restore();
  });

  // -----------------------------------------------------------------------
  // Guardrail validation
  // -----------------------------------------------------------------------

  describe("validateExperimentVariants", () => {
    it("passes validation with default (no-op) variants", () => {
      const restore = withClearedEnv();
      assert.doesNotThrow(() => validateExperimentVariants());
      restore();
    });

    it("passes validation with default variants explicitly", () => {
      assert.doesNotThrow(() =>
        validateExperimentVariants({
          graphVersion: "turnGraph.v1",
          rerankVariant: "llm_rerank_v1",
          contextPlannerVariant: "current",
          retrievalVariant: "tier3_current",
          validatorVariant: "current",
        }),
      );
    });

    it("throws for hyde_enabled when CANON_QUERY_HYDE is not set", () => {
      const restore = clearGuardrailEnv();
      assert.throws(
        () =>
          validateExperimentVariants({
            graphVersion: "turnGraph.v1",
            rerankVariant: "llm_rerank_v1",
            contextPlannerVariant: "current",
            retrievalVariant: "hyde_enabled",
            validatorVariant: "current",
          }),
        /CANON_QUERY_HYDE/,
      );
      restore();
    });

    it("passes for hyde_enabled when CANON_QUERY_HYDE=1", () => {
      const restore = setGuardrailEnv("CANON_QUERY_HYDE", "1");
      assert.doesNotThrow(() =>
        validateExperimentVariants({
          graphVersion: "turnGraph.v1",
          rerankVariant: "llm_rerank_v1",
          contextPlannerVariant: "current",
          retrievalVariant: "hyde_enabled",
          validatorVariant: "current",
        }),
      );
      restore();
    });

    it("throws for motif_probe_enabled when STRUCTMEM_MOTIF_PROBE_ENABLED is not set", () => {
      const restore = clearGuardrailEnv();
      assert.throws(
        () =>
          validateExperimentVariants({
            graphVersion: "turnGraph.v1",
            rerankVariant: "llm_rerank_v1",
            contextPlannerVariant: "current",
            retrievalVariant: "motif_probe_enabled",
            validatorVariant: "current",
          }),
        /STRUCTMEM_MOTIF_PROBE_ENABLED/,
      );
      restore();
    });

    it("passes for motif_probe_enabled when STRUCTMEM_MOTIF_PROBE_ENABLED=1", () => {
      const restore = setGuardrailEnv("STRUCTMEM_MOTIF_PROBE_ENABLED", "1");
      assert.doesNotThrow(() =>
        validateExperimentVariants({
          graphVersion: "turnGraph.v1",
          rerankVariant: "llm_rerank_v1",
          contextPlannerVariant: "current",
          retrievalVariant: "motif_probe_enabled",
          validatorVariant: "current",
        }),
      );
      restore();
    });

    it("throws for strict_attribution when VALIDATOR_STRICT_ATTRIBUTION is not set", () => {
      const restore = clearGuardrailEnv();
      assert.throws(
        () =>
          validateExperimentVariants({
            graphVersion: "turnGraph.v1",
            rerankVariant: "llm_rerank_v1",
            contextPlannerVariant: "current",
            retrievalVariant: "tier3_current",
            validatorVariant: "strict_attribution",
          }),
        /VALIDATOR_STRICT_ATTRIBUTION/,
      );
      restore();
    });

    it("passes for strict_attribution when VALIDATOR_STRICT_ATTRIBUTION=1", () => {
      const restore = setGuardrailEnv("VALIDATOR_STRICT_ATTRIBUTION", "1");
      assert.doesNotThrow(() =>
        validateExperimentVariants({
          graphVersion: "turnGraph.v1",
          rerankVariant: "llm_rerank_v1",
          contextPlannerVariant: "current",
          retrievalVariant: "tier3_current",
          validatorVariant: "strict_attribution",
        }),
      );
      restore();
    });

    it("throws for validatorVariant=lightweight (not implemented)", () => {
      assert.throws(
        () =>
          validateExperimentVariants({
            graphVersion: "turnGraph.v1",
            rerankVariant: "llm_rerank_v1",
            contextPlannerVariant: "current",
            retrievalVariant: "tier3_current",
            validatorVariant: "lightweight",
          }),
        /not yet implemented/,
      );
    });

    it("throws for contextPlannerVariant=no_rewrite (not implemented)", () => {
      assert.throws(
        () =>
          validateExperimentVariants({
            graphVersion: "turnGraph.v1",
            rerankVariant: "llm_rerank_v1",
            contextPlannerVariant: "no_rewrite",
            retrievalVariant: "tier3_current",
            validatorVariant: "current",
          }),
        /not yet implemented/,
      );
    });
  });

  describe("readAndValidateExperimentVariants", () => {
    it("returns a descriptor when all variants are valid (default env)", () => {
      const restore = clearGuardrailEnv();
      const d = readAndValidateExperimentVariants();
      assert.equal(d.rerankVariant, "llm_rerank_v1");
      assert.equal(d.retrievalVariant, "tier3_current");
      assert.equal(d.validatorVariant, "current");
      restore();
    });

    it("throws VariantGuardrailError for hyde_enabled without CANON_QUERY_HYDE", () => {
      const restore = clearGuardrailEnv();
      const prev = process.env.ENV_RETRIEVAL_VARIANT;
      process.env.RETRIEVAL_VARIANT = "hyde_enabled";
      assert.throws(
        () => readAndValidateExperimentVariants(),
        /CANON_QUERY_HYDE/,
      );
      if (prev !== undefined) process.env.RETRIEVAL_VARIANT = prev;
      else delete process.env.RETRIEVAL_VARIANT;
      restore();
    });
  });

  // -----------------------------------------------------------------------
  // Variant run matrix
  // -----------------------------------------------------------------------

  describe("getVariantRunMatrix", () => {
    it("returns entries for all variant categories", () => {
      const matrix = getVariantRunMatrix();
      assert.ok(matrix.graphVersion);
      assert.ok(matrix.rerankVariant);
      assert.ok(matrix.retrievalVariant);
      assert.ok(matrix.contextPlannerVariant);
      assert.ok(matrix.validatorVariant);
    });

    it("each variant option has required fields", () => {
      const matrix = getVariantRunMatrix();
      for (const [, options] of Object.entries(matrix)) {
        for (const opt of options) {
          assert.ok(typeof opt.envVar === "string");
          assert.ok(typeof opt.value === "string");
          assert.ok(typeof opt.description === "string");
          assert.ok(typeof opt.isDefault === "boolean");
          assert.ok(Array.isArray(opt.requiredEnvVars));
          assert.ok(typeof opt.implemented === "boolean");
        }
      }
    });
  });
});

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

function withEnv(key: string, value: string): () => void {
  const previous = process.env[key];
  process.env[key] = value;
  return () => {
    if (previous === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = previous;
    }
  };
}

function setGuardrailEnv(key: string, value: string): () => void {
  return withEnv(key, value);
}

function clearGuardrailEnv(): () => void {
  const keys = [
    "CANON_QUERY_HYDE",
    "STRUCTMEM_MOTIF_PROBE_ENABLED",
    "VALIDATOR_STRICT_ATTRIBUTION",
  ];
  const prev: Record<string, string | undefined> = {};
  for (const k of keys) {
    prev[k] = process.env[k];
    delete process.env[k];
  }
  return () => {
    for (const k of keys) {
      if (prev[k] === undefined) {
        delete process.env[k];
      } else {
        process.env[k] = prev[k];
      }
    }
  };
}

function withClearedEnv(): () => void {
  const keys = [
    ENV_RERANK_VARIANT,
    ENV_CONTEXT_PLANNER_VARIANT,
    ENV_RETRIEVAL_VARIANT,
    ENV_VALIDATOR_VARIANT,
    ENV_GRAPH_VERSION,
  ] as const;
  const previous = {} as Record<string, string | undefined>;
  for (const key of keys) {
    previous[key] = process.env[key];
    delete process.env[key];
  }
  return () => {
    for (const key of keys) {
      if (previous[key] === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = previous[key];
      }
    }
  };
}
