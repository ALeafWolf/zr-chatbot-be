import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  validateStructMemFlagConfig,
  warnStructMemFlagConfig,
} from "./structMemConfigValidation";

const validFlags = {
  STRUCTMEM_ENABLED: true,
  STRUCTMEM_CONSOLIDATION_ENABLED: true,
  STRUCTMEM_CROSS_SESSION_RETRIEVAL_ENABLED: true,
  STRUCTMEM_CROSS_SESSION_WRITE_ENABLED: true,
  STRUCTMEM_PROMOTION_TO_IME_ENABLED: true,
};

describe("StructMem config validation", () => {
  it("validates StructMem flag recipe: fully enabled, consolidation-no-structmem, cross-session-write-no-read", () => {
    assert.deepEqual(validateStructMemFlagConfig(validFlags), [], "fully enabled");

    {
      const warnings = validateStructMemFlagConfig({
        ...validFlags,
        STRUCTMEM_ENABLED: false,
      });
      assert.ok(
        warnings.some((warning) =>
          warning.includes("STRUCTMEM_CONSOLIDATION_ENABLED"),
        ),
        "consolidation without StructMem",
      );
    }

    {
      const warnings = validateStructMemFlagConfig({
        ...validFlags,
        STRUCTMEM_CROSS_SESSION_RETRIEVAL_ENABLED: false,
        STRUCTMEM_PROMOTION_TO_IME_ENABLED: false,
      });
      assert.ok(
        warnings.some((warning) =>
          warning.includes("STRUCTMEM_CROSS_SESSION_WRITE_ENABLED"),
        ),
        "cross-session writes no read/promotion path",
      );
    }
  });

  it("emits warnings through an injected logger", () => {
    const emitted: string[] = [];
    const warnings = warnStructMemFlagConfig(
      {
        ...validFlags,
        STRUCTMEM_CONSOLIDATION_ENABLED: false,
      },
      (message) => emitted.push(message),
    );
    assert.equal(warnings.length, 1);
    assert.equal(emitted.length, 1);
  });
});
