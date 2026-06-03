import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ZUO_RAN_EVIDENCE_SEEDS, SEED_VERSION } from "./evidenceSeeds";

const VALID_NODES = ["growth_environment", "core_belief", "core_motivation", "core_fear", "defense_mechanism", "transition_rule", "relationship_scope_gate", "expression_constraint"] as const;

describe("ZUO_RAN_EVIDENCE_SEEDS", () => {
  it("validates seed data integrity: version, count, uniqueness, fields, nodes, provenance, and status partition", () => {
    // Version
    assert.equal(typeof SEED_VERSION, "string", "version — type");
    assert.ok(SEED_VERSION.length > 0, "version — non-empty");

    // Count
    const count = ZUO_RAN_EVIDENCE_SEEDS.length;
    assert.ok(count >= 8 && count <= 12, `count — expected 8-12, got ${count}`);

    // Unique seedId
    const ids = ZUO_RAN_EVIDENCE_SEEDS.map((s) => s.seedId);
    assert.equal(new Set(ids).size, ids.length, "seedId — unique");

    // Per-seed field checks
    for (const seed of ZUO_RAN_EVIDENCE_SEEDS) {
      assert.equal(seed.characterId, "zuo_ran", `seed ${seed.seedId} — characterId`);
      assert.ok((VALID_NODES as readonly string[]).includes(seed.node), `seed ${seed.seedId} — invalid node: ${seed.node}`);
      assert.ok(seed.claimText.trim().length > 0, `seed ${seed.seedId} — empty claimText`);
      assert.ok(seed.evidenceText.trim().length > 0, `seed ${seed.seedId} — empty evidenceText`);
      assert.ok(typeof seed.scopeApplicability === "object" && seed.scopeApplicability !== null, `seed ${seed.seedId} — missing scopeApplicability`);
      assert.ok(seed.applyStatus === "active" || seed.applyStatus === "candidate", `seed ${seed.seedId} — invalid applyStatus: ${seed.applyStatus}`);
      assert.ok(Array.isArray(seed.validationQueries) && seed.validationQueries.length > 0, `seed ${seed.seedId} — missing validationQueries`);
      assert.ok(seed.provenanceNote != null && seed.provenanceNote.trim().length > 0, `seed ${seed.seedId} — missing provenanceNote`);
      const hasProvenance = seed.arcKey || seed.chapterKey || seed.episodeLabel || seed.provenanceNote;
      assert.ok(hasProvenance, `seed ${seed.seedId} — no provenance`);
    }

    // At least one active seed
    const active = ZUO_RAN_EVIDENCE_SEEDS.filter((s) => s.applyStatus === "active");
    assert.ok(active.length >= 1, `active — expected ≥1, got ${active.length}`);

    // Covers at least 3 different nodes
    const nodes = new Set(ZUO_RAN_EVIDENCE_SEEDS.map((s) => s.node));
    assert.ok(nodes.size >= 3, `nodes — expected ≥3, got ${nodes.size}`);

    // Active/candidate IDs do not overlap
    const activeIds = ZUO_RAN_EVIDENCE_SEEDS.filter((s) => s.applyStatus === "active").map((s) => s.seedId);
    const candidateIds = ZUO_RAN_EVIDENCE_SEEDS.filter((s) => s.applyStatus === "candidate").map((s) => s.seedId);
    const overlap = activeIds.filter((id) => candidateIds.includes(id));
    assert.equal(overlap.length, 0, `partition — active/candidate IDs must not overlap: ${overlap.join(", ")}`);

    // Active + candidate partition covers all seeds
    const allIds = new Set(ZUO_RAN_EVIDENCE_SEEDS.map((s) => s.seedId));
    const allFiltered = new Set([...new Set(activeIds), ...new Set(candidateIds)]);
    assert.equal(allFiltered.size, allIds.size, "partition — every seed must be active or candidate");
    assert.equal(activeIds.length + candidateIds.length, allIds.size, "partition — active + candidate = total");
  });
});
