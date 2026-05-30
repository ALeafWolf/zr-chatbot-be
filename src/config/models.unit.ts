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

  it("parses one or two fallback bindings and drops primary duplicates", () => {
    const primary: ModelBinding = {
      provider: "deepseek",
      model: "deepseek-v4-flash",
    };
    assert.deepEqual(
      parseFallbackModelBindings(
        "deepseek:deepseek-v4-flash, openai:gpt-5-nano openai:gpt-5-mini",
        primary,
      ),
      [
        { provider: "openai", model: "gpt-5-nano" },
        { provider: "openai", model: "gpt-5-mini" },
      ],
    );
  });

  it("allows disabling fallback bindings with none", () => {
    assert.deepEqual(parseFallbackModelBindings("none"), []);
  });
});
