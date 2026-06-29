import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  ENV_RERANK_VARIANT, ENV_CONTEXT_PLANNER_VARIANT, ENV_RETRIEVAL_VARIANT, ENV_VALIDATOR_VARIANT, ENV_GRAPH_VERSION,
  readRerankVariant, readContextPlannerVariant, readRetrievalVariant, readValidatorVariant, readGraphVersion,
  readExperimentVariants, buildExperimentVariantMetadata, buildExperimentVariantTags,
  DEFAULT_RERANK_VARIANT, DEFAULT_CONTEXT_PLANNER_VARIANT, DEFAULT_RETRIEVAL_VARIANT, DEFAULT_VALIDATOR_VARIANT, DEFAULT_GRAPH_VERSION,
  RERANK_VARIANTS, CONTEXT_PLANNER_VARIANTS, RETRIEVAL_VARIANTS, VALIDATOR_VARIANTS, GRAPH_VERSIONS,
  validateExperimentVariants, readAndValidateExperimentVariants, getVariantRunMatrix,
  readEmotionalAxisVariant, resolveEmotionalAxisVariantConfig,
  buildEmotionalAxisVariantMetadata, buildEmotionalAxisVariantTags,
  DEFAULT_EMOTIONAL_AXIS_VARIANT,
  validateEmotionalAxisVariantGuard,
} from "./experimentVariants";

