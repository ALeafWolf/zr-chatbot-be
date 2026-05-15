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
  it("does not warn for a fully enabled recipe", () => {
    assert.deepEqual(validateStructMemFlagConfig(validFlags), []);
  });

  it("warns when consolidation is enabled without StructMem", () => {
    const warnings = validateStructMemFlagConfig({
      ...validFlags,
      STRUCTMEM_ENABLED: false,
    });
    assert.ok(
      warnings.some((warning) =>
        warning.includes("STRUCTMEM_CONSOLIDATION_ENABLED"),
      ),
    );
  });

  it("warns when cross-session writes have no read or promotion path", () => {
    const warnings = validateStructMemFlagConfig({
      ...validFlags,
      STRUCTMEM_CROSS_SESSION_RETRIEVAL_ENABLED: false,
      STRUCTMEM_PROMOTION_TO_IME_ENABLED: false,
    });
    assert.ok(
      warnings.some((warning) =>
        warning.includes("STRUCTMEM_CROSS_SESSION_WRITE_ENABLED"),
      ),
    );
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
