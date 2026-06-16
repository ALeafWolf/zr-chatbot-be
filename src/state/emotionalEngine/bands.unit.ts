import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { computeBand, computeBands } from "./bands";
import { BAND_HIGH_THRESHOLD, BAND_LOW_THRESHOLD, BAND_HYSTERESIS } from "./constants";
import type { Band, AxisName } from "./types";

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("computeBand — hysteresis", () => {

  // ---- Enter/exit high ----

  it("enters high when value exceeds threshold from mid", () => {
    assert.equal(computeBand(BAND_HIGH_THRESHOLD + 0.01, "mid"), "high");
  });

  it("stays high when value dips slightly below threshold but above exit", () => {
    assert.equal(computeBand(BAND_HIGH_THRESHOLD - 0.01, "high"), "high", "still above exit");
  });

  it("exits high when value drops below hysteresis exit threshold", () => {
    const exitHigh = BAND_HIGH_THRESHOLD - BAND_HYSTERESIS - 0.01;
    assert.equal(computeBand(exitHigh, "high"), "mid");
  });

  // ---- Enter/exit low ----

  it("enters low when value drops below threshold from mid", () => {
    assert.equal(computeBand(BAND_LOW_THRESHOLD - 0.01, "mid"), "low");
  });

  it("stays low when value rises slightly above threshold but below exit", () => {
    assert.equal(computeBand(BAND_LOW_THRESHOLD + 0.01, "low"), "low", "still below exit");
  });

  it("exits low when value rises above hysteresis exit threshold", () => {
    const exitLow = BAND_LOW_THRESHOLD + BAND_HYSTERESIS + 0.01;
    assert.equal(computeBand(exitLow, "low"), "mid");
  });

  // ---- Mid stability ----

  it("enters/exits mid for mid-range values", () => {
    assert.equal(computeBand(0.5, "mid"), "mid");
    assert.equal(computeBand(0.4, "mid"), "mid");
    assert.equal(computeBand(0.3, "mid"), "low", "0.3 < 0.35 — enters low from mid");
    assert.equal(computeBand(0, "mid"), "low", "0 < 0.35 — enters low from mid");
    assert.equal(computeBand(0.7, "mid"), "high", "0.7 > 0.65 — enters high from mid");
    // Hysteresis: stay low even slightly above threshold
    assert.equal(computeBand(0.37, "low"), "low", "0.37 stays low (below 0.45 exit)");
    // Hysteresis: stay high even slightly below threshold
    assert.equal(computeBand(0.63, "high"), "high", "0.63 stays high (above 0.55 exit)");
  });
});

describe("computeBands — all axes", () => {
  it("computes bands for all four axes with axis-aware hysteresis", () => {
    const values = { connection: 0.7, valence: 0.3, arousal: 0.1, restraint: 0.6 };
    const previous: Record<AxisName, Band> = { connection: "mid", valence: "low", arousal: "mid", restraint: "high" };

    const result = computeBands(values, previous);

    // connection: centered axis, 0.7 > +0.35 → high
    assert.equal(result.connection, "high", "0.7 — enters high from mid (centered axis)");
    // valence: centered axis, old 'low' threshold was <0.35, but with centered thresholds 0.3 is between -0.35 and +0.35 → mid
    assert.equal(result.valence, "mid", "0.3 — exits low (above -0.25), enters mid (centered axis)");
    // arousal: centered axis, 0.1 is between -0.35 and +0.35 → mid
    assert.equal(result.arousal, "mid", "0.1 — stays mid (centered axis)");
    // restraint: bounded axis, 0.6 stays high (above 0.55 exit)
    assert.equal(result.restraint, "high", "0.6 — stays high (hysteresis, above 0.55 exit)");
  });

  it("handles first tick with all mid defaults", () => {
    const values = { connection: 0.7, valence: 0.2, arousal: 0.5, restraint: -0.1 };
    const previous: Record<AxisName, Band> = { connection: "mid", valence: "mid", arousal: "mid", restraint: "mid" };
    const result = computeBands(values, previous);
    // connection: centered axis, 0.7 > +0.35 → high
    assert.equal(result.connection, "high");
    // valence: centered axis, 0.2 between -0.35 and +0.35 → mid
    assert.equal(result.valence, "mid");
    // arousal: centered axis, 0.5 > +0.35 → high
    assert.equal(result.arousal, "high");
    // restraint: bounded axis, -0.1 < 0.35 → low
    assert.equal(result.restraint, "low");
  });
});
