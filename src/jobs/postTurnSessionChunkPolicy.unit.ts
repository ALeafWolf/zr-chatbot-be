import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { shouldSuppressExtractorSessionChunks } from "./postTurnPolicies";

describe("postTurnPolicies", () => {
  it("does not suppress extractor chunks when StructMem is disabled", () => {
    assert.equal(
      shouldSuppressExtractorSessionChunks({
        structMemEnabled: false,
        suppressExtractorSessionChunks: true,
        nativeStructMemExtractor: true,
      }),
      false,
    );
  });

  it("suppresses extractor chunks when the Phase 1 suppression flag is enabled", () => {
    assert.equal(
      shouldSuppressExtractorSessionChunks({
        structMemEnabled: true,
        suppressExtractorSessionChunks: true,
        nativeStructMemExtractor: false,
      }),
      true,
    );
  });

  it("suppresses extractor chunks on the Phase 2 native StructMem path", () => {
    assert.equal(
      shouldSuppressExtractorSessionChunks({
        structMemEnabled: true,
        suppressExtractorSessionChunks: false,
        nativeStructMemExtractor: true,
      }),
      true,
    );
  });

  it("keeps legacy extractor chunks when StructMem is on but both suppression paths are off", () => {
    assert.equal(
      shouldSuppressExtractorSessionChunks({
        structMemEnabled: true,
        suppressExtractorSessionChunks: false,
        nativeStructMemExtractor: false,
      }),
      false,
    );
  });
});
