import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { validateCouplings, validateCoupling, resetAutoIdCounter } from "./validateCouplings";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function validRaw(overrides?: Record<string, unknown>): Record<string, unknown> {
  return {
    id: "zr_c1",
    source: "arousal",
    target: "restraint",
    effect_type: "direct_delta",
    coefficient: 0.6,
    derived_from: "defense_mechanism",
    ...overrides,
  };
}

const INTERNAL_LOGIC_KEYS = new Set([
  "growth_environment", "core_belief", "core_motivation", "core_fear",
  "defense_mechanism", "transition_rule", "relationship_scope_gate", "expression_constraint",
]);

// Track warning messages
let warnMessages: string[] = [];
let errorMessages: string[] = [];

function captureWarnings() {
  warnMessages = [];
  errorMessages = [];
  const origWarn = console.warn;
  const origError = console.error;
  console.warn = (msg: string) => { warnMessages.push(msg); };
  console.error = (msg: string) => { errorMessages.push(msg); };
  return () => {
    console.warn = origWarn;
    console.error = origError;
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("validateCouplings — TG5", () => {

  describe("happy path", () => {
    it("parses all three zuo_ran couplings from YAML", () => {
      const restore = captureWarnings();
      const input = [
        { id: "zr_c1", source: "arousal", target: "restraint", effect_type: "direct_delta", coefficient: 0.6, derived_from: "defense_mechanism" },
        { id: "zr_c2", source: "connection", target: "restraint", effect_type: "baseline_shift", coefficient: -0.4, condition: { axis: "valence", threshold: 0, comparison: "above" }, derived_from: "transition_rule" },
        { id: "zr_c3", source: "valence", target: "restraint", effect_type: "direct_delta", coefficient: -0.5, condition: { axis: "valence", threshold: -0.2, comparison: "below" }, derived_from: "core_fear" },
      ];
      const result = validateCouplings(input, INTERNAL_LOGIC_KEYS);
      assert.equal(result.length, 3);
      assert.equal(result[0].id, "zr_c1");
      assert.equal(result[1].id, "zr_c2");
      assert.equal(result[2].id, "zr_c3");
      assert.equal(result[1].condition?.axis, "valence");
      assert.equal(result[1].condition?.comparison, "above");
      assert.equal(result[2].condition?.axis, "valence");
      assert.equal(result[2].condition?.comparison, "below");
      assert.equal(warnMessages.length, 0, "no warnings for valid couplings");
      restore();
    });
  });

  describe("validation rows", () => {
    it("unknown source/target axis → skip+warn", () => {
      const r1 = validateCoupling(validRaw({ source: "unknown_axis" }), 0);
      assert.equal(r1, null);
      const r2 = validateCoupling(validRaw({ target: "immersion" }), 1);
      assert.equal(r2, null);
    });

    it("coefficient out of range → clamp+warn", () => {
      const t = (raw: Record<string, unknown>, expected: number, label: string) => {
        const r = validateCoupling(raw, 0);
        assert.ok(r !== null, label);
        assert.equal(r!.coefficient, expected, label);
      };
      t(validRaw({ coefficient: 10 }), 5, "10 clamped to 5");
      t(validRaw({ coefficient: -10 }), -5, "-10 clamped to -5");
      t(validRaw({ effect_type: "baseline_shift", coefficient: 5 }), 1, "5 clamped to 1");
      t(validRaw({ effect_type: "baseline_shift", coefficient: -5 }), -1, "-5 clamped to -1");
    });

    it("F20: missing/non-finite coefficient → skip + error log", () => {
      const restore = captureWarnings();
      const r1 = validateCoupling(validRaw({ coefficient: undefined }), 0);
      assert.equal(r1, null, "missing coefficient → skip");
      assert.ok(errorMessages.some(m => m.includes("missing required coefficient")), "error logged");

      const r2 = validateCoupling(validRaw({ coefficient: "not-a-number" }), 1);
      assert.equal(r2, null, "non-numeric coefficient → skip");
      assert.ok(errorMessages.some(m => m.includes("non-finite coefficient")), "error logged");

      const r3 = validateCoupling(validRaw({ coefficient: NaN }), 2);
      assert.equal(r3, null, "NaN coefficient → skip");
      restore();
    });

    it("F19: unknown derived_from warns when valid sources known", () => {
      const restore = captureWarnings();
      const result = validateCoupling(validRaw({ derived_from: "nonexistent_node" }), 0, INTERNAL_LOGIC_KEYS);
      assert.ok(result !== null, "coupling still parsed despite unknown derived_from");
      assert.ok(warnMessages.some(m => m.includes("unknown derived_from")), "warning emitted for unknown derived_from");
      restore();
    });

    it("F19: known derived_from does not warn", () => {
      const restore = captureWarnings();
      const result = validateCoupling(validRaw({ derived_from: "defense_mechanism" }), 0, INTERNAL_LOGIC_KEYS);
      assert.ok(result !== null);
      assert.ok(!warnMessages.some(m => m.includes("unknown derived_from")), "no warning for known derived_from");
      restore();
    });

    it("unknown condition axis → treat unconditional+warn", () => {
      const result = validateCoupling(validRaw({
        condition: { axis: "magic", threshold: 0, comparison: "above" },
      }), 0);
      assert.ok(result !== null);
      assert.equal(result!.condition, undefined, "condition dropped when axis unknown");
    });

    it("missing/duplicate id → auto-assign+warn", () => {
      resetAutoIdCounter();
      const result = validateCoupling(validRaw({ id: undefined }), 0);
      assert.ok(result !== null);
      assert.ok(result!.id.startsWith("arousal_restraint_"), "auto-assigned id");

      // Duplicate id in array
      const arr = [
        validRaw({ id: "dup_id" }),
        validRaw({ id: "dup_id" }),
      ];
      const parsed = validateCouplings(arr);
      assert.equal(parsed.length, 2);
      assert.equal(parsed[0].id, "dup_id");
      assert.ok(parsed[1].id !== "dup_id", "second gets different id");
    });

    it("malformed coupling → skip+error log", () => {
      const result = validateCoupling("not an object", 0);
      assert.equal(result, null);

      const result2 = validateCoupling(null, 1);
      assert.equal(result2, null);

      const result3 = validateCoupling({}, 2);
      assert.equal(result3, null, "empty object skips (missing source/target)");
    });

    it("handles non-array input", () => {
      const r1 = validateCouplings("string");
      assert.deepEqual(r1, []);
      const r2 = validateCouplings(undefined);
      assert.deepEqual(r2, []);
    });
  });
});
