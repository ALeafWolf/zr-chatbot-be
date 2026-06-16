import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { resolveAxesConfigForScope } from "./resolveAxesConfigForScope";
import type { AxesConfig, ScopeBaselineOverrides } from "./types";

const BASE: AxesConfig = {
  connection: { baseline: 0, driftRate: 0.02, min: -1, max: 1 },
  valence: { baseline: 0, driftRate: 0.02, min: -1, max: 1 },
  arousal: { baseline: 0, driftRate: 0.02, min: -1, max: 1 },
  restraint: { baseline: 0.7, driftRate: 0.02, min: -1, max: 1 },
};

const BY_SCOPE: ScopeBaselineOverrides = {
  main_relationship: { connection: 0.15, valence: 0.05, restraint: 0.7 },
  main_married: { connection: 0.35, valence: 0.15, arousal: 0.0, restraint: 0.55 },
};

describe("resolveAxesConfigForScope — D8", () => {
  it("returns base unchanged when byScope is undefined", () => {
    const result = resolveAxesConfigForScope(BASE, undefined, "main_relationship");
    assert.equal(result.connection.baseline, 0);
    assert.equal(result.restraint.baseline, 0.7);
    assert.equal(result.connection.driftRate, 0.02);
  });

  it("returns base unchanged when scope has no overrides", () => {
    const result = resolveAxesConfigForScope(BASE, BY_SCOPE, "unknown_scope");
    assert.equal(result.connection.baseline, 0);
    assert.equal(result.restraint.baseline, 0.7);
  });

  it("overrides baseline for known scope, preserves driftRate/min/max", () => {
    const result = resolveAxesConfigForScope(BASE, BY_SCOPE, "main_relationship");
    assert.equal(result.connection.baseline, 0.15, "connection baseline overridden");
    assert.equal(result.valence.baseline, 0.05, "valence baseline overridden");
    assert.equal(result.arousal.baseline, 0, "arousal baseline unchanged (not in overrides)");
    assert.equal(result.restraint.baseline, 0.7, "restraint baseline overridden to 0.7");
    assert.equal(result.connection.driftRate, 0.02, "driftRate preserved");
    assert.equal(result.connection.min, -1, "min preserved");
    assert.equal(result.connection.max, 1, "max preserved");
  });

  it("overrides baseline for main_married scope", () => {
    const result = resolveAxesConfigForScope(BASE, BY_SCOPE, "main_married");
    assert.equal(result.connection.baseline, 0.35);
    assert.equal(result.valence.baseline, 0.15);
    assert.equal(result.arousal.baseline, 0);
    assert.equal(result.restraint.baseline, 0.55);
  });

  it("AU scope falls back to default baseline", () => {
    const result = resolveAxesConfigForScope(BASE, BY_SCOPE, "au_custom");
    assert.equal(result.connection.baseline, 0);
    assert.equal(result.restraint.baseline, 0.7);
  });
});
