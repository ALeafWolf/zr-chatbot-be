import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  runDeterministicValidatorGuards,
  __testing,
} from "./runResponseValidator";

const { isStrictAttributionEligible } = __testing;

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

  it("does not produce canon_unsupported_claim when canon attribution cues are present but no canon was injected", () => {
    const failures = runDeterministicValidatorGuards({
      draft: "根据原作剧情，第一次见面是在枫河边。",
      continuityScope: "main_relationship",
      maxNsfwLevel: "medium",
      wasCanonInjected: false,
    });
    const canonKinds = failures.filter(
      (f) => f.kind === "canon_unsupported_claim",
    );
    assert.equal(
      canonKinds.length,
      0,
      "should not produce canon_unsupported_claim after guard relaxation",
    );
  });
});

describe("isStrictAttributionEligible", () => {
  it("returns false when wasCanonInjected is false even if retrievedCanonNarrative has a non-empty placeholder", () => {
    assert.equal(isStrictAttributionEligible(false), false);
  });

  it("returns false when wasCanonInjected is undefined", () => {
    assert.equal(isStrictAttributionEligible(undefined), false);
  });

  it("returns true when wasCanonInjected is true", () => {
    assert.equal(isStrictAttributionEligible(true), true);
  });
});
