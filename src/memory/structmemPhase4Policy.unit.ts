import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  mapStableCategoryToMemoryType,
  normalizeStableCategory,
  shouldPromoteStructMemToIme,
  shouldWriteCrossSessionStructMem,
  type StructMemStableCategory,
} from "./structmemPhase4Policy";

describe("structmemPhase4Policy", () => {
  it("gates cross-session writes by flag, sandbox mode, and writeback policy", () => {
    assert.equal(
      shouldWriteCrossSessionStructMem({
        enabled: false,
        sessionMode: "canonical_live",
        writebackPolicy: "full_writeback",
      }),
      false,
    );
    assert.equal(
      shouldWriteCrossSessionStructMem({
        enabled: true,
        sessionMode: "sandbox",
        writebackPolicy: "full_writeback",
      }),
      false,
    );
    assert.equal(
      shouldWriteCrossSessionStructMem({
        enabled: true,
        sessionMode: "canonical_live",
        writebackPolicy: "no_writeback",
      }),
      false,
    );
    assert.equal(
      shouldWriteCrossSessionStructMem({
        enabled: true,
        sessionMode: "canonical_live",
        writebackPolicy: "full_writeback",
      }),
      true,
    );
  });

  it("uses the same gates for optional IME promotion", () => {
    assert.equal(
      shouldPromoteStructMemToIme({
        enabled: true,
        sessionMode: "canonical_live",
        writebackPolicy: "full_writeback",
      }),
      true,
    );
    assert.equal(
      shouldPromoteStructMemToIme({
        enabled: true,
        sessionMode: "canonical_live",
        writebackPolicy: "no_writeback",
      }),
      false,
    );
  });

  it("maps stable categories only to existing interactive memory types", () => {
    const cases: Array<[StructMemStableCategory, string]> = [
      ["promise_or_commitment", "promise"],
      ["stable_relationship_pattern", "relationship_transition"],
      ["relationship_milestone", "relationship_transition"],
      ["recurring_preference", "preference"],
      ["repeated_habit", "habit"],
      ["interaction_style_or_inside_joke", "banter"],
    ];

    for (const [category, memoryType] of cases) {
      assert.equal(mapStableCategoryToMemoryType(category), memoryType);
    }
  });

  it("normalizes safe distiller category aliases before enum validation", () => {
    assert.equal(normalizeStableCategory("user_preference"), "recurring_preference");
    assert.equal(normalizeStableCategory("inside_joke"), "interaction_style_or_inside_joke");
    assert.equal(normalizeStableCategory("promise"), "promise_or_commitment");
    assert.equal(normalizeStableCategory("unknown_category"), "unknown_category");
  });
});