describe("experiment variants", () => {
  it("returns defaults when no env vars are set, and override parameter takes precedence", () => {
    const r1 = withClearedEnv();
    const d = readExperimentVariants();
    assert.equal(d.graphVersion, DEFAULT_GRAPH_VERSION, "default graph");
    assert.equal(d.rerankVariant, DEFAULT_RERANK_VARIANT, "default rerank");
    assert.equal(d.contextPlannerVariant, DEFAULT_CONTEXT_PLANNER_VARIANT, "default planner");
    assert.equal(d.retrievalVariant, DEFAULT_RETRIEVAL_VARIANT, "default retrieval");
    assert.equal(d.validatorVariant, DEFAULT_VALIDATOR_VARIANT, "default validator");
    r1();
    // Override takes precedence
    const r2 = withEnv(ENV_RERANK_VARIANT, "hybrid_score");
    assert.equal(readRerankVariant("llm_rerank_v1"), "llm_rerank_v1", "override wins");
    r2();
  });

  it("parses valid variants for all categories and normalizes aliases", () => {
    for (const v of RERANK_VARIANTS) { const r = withEnv(ENV_RERANK_VARIANT, v); assert.equal(readRerankVariant(), v, `rerank ${v}`); r(); }
    for (const v of CONTEXT_PLANNER_VARIANTS) { const r = withEnv(ENV_CONTEXT_PLANNER_VARIANT, v); assert.equal(readContextPlannerVariant(), v, `planner ${v}`); r(); }
    for (const v of RETRIEVAL_VARIANTS) { const r = withEnv(ENV_RETRIEVAL_VARIANT, v); assert.equal(readRetrievalVariant(), v, `retrieval ${v}`); r(); }
    for (const v of VALIDATOR_VARIANTS) { const r = withEnv(ENV_VALIDATOR_VARIANT, v); assert.equal(readValidatorVariant(), v, `validator ${v}`); r(); }
    for (const v of GRAPH_VERSIONS) { const r = withEnv(ENV_GRAPH_VERSION, v); assert.equal(readGraphVersion(), v, `graph ${v}`); r(); }
    // Aliases
    const aliasCases: Array<[string, string, string]> = [
      [ENV_RERANK_VARIANT, "llm_v1", "llm_rerank_v1"], [ENV_RERANK_VARIANT, "smaller_model", "llm_rerank_smaller_model"],
      [ENV_RERANK_VARIANT, "hybrid", "hybrid_score"], [ENV_RERANK_VARIANT, "deterministic", "deterministic_only"],
      [ENV_GRAPH_VERSION, "v1", "turnGraph.v1"],
    ];
    for (const [key, input, expected] of aliasCases) { const r = withEnv(key, input); assert.equal(key === ENV_RERANK_VARIANT ? readRerankVariant() : readGraphVersion(), expected, `alias ${input}→${expected}`); r(); }
    // Whitespace / case
    const r1 = withEnv(ENV_RERANK_VARIANT, "  HYBRID_SCORE  "); assert.equal(readRerankVariant(), "hybrid_score", "whitespace/case"); r1();
    const r2 = withEnv(ENV_RERANK_VARIANT, "DETERMINISTIC_ONLY"); assert.equal(readRerankVariant(), "deterministic_only", "case"); r2();
  });

  it("throws on unsupported variants for all categories", () => {
    const r1 = withEnv(ENV_RERANK_VARIANT, "bogus_rerank"); assert.throws(() => readRerankVariant(), /Unsupported.*RERANK_VARIANT/); r1();
    const r2 = withEnv(ENV_CONTEXT_PLANNER_VARIANT, "bogus_planner"); assert.throws(() => readContextPlannerVariant(), /Unsupported.*CONTEXT_PLANNER_VARIANT/); r2();
    const r3 = withEnv(ENV_RETRIEVAL_VARIANT, "bogus_retrieval"); assert.throws(() => readRetrievalVariant(), /Unsupported.*RETRIEVAL_VARIANT/); r3();
    const r4 = withEnv(ENV_VALIDATOR_VARIANT, "bogus_validator"); assert.throws(() => readValidatorVariant(), /Unsupported.*VALIDATOR_VARIANT/); r4();
    const r5 = withEnv(ENV_GRAPH_VERSION, "v99"); assert.throws(() => readGraphVersion(), /Unsupported.*GRAPH_VERSION/); r5();
  });

  it("buildExperimentVariantMetadata handles defaults, compact mode, explicit descriptor", () => {
    const r1 = withClearedEnv();
    let meta = buildExperimentVariantMetadata();
    assert.equal(meta.rerankVariant, DEFAULT_RERANK_VARIANT, "default meta");
    assert.equal(meta.graphVersion, DEFAULT_GRAPH_VERSION, "default graph meta");
    r1();

    // Compact mode omits defaults
    const r2 = withClearedEnv();
    assert.equal(Object.keys(buildExperimentVariantMetadata(undefined, true)).length, 0, "compact empty");
    r2();

    // Compact mode includes non-default
    const r3 = withEnv(ENV_RERANK_VARIANT, "deterministic_only");
    meta = buildExperimentVariantMetadata(undefined, true);
    assert.equal(meta.rerankVariant, "deterministic_only", "compact non-default"); assert.equal(meta.graphVersion, undefined, "default omitted");
    r3();

    // Explicit descriptor
    meta = buildExperimentVariantMetadata({ graphVersion: "turnGraph.v1", rerankVariant: "hybrid_score", contextPlannerVariant: "structured_query", retrievalVariant: "hyde_enabled", validatorVariant: "strict_attribution" }, false);
    assert.equal(meta.rerankVariant, "hybrid_score", "explicit");
  });

  it("buildExperimentVariantTags handles compact and non-compact modes", () => {
    const r1 = withClearedEnv();
    assert.deepEqual(buildExperimentVariantTags(), [], "compact defaults empty");
    r1();
    const r2 = withEnv(ENV_RERANK_VARIANT, "deterministic_only");
    const tags = buildExperimentVariantTags();
    assert.ok(tags.includes("variant:rerank:deterministic_only"), "compact non-default");
    assert.ok(!tags.some((t: string) => t.startsWith("variant:retrieval:")), "default omitted");
    r2();
    const r3 = withClearedEnv();
    const allTags = buildExperimentVariantTags(undefined, false);
    assert.ok(allTags.includes(`variant:rerank:${DEFAULT_RERANK_VARIANT}`), "non-compact rerank");
    assert.ok(allTags.includes(`variant:graph:${DEFAULT_GRAPH_VERSION}`), "non-compact graph");
    r3();
  });

  describe("validateExperimentVariants", () => {
    it("passes defaults, throws for missing guardrails and unimplemented variants", () => {
      assert.doesNotThrow(() => validateExperimentVariants(), "default no-op");
      assert.doesNotThrow(() => validateExperimentVariants({ graphVersion: "turnGraph.v1", rerankVariant: "llm_rerank_v1", contextPlannerVariant: "current", retrievalVariant: "tier3_current", validatorVariant: "current" }), "explicit defaults");

      const r1 = clearGuardrailEnv();
      assert.throws(() => validateExperimentVariants({ graphVersion: "turnGraph.v1", rerankVariant: "llm_rerank_v1", contextPlannerVariant: "current", retrievalVariant: "hyde_enabled", validatorVariant: "current" }), /CANON_QUERY_HYDE/, "hyde without env");
      r1();
      const r2 = setGuardrailEnv("CANON_QUERY_HYDE", "1");
      assert.doesNotThrow(() => validateExperimentVariants({ graphVersion: "turnGraph.v1", rerankVariant: "llm_rerank_v1", contextPlannerVariant: "current", retrievalVariant: "hyde_enabled", validatorVariant: "current" }), "hyde with env");
      r2();

      const r3 = clearGuardrailEnv();
      assert.throws(() => validateExperimentVariants({ graphVersion: "turnGraph.v1", rerankVariant: "llm_rerank_v1", contextPlannerVariant: "current", retrievalVariant: "motif_probe_enabled", validatorVariant: "current" }), /STRUCTMEM_MOTIF_PROBE_ENABLED/, "motif without env");
      r3();
      const r4 = setGuardrailEnv("STRUCTMEM_MOTIF_PROBE_ENABLED", "1");
      assert.doesNotThrow(() => validateExperimentVariants({ graphVersion: "turnGraph.v1", rerankVariant: "llm_rerank_v1", contextPlannerVariant: "current", retrievalVariant: "motif_probe_enabled", validatorVariant: "current" }), "motif with env");
      r4();

      const r5 = clearGuardrailEnv();
      assert.throws(() => validateExperimentVariants({ graphVersion: "turnGraph.v1", rerankVariant: "llm_rerank_v1", contextPlannerVariant: "current", retrievalVariant: "tier3_current", validatorVariant: "strict_attribution" }), /VALIDATOR_STRICT_ATTRIBUTION/, "strict without env");
      r5();
      const r6 = setGuardrailEnv("VALIDATOR_STRICT_ATTRIBUTION", "1");
      assert.doesNotThrow(() => validateExperimentVariants({ graphVersion: "turnGraph.v1", rerankVariant: "llm_rerank_v1", contextPlannerVariant: "current", retrievalVariant: "tier3_current", validatorVariant: "strict_attribution" }), "strict with env");
      r6();

      assert.throws(() => validateExperimentVariants({ graphVersion: "turnGraph.v1", rerankVariant: "llm_rerank_v1", contextPlannerVariant: "current", retrievalVariant: "tier3_current", validatorVariant: "lightweight" }), /not yet implemented/, "lightweight");
      assert.throws(() => validateExperimentVariants({ graphVersion: "turnGraph.v1", rerankVariant: "llm_rerank_v1", contextPlannerVariant: "no_rewrite", retrievalVariant: "tier3_current", validatorVariant: "current" }), /not yet implemented/, "no_rewrite");
    });
  });

  describe("readAndValidateExperimentVariants", () => {
    it("returns descriptor on success, throws VariantGuardrailError on failure", () => {
      const r1 = clearGuardrailEnv();
      const d = readAndValidateExperimentVariants();
      assert.equal(d.rerankVariant, "llm_rerank_v1", "default descriptor");
      r1();
      const r2 = clearGuardrailEnv();
      const prev = process.env.RETRIEVAL_VARIANT;
      process.env.RETRIEVAL_VARIANT = "hyde_enabled";
      assert.throws(() => readAndValidateExperimentVariants(), /CANON_QUERY_HYDE/, "guardrail error");
      if (prev !== undefined) process.env.RETRIEVAL_VARIANT = prev; else delete process.env.RETRIEVAL_VARIANT;
      r2();
    });
  });

  describe("getVariantRunMatrix", () => {
    it("returns entries for all categories with required fields", () => {
      const matrix = getVariantRunMatrix();
      assert.ok(matrix.graphVersion, "graph"); assert.ok(matrix.rerankVariant, "rerank");
      assert.ok(matrix.retrievalVariant, "retrieval"); assert.ok(matrix.contextPlannerVariant, "planner"); assert.ok(matrix.validatorVariant, "validator");
      assert.ok(matrix.emotionalAxisVariant, "emotionalAxisVariant in matrix");
      for (const [, options] of Object.entries(matrix)) {
        for (const opt of options) {
          assert.ok(typeof opt.envVar === "string", "envVar"); assert.ok(typeof opt.value === "string", "value");
          assert.ok(typeof opt.description === "string", "desc"); assert.ok(typeof opt.isDefault === "boolean", "default");
          assert.ok(Array.isArray(opt.requiredEnvVars), "required"); assert.ok(typeof opt.implemented === "boolean", "impl");
        }
      }
    });
  });

  // ---------------------------------------------------------------------------
  // TG5 — Emotional-axis variant config
  // ---------------------------------------------------------------------------

  describe("TG5 — emotional-axis variant config", () => {
    it("readEmotionalAxisVariant returns default when no env/override", () => {
      const r = withClearedEnv();
      const variant = readEmotionalAxisVariant();
      assert.equal(variant, "full_axis_coupling_render", "default variant");
      r();
    });

    it("readEmotionalAxisVariant accepts valid variant names", () => {
      for (const v of ["baseline_no_emotional_axis", "axis_state_no_render", "full_axis_coupling_render", "engine_no_coupling_full_render", "axis_bands_only"] as const) {
        assert.equal(readEmotionalAxisVariant(v), v, `valid variant: ${v}`);
      }
    });

    it("readEmotionalAxisVariant throws on invalid variant", () => {
      assert.throws(() => readEmotionalAxisVariant("bogus_variant"), /Unsupported.*EMOTIONAL_AXIS_VARIANT/, "throws on bogus");
    });

    it("resolveEmotionalAxisVariantConfig maps all five variants correctly", () => {
      const configs = {
        baseline_no_emotional_axis: { engineEnabled: false, renderEnabled: false, noCoupling: false, bandsOnly: false },
        axis_state_no_render: { engineEnabled: true, renderEnabled: false, noCoupling: false, bandsOnly: false },
        full_axis_coupling_render: { engineEnabled: true, renderEnabled: true, noCoupling: false, bandsOnly: false },
        engine_no_coupling_full_render: { engineEnabled: true, renderEnabled: true, noCoupling: true, bandsOnly: false },
        axis_bands_only: { engineEnabled: true, renderEnabled: true, noCoupling: false, bandsOnly: true },
      };
      for (const [variant, expected] of Object.entries(configs)) {
        const actual = resolveEmotionalAxisVariantConfig(variant as any);
        assert.equal(actual.engineEnabled, expected.engineEnabled, `${variant} engineEnabled`);
        assert.equal(actual.renderEnabled, expected.renderEnabled, `${variant} renderEnabled`);
        assert.equal(actual.noCoupling, expected.noCoupling, `${variant} noCoupling`);
        assert.equal(actual.bandsOnly, expected.bandsOnly, `${variant} bandsOnly`);
      }
    });

    // -------------------------------------------------------------------
    // TG6 — Emotional-axis variant metadata/tags wiring
    // -------------------------------------------------------------------

    it("TG6: buildEmotionalAxisVariantMetadata returns metadata for non-default variant", () => {
      const meta = buildEmotionalAxisVariantMetadata("axis_state_no_render");
      assert.ok(meta, "metadata present for non-default variant");
      assert.equal(meta!.emotionalAxisVariant, "axis_state_no_render");
    });

    it("TG6: buildEmotionalAxisVariantMetadata returns undefined for default variant", () => {
      const meta = buildEmotionalAxisVariantMetadata(DEFAULT_EMOTIONAL_AXIS_VARIANT);
      assert.equal(meta, undefined, "no metadata for default variant");
    });

    it("TG6: buildEmotionalAxisVariantTags returns tag for non-default variant", () => {
      const tags = buildEmotionalAxisVariantTags("axis_state_no_render");
      assert.ok(tags.includes("variant:emotional_axis:axis_state_no_render"), "tag for non-default");
    });

    it("TG6: buildEmotionalAxisVariantTags returns empty for default variant", () => {
      const tags = buildEmotionalAxisVariantTags(DEFAULT_EMOTIONAL_AXIS_VARIANT);
      assert.equal(tags.length, 0, "no tags for default variant");
    });

    it("N1: no-arg builders read EMOTIONAL_AXIS_VARIANT (real runAgentEval path)", () => {
      const saved = process.env.EMOTIONAL_AXIS_VARIANT;
      try {
        process.env.EMOTIONAL_AXIS_VARIANT = "axis_state_no_render";
        assert.deepEqual(
          buildEmotionalAxisVariantTags(),
          ["variant:emotional_axis:axis_state_no_render"],
          "no-arg tags read env",
        );
        assert.equal(
          buildEmotionalAxisVariantMetadata()?.emotionalAxisVariant,
          "axis_state_no_render",
          "no-arg metadata reads env",
        );
      } finally {
        if (saved === undefined) delete process.env.EMOTIONAL_AXIS_VARIANT;
        else process.env.EMOTIONAL_AXIS_VARIANT = saved;
      }
    });

    it("getVariantRunMatrix includes emotionalAxisVariant with all 5 entries", () => {
      const matrix = getVariantRunMatrix();
      assert.ok(matrix.emotionalAxisVariant, "emotionalAxisVariant category");
      assert.equal(matrix.emotionalAxisVariant.length, 5, "5 emotional-axis variants");
      const ids = matrix.emotionalAxisVariant.map((o) => o.value);
      assert.ok(ids.includes("baseline_no_emotional_axis"), "baseline");
      assert.ok(ids.includes("axis_state_no_render"), "no render");
      assert.ok(ids.includes("full_axis_coupling_render"), "full");
      assert.ok(ids.includes("engine_no_coupling_full_render"), "no coupling");
      assert.ok(ids.includes("axis_bands_only"), "bands only");
    });

    // -------------------------------------------------------------------
    // D3 — Emotional-axis env gate guardrails
    // -------------------------------------------------------------------

    describe("validateEmotionalAxisVariantGuard — env gate guardrails (D3)", () => {
      const emotionalKeys = ["EMOTIONAL_ENGINE_ENABLED", "EMOTIONAL_RENDER_ENABLED"];

      function clearEmotionalEnv(): () => void {
        const prev: Record<string, string | undefined> = {};
        for (const k of emotionalKeys) { prev[k] = process.env[k]; delete process.env[k]; }
        return () => { for (const k of emotionalKeys) { if (prev[k] === undefined) delete process.env[k]; else process.env[k] = prev[k]; } };
      }

      function setEmotionalEnv(key: string, value: string): () => void {
        const prev = process.env[key];
        process.env[key] = value;
        return () => { if (prev === undefined) delete process.env[key]; else process.env[key] = prev; };
      }

      it("passes for baseline_no_emotional_axis when all gates disabled", () => {
        const r = clearEmotionalEnv();
        assert.doesNotThrow(
          () => validateEmotionalAxisVariantGuard("baseline_no_emotional_axis"),
          "baseline passes with no gates",
        );
        r();
      });

      it("throws for axis_state_no_render when EMOTIONAL_ENGINE_ENABLED is off", () => {
        const r = clearEmotionalEnv();
        assert.throws(
          () => validateEmotionalAxisVariantGuard("axis_state_no_render"),
          /EMOTIONAL_ENGINE_ENABLED/,
          "engine gate required for axis_state_no_render",
        );
        r();
      });

      it("passes for axis_state_no_render when engine gate is on and render gate off", () => {
        const r1 = setEmotionalEnv("EMOTIONAL_ENGINE_ENABLED", "1");
        const r2 = clearEmotionalEnv(); // clears render
        // Re-set engine after clear
        process.env.EMOTIONAL_ENGINE_ENABLED = "1";
        assert.doesNotThrow(
          () => validateEmotionalAxisVariantGuard("axis_state_no_render"),
          "axis_state_no_render passes with engine gate only",
        );
        r2();
        r1();
      });

      it("throws for full_axis_coupling_render when EMOTIONAL_RENDER_ENABLED is off", () => {
        const r1 = setEmotionalEnv("EMOTIONAL_ENGINE_ENABLED", "1");
        assert.throws(
          () => validateEmotionalAxisVariantGuard("full_axis_coupling_render"),
          /EMOTIONAL_RENDER_ENABLED/,
          "render gate required for full variant",
        );
        r1();
      });

      it("passes for full_axis_coupling_render when both gates are on", () => {
        const r1 = setEmotionalEnv("EMOTIONAL_ENGINE_ENABLED", "1");
        const r2 = setEmotionalEnv("EMOTIONAL_RENDER_ENABLED", "1");
        assert.doesNotThrow(
          () => validateEmotionalAxisVariantGuard("full_axis_coupling_render"),
          "full variant passes with both gates",
        );
        r2();
        r1();
      });

      it("throws for engine_no_coupling_full_render when render gate is off", () => {
        const r1 = setEmotionalEnv("EMOTIONAL_ENGINE_ENABLED", "1");
        assert.throws(
          () => validateEmotionalAxisVariantGuard("engine_no_coupling_full_render"),
          /EMOTIONAL_RENDER_ENABLED/,
          "render gate required for no-coupling variant",
        );
        r1();
      });

      it("throws for axis_bands_only when render gate is off", () => {
        const r1 = setEmotionalEnv("EMOTIONAL_ENGINE_ENABLED", "1");
        assert.throws(
          () => validateEmotionalAxisVariantGuard("axis_bands_only"),
          /EMOTIONAL_RENDER_ENABLED/,
          "render gate required for bands-only variant",
        );
        r1();
      });

      it("error message includes the variant name and missing env var", () => {
        const r = clearEmotionalEnv();
        try {
          validateEmotionalAxisVariantGuard("full_axis_coupling_render");
          assert.fail("expected guard to throw");
        } catch (err) {
          const msg = (err as Error).message;
          assert.ok(msg.includes("full_axis_coupling_render"), "error includes variant name");
          assert.ok(msg.includes("EMOTIONAL_ENGINE_ENABLED"), "error includes missing env var");
        } finally {
          r();
        }
      });
    });

  });
});

