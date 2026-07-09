import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildSeedAxisState } from "./loadOocReplayScenario";
import {
  parsePersistedAxisState,
  mergeAxisStateIntoDelta,
} from "../../state/emotionalEngine/axisStatePersistence";

describe("TG0.7b-fix — buildSeedAxisState round-trip", () => {
  // The ACTUAL reduced shape from the transcript (turn 259's emotional_axis):
  // { version, tick, scope, axes, bands } — NO history/lastTrace/couplingsFired.
  const transcriptAxis: Record<string, unknown> = {
    version: 1,
    source: "post_turn_engine",
    tick: 259,
    scope: "main_married",
    axes: {
      connection: 0.42,
      valence: 0.08,
      arousal: 0.35,
      restraint: 0.28,
    },
    bands: {
      connection: "mid",
      valence: "mid",
      arousal: "mid",
      restraint: "low",
    },
  };

  it("builds a valid PersistedAxisState from the reduced transcript shape", () => {
    const seed = buildSeedAxisState(transcriptAxis);
    assert.ok(seed !== undefined, "seed should be defined");
    assert.equal(seed.version, 1);
    assert.equal(seed.tick, 259);
    assert.deepEqual(seed.axes, transcriptAxis.axes);
    assert.deepEqual(seed.history, [], "empty history");
    assert.ok(Array.isArray(seed.lastTrace.couplingsFired), "couplingsFired is array");
    assert.equal(seed.lastTrace.tick, 259);
    assert.deepEqual(seed.lastTrace.axesBefore, transcriptAxis.axes);
    assert.deepEqual(seed.lastTrace.axesAfter, transcriptAxis.axes);
  });

  it("round-trips through parsePersistedAxisState without null", () => {
    const seed = buildSeedAxisState(transcriptAxis);
    assert.ok(seed !== undefined);
    const parsed = parsePersistedAxisState(seed as any);
    assert.ok(parsed !== null, "parsePersistedAxisState must return non-null");
  });

  it("round-trips through mergeAxisStateIntoDelta without throwing", () => {
    const seed = buildSeedAxisState(transcriptAxis);
    assert.ok(seed !== undefined);
    assert.doesNotThrow(() => {
      mergeAxisStateIntoDelta({}, seed!);
    }, "mergeAxisStateIntoDelta must not throw");
  });

  it("returns undefined for missing / invalid input", () => {
    assert.equal(buildSeedAxisState(undefined), undefined);
    assert.equal(buildSeedAxisState({}), undefined);
    assert.equal(buildSeedAxisState({ version: "wrong" }), undefined);
    assert.equal(buildSeedAxisState({ version: 1 }), undefined); // no tick
    assert.equal(
      buildSeedAxisState({ version: 1, tick: 1, axes: { foo: 1 } }),
      undefined,
    );
  });
});
