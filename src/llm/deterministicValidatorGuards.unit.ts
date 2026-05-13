import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { runDeterministicValidatorGuards } from "./runResponseValidator";

describe("runDeterministicValidatorGuards", () => {
  it("flags obvious AI/meta assistant language", () => {
    const failures = runDeterministicValidatorGuards({
      draft: "As an AI assistant, I can help.",
      continuityScope: "main_relationship",
      maxNsfwLevel: "medium",
    });
    assert.equal(failures[0]?.kind, "meta_assistant_language");
  });

  it("flags relationship scope leakage", () => {
    const failures = runDeterministicValidatorGuards({
      draft: "我们结婚之后再说。",
      continuityScope: "main_situationship",
      maxNsfwLevel: "medium",
    });
    assert.equal(failures[0]?.kind, "scope_leakage");
  });

  it("flags explicit content when scope is low", () => {
    const failures = runDeterministicValidatorGuards({
      draft: "They talk about sex explicitly.",
      continuityScope: "main_married",
      maxNsfwLevel: "low",
    });
    assert.equal(failures[0]?.kind, "nsfw_bounds");
  });

  it("passes clean in-character prose", () => {
    const failures = runDeterministicValidatorGuards({
      draft: "我会记得你刚才说的话，先别急。",
      continuityScope: "main_married",
      maxNsfwLevel: "medium",
    });
    assert.deepEqual(failures, []);
  });
});
