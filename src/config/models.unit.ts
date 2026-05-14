import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  parseModelBinding,
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
});
