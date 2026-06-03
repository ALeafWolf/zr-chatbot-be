import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  parseModelBinding,
  parseFallbackModelBindings,
  resolveConsolidationModelBinding,
  type ModelBinding,
} from "./models";

describe("model bindings", () => {
  it("resolves EXTRACTOR_MODEL consolidation sentinel to extractor binding", () => {
    const extractor: ModelBinding = {
      provider: "deepseek",
      model: "deepseek-chat",
    };
    assert.deepEqual(
      resolveConsolidationModelBinding("EXTRACTOR_MODEL", extractor),
      extractor,
    );
  });

  it("parses explicit consolidation model bindings", () => {
    assert.deepEqual(parseModelBinding("anthropic:claude-haiku-4-5"), {
      provider: "anthropic",
      model: "claude-haiku-4-5",
    });
  });

  it("parses fallback bindings: normal, duplicate-drop, disabled, invalid", () => {
    const primary: ModelBinding = {
      provider: "deepseek",
      model: "deepseek-v4-flash",
    };
    {
      const r = parseFallbackModelBindings(
        "deepseek:deepseek-v4-flash, openai:gpt-5-nano openai:gpt-5-mini",
        primary,
      );
      assert.deepEqual(r, [
        { provider: "openai", model: "gpt-5-nano" },
        { provider: "openai", model: "gpt-5-mini" },
      ], "normal");
    }
    {
      const r = parseFallbackModelBindings("none");
      assert.deepEqual(r, [], "disabled");
    }
  });
});
