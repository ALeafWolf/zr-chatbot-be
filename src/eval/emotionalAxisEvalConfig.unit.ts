import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  getEmotionalAxisEvalConfig,
  setEmotionalAxisEvalConfig,
  resetEmotionalAxisEvalConfig,
  withEmotionalAxisEvalConfig,
} from "./emotionalAxisEvalConfig";

describe("emotionalAxisEvalConfig — scoped config helper", () => {
  it("restores previous config after successful callback", async () => {
    resetEmotionalAxisEvalConfig();
    // Set a non-default initial config
    setEmotionalAxisEvalConfig({ engineEnabled: false, renderEnabled: false });

    await withEmotionalAxisEvalConfig(
      { engineEnabled: true, renderEnabled: true, noCoupling: true },
      async () => {
        const current = getEmotionalAxisEvalConfig();
        assert.equal(current.engineEnabled, true, "engine enabled inside callback");
        assert.equal(current.renderEnabled, true, "render enabled inside callback");
        assert.equal(current.noCoupling, true, "noCoupling inside callback");
        return "ok";
      },
    );

    const restored = getEmotionalAxisEvalConfig();
    assert.equal(restored.engineEnabled, false, "engine restored after callback");
    assert.equal(restored.renderEnabled, false, "render restored after callback");
    assert.equal(restored.noCoupling, false, "noCoupling restored after callback");
  });

  it("restores previous config after thrown error", async () => {
    resetEmotionalAxisEvalConfig();
    setEmotionalAxisEvalConfig({ engineEnabled: false, renderEnabled: false });

    await assert.rejects(
      () =>
        withEmotionalAxisEvalConfig(
          { engineEnabled: true },
          async () => {
            throw new Error("test error");
          },
        ),
      /test error/,
    );

    const restored = getEmotionalAxisEvalConfig();
    assert.equal(restored.engineEnabled, false, "engine restored after error");
    assert.equal(restored.renderEnabled, false, "render restored after error");
  });

  it("returns the callback result", async () => {
    const result = await withEmotionalAxisEvalConfig(
      { engineEnabled: false },
      async () => 42,
    );
    assert.equal(result, 42);
  });

  it("preserves fields not specified in the partial config", async () => {
    resetEmotionalAxisEvalConfig();
    // Start with a known state: engineEnabled=true (default), bandsOnly=true
    setEmotionalAxisEvalConfig({ bandsOnly: true });

    await withEmotionalAxisEvalConfig(
      { engineEnabled: false },
      async () => {
        const current = getEmotionalAxisEvalConfig();
        assert.equal(current.engineEnabled, false, "engine set to false inside callback");
        assert.equal(current.bandsOnly, true, "bandsOnly preserved from previous state");
        assert.equal(current.noCoupling, false, "noCoupling default");
      },
    );

    const restored = getEmotionalAxisEvalConfig();
    // Prior state was { bandsOnly: true, engineEnabled: true, ... } — that should be restored
    assert.equal(restored.bandsOnly, true, "bandsOnly restored");
    assert.equal(restored.engineEnabled, true, "engineEnabled restored to pre-call value (default)");
    assert.equal(restored.noCoupling, false, "noCoupling still default");
  });
});