function withEnv(key: string, value: string): () => void {
  const p = process.env[key]; process.env[key] = value; return () => { if (p === undefined) delete process.env[key]; else process.env[key] = p; };
}
function setGuardrailEnv(key: string, value: string): () => void { return withEnv(key, value); }
function clearGuardrailEnv(): () => void {
  const keys = ["CANON_QUERY_HYDE", "STRUCTMEM_MOTIF_PROBE_ENABLED", "VALIDATOR_STRICT_ATTRIBUTION"];
  const prev: Record<string, string | undefined> = {};
  for (const k of keys) { prev[k] = process.env[k]; delete process.env[k]; }
  return () => { for (const k of keys) { if (prev[k] === undefined) delete process.env[k]; else process.env[k] = prev[k]; } };
}
function withClearedEnv(): () => void {
  const keys = [ENV_RERANK_VARIANT, ENV_CONTEXT_PLANNER_VARIANT, ENV_RETRIEVAL_VARIANT, ENV_VALIDATOR_VARIANT, ENV_GRAPH_VERSION] as const;
  const prev = {} as Record<string, string | undefined>;
  for (const k of keys) { prev[k] = process.env[k]; delete process.env[k]; }
  return () => { for (const k of keys) { if (prev[k] === undefined) delete process.env[k]; else process.env[k] = prev[k]; } };
}
