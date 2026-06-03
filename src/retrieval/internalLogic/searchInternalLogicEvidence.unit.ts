import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isScopeCompatible, computeFinalScore, computeFetchCap } from "./searchInternalLogicEvidence";

describe("isScopeCompatible", () => {
  it("handles empty scope, continuityScopes, minContinuityScope, arcKeys, and combined", () => {
    // Empty scopeApplicability — always passes
    assert.equal(isScopeCompatible({}, "main_relationship", undefined), true, "empty obj — pass");
    assert.equal(isScopeCompatible(null, "main_relationship", undefined), true, "null — pass");
    assert.equal(isScopeCompatible(undefined, "main_relationship", undefined), true, "undefined — pass");

    // continuityScopes includes current scope
    const sa = { continuityScopes: ["main_relationship", "main_married"] };
    assert.equal(isScopeCompatible(sa, "main_relationship", undefined), true, "contScopes — relationship");
    assert.equal(isScopeCompatible(sa, "main_married", undefined), true, "contScopes — married");

    // continuityScopes does not include current scope
    assert.equal(isScopeCompatible(sa, "main_pre_relationship", undefined), false, "contScopes — not included");

    // continuityScopes empty array
    assert.equal(isScopeCompatible({ continuityScopes: [] }, "main_relationship", undefined), true, "contScopes empty — pass");

    // Fails closed when continuityScope is missing/unrecognized
    assert.equal(isScopeCompatible({ continuityScopes: ["main_married"] }, null, undefined), false, "contScopes — null scope");
    assert.equal(isScopeCompatible({ continuityScopes: ["main_married"] }, undefined, undefined), false, "contScopes — undefined scope");
    assert.equal(isScopeCompatible({ continuityScopes: ["main_married"] }, "unknown_scope", undefined), false, "contScopes — unknown scope");

    // minContinuityScope: pass when scope meets minimum
    const minSa = { minContinuityScope: "main_relationship" };
    assert.equal(isScopeCompatible(minSa, "main_relationship", undefined), true, "minScope — at minimum");
    assert.equal(isScopeCompatible(minSa, "main_engaged", undefined), true, "minScope — above");
    assert.equal(isScopeCompatible(minSa, "main_married", undefined), true, "minScope — above 2");

    // minContinuityScope: fail when scope below
    assert.equal(isScopeCompatible({ minContinuityScope: "main_married" }, "main_pre_relationship", undefined), false, "minScope — below");
    assert.equal(isScopeCompatible({ minContinuityScope: "main_married" }, "main_relationship", undefined), false, "minScope — below 2");

    // Fails closed when minContinuityScope set but scope missing
    assert.equal(isScopeCompatible({ minContinuityScope: "main_married" }, null, undefined), false, "minScope — null");
    assert.equal(isScopeCompatible({ minContinuityScope: "main_married" }, undefined, undefined), false, "minScope — undefined");
    assert.equal(isScopeCompatible({ minContinuityScope: "main_married" }, "unknown_scope", undefined), false, "minScope — unknown");

    // Unrecognized minContinuityScope → fail-open
    assert.equal(isScopeCompatible({ minContinuityScope: "unknown_scope" }, "main_relationship", undefined), true, "minScope unknown — pass");
    assert.equal(isScopeCompatible({ minContinuityScope: "unknown_scope" }, null, undefined), true, "minScope unknown — null pass");

    // arcKeys overlap
    const arcSa = { arcKeys: ["main_zhiai", "main_weiming"] };
    assert.equal(isScopeCompatible(arcSa, "main_married", ["main_zhiai"]), true, "arcKeys — zhiai");
    assert.equal(isScopeCompatible(arcSa, "main_married", ["main_weiming"]), true, "arcKeys — weiming");
    assert.equal(isScopeCompatible(arcSa, "main_married", ["main_zhiai", "main_tianmi"]), true, "arcKeys — mixed");

    // arcKeys no overlap
    assert.equal(isScopeCompatible({ arcKeys: ["main_zhiai"] }, "main_married", ["main_tianmi"]), false, "arcKeys — no overlap");
    assert.equal(isScopeCompatible({ arcKeys: ["main_zhiai"] }, "main_married", ["main_weiming"]), false, "arcKeys — no overlap 2");

    // No arcKeys provided → fail-open
    assert.equal(isScopeCompatible(arcSa, "main_married", undefined), true, "arcKeys — undefined passthrough");
    assert.equal(isScopeCompatible(arcSa, "main_married", []), true, "arcKeys — empty passthrough");

    // No arcKeys on hit → pass
    assert.equal(isScopeCompatible({ continuityScopes: ["main_married"] }, "main_married", ["main_zhiai"]), true, "no hit arcKeys — pass");

    // Combined continuityScopes + minContinuityScope
    const combinedSa = { continuityScopes: ["main_relationship", "main_married"], minContinuityScope: "main_relationship" };
    assert.equal(isScopeCompatible(combinedSa, "main_married", undefined), true, "combined — married");
    assert.equal(isScopeCompatible(combinedSa, "main_relationship", undefined), true, "combined — relationship");
    assert.equal(isScopeCompatible(combinedSa, "main_pre_relationship", undefined), false, "combined — below scope");

    // Combined with missing scope
    assert.equal(isScopeCompatible(combinedSa, null, undefined), false, "combined — null scope");
  });
});

describe("computeFetchCap", () => {
  it("returns expected cap with floor at 16 and ceiling at 40", () => {
    const cases = [
      { name: "default limit 4", limit: 4, expected: 20 },
      { name: "limit 1 (floor)", limit: 1, expected: 16 },
      { name: "limit 8 (ceiling)", limit: 8, expected: 40 },
      { name: "limit 10 (clamped)", limit: 10, expected: 40 },
      { name: "limit 100 (clamped)", limit: 100, expected: 40 },
    ];
    for (const c of cases) {
      assert.equal(computeFetchCap(c.limit), c.expected, c.name);
    }
  });
});

describe("computeFinalScore", () => {
  it("returns cosineSimilarity when confidence is null/0, applies boost otherwise, and handles edge cases", () => {
    assert.equal(computeFinalScore(0.5, null), 0.5, "null confidence");
    assert.equal(computeFinalScore(0.5, 0), 0.5, "zero confidence");
    assert.equal(computeFinalScore(0.5, 0.9), 0.5 + 0.9 * 0.05, "boost applied");
    const highSim = computeFinalScore(0.8, 0.0);
    const lowSimWithBoost = computeFinalScore(0.5, 1.0);
    assert.ok(highSim > lowSimWithBoost, "similarity dominates over max boost");
    assert.equal(computeFinalScore(0, 0), 0, "zero all");
  });
});
