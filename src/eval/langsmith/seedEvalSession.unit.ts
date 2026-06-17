import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { clampSeedAxisTick } from "./seedEvalSession";

describe("seedEvalSession — clampSeedAxisTick (review-026)", () => {
  it("clamps a tick-1 seed to 0 for a single-turn eval session (no seeded history)", () => {
    // maxSeededTurnIndex 0 → eval turn runs at tick 1 → seed must be < 1.
    // Without clamping, persisted.tick (1) >= turn tick (1) skips the engine and
    // drops the update snapshot (the review-022..025 bug).
    assert.equal(clampSeedAxisTick(1, 0), 0);
  });

  it("clamps a trajectory carry-over seed (tick N) down to the seeded turn", () => {
    assert.equal(clampSeedAxisTick(3, 0), 0);
    assert.equal(clampSeedAxisTick(5, 1), 1);
  });

  it("leaves a seed tick that is already <= maxSeededTurnIndex unchanged", () => {
    assert.equal(clampSeedAxisTick(0, 0), 0);
    assert.equal(clampSeedAxisTick(2, 4), 2);
  });

  it("treats an undefined seed tick as 0", () => {
    assert.equal(clampSeedAxisTick(undefined, 3), 0);
  });
});
