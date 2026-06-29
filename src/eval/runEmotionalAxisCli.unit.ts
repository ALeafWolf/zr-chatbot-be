import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { checkVariantCleanupGate, computeVariantAggregation } from "./runEmotionalAxisCli";

describe("runEmotionalAxisCli — TG6", () => {
  // -------------------------------------------------------------------
  // N2: Cleanup gate — tests exercise exported production code
  // -------------------------------------------------------------------

  it("N2: checkVariantCleanupGate returns success=false when cleanup not completed", () => {
    const result = checkVariantCleanupGate(3, 3, false);
    assert.equal(result.success, false, "fails when cleanup not completed");
    assert.equal(result.error, "cleanup not completed");
  });

  it("N2: checkVariantCleanupGate returns success=true when all passed and cleanup completed", () => {
    const result = checkVariantCleanupGate(3, 3, true);
    assert.equal(result.success, true, "passes when all assertions pass and cleanup done");
    assert.equal(result.error, undefined);
  });

  it("N2: checkVariantCleanupGate returns success=false when some assertions fail", () => {
    const result = checkVariantCleanupGate(2, 3, true);
    assert.equal(result.success, false, "fails when some assertions fail");
    assert.equal(result.error, "some assertions failed");
  });

  // -------------------------------------------------------------------
  // N2: Comparison aggregation — exercises exported production code
  // -------------------------------------------------------------------

  it("N2: computeVariantAggregation computes correct pass% and counts", () => {
    const results = [
      { passed: 3, failed: 0, success: true },
      { passed: 2, failed: 0, success: true },
      { passed: 1, failed: 1, success: false },
    ];
    const agg = computeVariantAggregation(results);
    assert.equal(agg.scenarioCount, 3, "3 scenarios");
    assert.equal(agg.passedScenarios, 2, "2 passed");
    assert.equal(agg.failedScenarios, 1, "1 failed");
    assert.equal(agg.totalAssertions, 7, "7 total assertions");
    assert.equal(agg.passedAssertions, 6, "6 passed assertions");
    assert.equal(agg.passPercent, "85.7", "85.7% pass rate");
  });

  it("N2: computeVariantAggregation handles empty results", () => {
    const agg = computeVariantAggregation([]);
    assert.equal(agg.scenarioCount, 0);
    assert.equal(agg.passedScenarios, 0);
    assert.equal(agg.totalAssertions, 0);
    assert.equal(agg.passPercent, "N/A");
  });
});
