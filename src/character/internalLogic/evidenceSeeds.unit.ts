import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ZUO_RAN_EVIDENCE_SEEDS, SEED_VERSION } from "./evidenceSeeds";

const VALID_NODES = [
  "growth_environment",
  "core_belief",
  "core_motivation",
  "core_fear",
  "defense_mechanism",
  "transition_rule",
  "relationship_scope_gate",
  "expression_constraint",
] as const;

describe("ZUO_RAN_EVIDENCE_SEEDS", () => {
  it("has a defined SEED_VERSION", () => {
    assert.equal(typeof SEED_VERSION, "string");
    assert.ok(SEED_VERSION.length > 0);
  });

  it("contains between 8 and 12 seed rows", () => {
    const count = ZUO_RAN_EVIDENCE_SEEDS.length;
    assert.ok(count >= 8 && count <= 12, `Expected 8-12 seeds, got ${count}`);
  });

  it("every seed has a unique seedId", () => {
    const ids = ZUO_RAN_EVIDENCE_SEEDS.map((s) => s.seedId);
    assert.equal(new Set(ids).size, ids.length, "seedId values must be unique");
  });

  it("every seed has characterId 'zuo_ran'", () => {
    for (const seed of ZUO_RAN_EVIDENCE_SEEDS) {
      assert.equal(seed.characterId, "zuo_ran", `seed ${seed.seedId} has wrong characterId`);
    }
  });

  it("every seed has a valid node", () => {
    for (const seed of ZUO_RAN_EVIDENCE_SEEDS) {
      assert.ok(
        (VALID_NODES as readonly string[]).includes(seed.node),
        `seed ${seed.seedId} has invalid node: ${seed.node}`,
      );
    }
  });

  it("every seed has non-empty claimText and evidenceText", () => {
    for (const seed of ZUO_RAN_EVIDENCE_SEEDS) {
      assert.ok(seed.claimText.trim().length > 0, `seed ${seed.seedId} has empty claimText`);
      assert.ok(seed.evidenceText.trim().length > 0, `seed ${seed.seedId} has empty evidenceText`);
    }
  });

  it("every seed has scopeApplicability object", () => {
    for (const seed of ZUO_RAN_EVIDENCE_SEEDS) {
      assert.ok(
        typeof seed.scopeApplicability === "object" && seed.scopeApplicability !== null,
        `seed ${seed.seedId} missing scopeApplicability`,
      );
    }
  });

  it("every seed has at least one validation query", () => {
    for (const seed of ZUO_RAN_EVIDENCE_SEEDS) {
      assert.ok(
        Array.isArray(seed.validationQueries) && seed.validationQueries.length > 0,
        `seed ${seed.seedId} missing validationQueries`,
      );
    }
  });

  it("every seed has a provenance note", () => {
    for (const seed of ZUO_RAN_EVIDENCE_SEEDS) {
      assert.ok(
        seed.provenanceNote != null && seed.provenanceNote.trim().length > 0,
        `seed ${seed.seedId} missing provenanceNote`,
      );
    }
  });

  it("every seed has at least partial provenance fields (arcKey, chapterKey, or provenanceNote)", () => {
    for (const seed of ZUO_RAN_EVIDENCE_SEEDS) {
      const hasProvenance = seed.arcKey || seed.chapterKey || seed.episodeLabel || seed.provenanceNote;
      assert.ok(hasProvenance, `seed ${seed.seedId} has no provenance at all`);
    }
  });

  it("covers at least 3 different internal-logic nodes", () => {
    const nodes = new Set(ZUO_RAN_EVIDENCE_SEEDS.map((s) => s.node));
    assert.ok(nodes.size >= 3, `Expected at least 3 distinct nodes, got ${nodes.size}: ${[...nodes].join(", ")}`);
  });
});
