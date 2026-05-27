import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  isScopeCompatible,
  computeFinalScore,
  computeFetchCap,
} from "./searchInternalLogicEvidence";

// ---------------------------------------------------------------------------
// isScopeCompatible
// ---------------------------------------------------------------------------
describe("isScopeCompatible", () => {
  it("passes when scopeApplicability is empty", () => {
    assert.equal(isScopeCompatible({}, "main_relationship", undefined), true);
    assert.equal(isScopeCompatible(null, "main_relationship", undefined), true);
    assert.equal(isScopeCompatible(undefined, "main_relationship", undefined), true);
  });

  it("passes when continuityScopes includes the current scope", () => {
    const sa = { continuityScopes: ["main_relationship", "main_married"] };
    assert.equal(isScopeCompatible(sa, "main_relationship", undefined), true);
    assert.equal(isScopeCompatible(sa, "main_married", undefined), true);
  });

  it("fails when continuityScopes does not include the current scope", () => {
    const sa = { continuityScopes: ["main_married"] };
    assert.equal(isScopeCompatible(sa, "main_relationship", undefined), false);
    assert.equal(isScopeCompatible(sa, "main_pre_relationship", undefined), false);
  });

  it("passes when continuityScopes is empty array", () => {
    const sa = { continuityScopes: [] };
    assert.equal(isScopeCompatible(sa, "main_relationship", undefined), true);
  });

  it("fails closed when continuityScopes is set but continuityScope is missing", () => {
    const sa = { continuityScopes: ["main_married"] };
    assert.equal(isScopeCompatible(sa, null, undefined), false);
    assert.equal(isScopeCompatible(sa, undefined, undefined), false);
  });

  it("fails closed when continuityScopes is set but continuityScope is unrecognized", () => {
    const sa = { continuityScopes: ["main_married"] };
    assert.equal(isScopeCompatible(sa, "unknown_scope", undefined), false);
  });

  it("passes when current scope meets minContinuityScope", () => {
    const sa = { minContinuityScope: "main_relationship" };
    assert.equal(isScopeCompatible(sa, "main_relationship", undefined), true);
    assert.equal(isScopeCompatible(sa, "main_engaged", undefined), true);
    assert.equal(isScopeCompatible(sa, "main_married", undefined), true);
  });

  it("fails when current scope is below minContinuityScope", () => {
    const sa = { minContinuityScope: "main_married" };
    assert.equal(isScopeCompatible(sa, "main_pre_relationship", undefined), false);
    assert.equal(isScopeCompatible(sa, "main_relationship", undefined), false);
  });

  it("fails closed when recognized minContinuityScope is set but continuityScope is missing", () => {
    const sa = { minContinuityScope: "main_married" };
    assert.equal(isScopeCompatible(sa, null, undefined), false);
    assert.equal(isScopeCompatible(sa, undefined, undefined), false);
  });

  it("fails closed when recognized minContinuityScope is set but continuityScope is unrecognized", () => {
    const sa = { minContinuityScope: "main_married" };
    assert.equal(isScopeCompatible(sa, "unknown_scope", undefined), false);
  });

  it("passes when minContinuityScope is not a recognized scope (fail-open)", () => {
    const sa = { minContinuityScope: "unknown_scope" };
    assert.equal(isScopeCompatible(sa, "main_relationship", undefined), true);
    assert.equal(isScopeCompatible(sa, null, undefined), true); // also pass when missing
  });

  it("passes when arcKeys overlap", () => {
    const sa = { arcKeys: ["main_zhiai", "main_weiming"] };
    assert.equal(isScopeCompatible(sa, "main_married", ["main_zhiai"]), true);
    assert.equal(isScopeCompatible(sa, "main_married", ["main_weiming"]), true);
    assert.equal(isScopeCompatible(sa, "main_married", ["main_zhiai", "main_tianmi"]), true);
  });

  it("fails when arcKeys do not overlap", () => {
    const sa = { arcKeys: ["main_zhiai"] };
    assert.equal(isScopeCompatible(sa, "main_married", ["main_tianmi"]), false);
    assert.equal(isScopeCompatible(sa, "main_married", ["main_weiming"]), false);
  });

  it("passes when no arcKeys are provided for filtering (fail-open)", () => {
    const sa = { arcKeys: ["main_zhiai"] };
    assert.equal(isScopeCompatible(sa, "main_married", undefined), true);
    assert.equal(isScopeCompatible(sa, "main_married", []), true);
  });

  it("passes when no arcKeys on the hit", () => {
    const sa = { continuityScopes: ["main_married"] };
    assert.equal(isScopeCompatible(sa, "main_married", ["main_zhiai"]), true);
  });

  it("passes with combined continuityScopes and minContinuityScope", () => {
    // Row requires minContinuityScope >= main_relationship AND scope in continuityScopes
    const sa = {
      continuityScopes: ["main_relationship", "main_married"],
      minContinuityScope: "main_relationship",
    };
    assert.equal(isScopeCompatible(sa, "main_married", undefined), true);
    assert.equal(isScopeCompatible(sa, "main_relationship", undefined), true);
    assert.equal(isScopeCompatible(sa, "main_pre_relationship", undefined), false);
  });

  it("fails closed with combined restrictions and missing scope", () => {
    const sa = {
      continuityScopes: ["main_married"],
      minContinuityScope: "main_relationship",
    };
    assert.equal(isScopeCompatible(sa, null, undefined), false);
  });
});

// ---------------------------------------------------------------------------
// computeFinalScore
// ---------------------------------------------------------------------------
describe("computeFetchCap", () => {
  it("returns expected cap for default limit (4)", () => {
    // limit=4: max(4*5=20, 16) = 20, min(40, 20) = 20
    assert.equal(computeFetchCap(4), 20);
  });

  it("returns expected cap for limit=1", () => {
    // limit=1: max(1*5=5, 16) = 16, min(40, 16) = 16
    assert.equal(computeFetchCap(1), 16);
  });

  it("returns expected cap for limit=8", () => {
    // limit=8: max(8*5=40, 16) = 40, min(40, 40) = 40
    assert.equal(computeFetchCap(8), 40);
  });

  it("never exceeds 40", () => {
    assert.equal(computeFetchCap(10), 40);
    assert.equal(computeFetchCap(100), 40);
  });
});

describe("computeFinalScore", () => {
  it("returns cosineSimilarity when confidenceScore is null", () => {
    assert.equal(computeFinalScore(0.5, null), 0.5);
  });

  it("returns cosineSimilarity when confidenceScore is 0", () => {
    assert.equal(computeFinalScore(0.5, 0), 0.5);
  });

  it("applies small boost from confidenceScore", () => {
    const score = computeFinalScore(0.5, 0.9);
    assert.equal(score, 0.5 + 0.9 * 0.05);
  });

  it("boost from high confidence does not dominate similarity", () => {
    const highSim = computeFinalScore(0.8, 0.0);
    const lowSimWithBoost = computeFinalScore(0.5, 1.0);
    // Even with max confidence boost, similarity should still dominate
    assert.ok(highSim > lowSimWithBoost, "similarity should dominate final score");
  });

  it("handles edge case of zero similarity and zero confidence", () => {
    assert.equal(computeFinalScore(0, 0), 0);
  });
});
