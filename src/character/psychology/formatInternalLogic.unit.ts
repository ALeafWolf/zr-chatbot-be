/**
 * TG5 tests — formatDirectorCharacterDigest deterministic formatter.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { formatDirectorCharacterDigest } from "./formatInternalLogic";
import type { CharacterDefaults } from "../characterDefaults";

// ---------------------------------------------------------------------------
// formatDirectorCharacterDigest — director character-core digest
// ---------------------------------------------------------------------------

describe("formatDirectorCharacterDigest", () => {
  const baseDefaults: CharacterDefaults = {
    character_id: "zuo_ran",
    name: "左然",
    archetype: "elite_lawyer_controlled_romantic",
    identity: "精英律师",
    speech_style: {
      language: "Chinese",
      formality: "formal",
      emotionality: "restrained",
      preferred_patterns: [],
      avoid: [],
    },
    hard_rules: [],
    interaction_defaults: {
      default_continuity_scope: "main",
      default_emotional_baseline: "calm",
      default_relationship_baseline: "neutral",
      response_length: "medium",
      allows_personal_topics: "sometimes",
    },
    safe_deflection: "",
    version: "1.0",
  };

  it("renders all five digest fields with name and archetype when all present", () => {
    const defaults: CharacterDefaults = {
      ...baseDefaults,
      internal_logic: {
        core_motivation: "以可靠行动守护珍视的人",
        core_fear: "因失控辜负他人",
        defense_mechanism: "沉默/转移话题/确认事实",
        transition_rule: "克制→停顿→试探性松动",
        relationship_scope_gate: "与关系阶段匹配",
      },
    };
    const result = formatDirectorCharacterDigest(defaults);
    assert.ok(result.startsWith("角色：左然（elite_lawyer_controlled_romantic）"), "name + archetype header");
    assert.ok(result.includes("核心动机：以可靠行动守护珍视的人"), "core_motivation");
    assert.ok(result.includes("核心恐惧：因失控辜负他人"), "core_fear");
    assert.ok(result.includes("防御机制：沉默/转移话题/确认事实"), "defense_mechanism");
    assert.ok(result.includes("状态转换规则：克制→停顿→试探性松动"), "transition_rule");
    assert.ok(result.includes("关系阶段门控：与关系阶段匹配"), "relationship_scope_gate");
  });

  it("skips empty/undefined fields but still renders name/archetype", () => {
    const defaults: CharacterDefaults = {
      ...baseDefaults,
      internal_logic: {
        core_motivation: "仅动机存在",
        core_fear: "",
        defense_mechanism: undefined,
        transition_rule: "  ",
        relationship_scope_gate: undefined,
      },
    };
    const result = formatDirectorCharacterDigest(defaults);
    assert.ok(result.includes("核心动机：仅动机存在"), "core_motivation rendered");
    assert.equal(result.includes("核心恐惧："), false, "core_fear skipped (empty string)");
    assert.equal(result.includes("防御机制："), false, "defense_mechanism skipped (undefined)");
    assert.equal(result.includes("状态转换规则："), false, "transition_rule skipped (whitespace only)");
    assert.equal(result.includes("关系阶段门控："), false, "relationship_scope_gate skipped (undefined)");
  });

  it("returns empty string when internal_logic is absent", () => {
    const defaults: CharacterDefaults = {
      ...baseDefaults,
      internal_logic: undefined,
    };
    assert.equal(formatDirectorCharacterDigest(defaults), "");
  });

  it("returns empty string when all digest fields are empty/absent", () => {
    const defaults: CharacterDefaults = {
      ...baseDefaults,
      internal_logic: {
        core_motivation: "",
        core_fear: undefined,
        defense_mechanism: "   ",
        transition_rule: undefined,
        relationship_scope_gate: undefined,
      },
    };
    assert.equal(formatDirectorCharacterDigest(defaults), "");
  });

  it("excluded fields (growth_environment, core_belief, expression_constraint) never appear in output", () => {
    const defaults: CharacterDefaults = {
      ...baseDefaults,
      internal_logic: {
        core_motivation: "test",
        core_fear: "test",
        defense_mechanism: "test",
        transition_rule: "test",
        relationship_scope_gate: "test",
        growth_environment: "should NOT appear",
        core_belief: "should NOT appear",
        expression_constraint: "should NOT appear",
      },
    };
    const result = formatDirectorCharacterDigest(defaults);
    assert.ok(result.includes("核心动机：test"), "core_motivation present");
    assert.equal(result.includes("成长底色"), false, "growth_environment excluded");
    assert.equal(result.includes("核心信念"), false, "core_belief excluded");
    assert.equal(result.includes("表达约束"), false, "expression_constraint excluded");
  });
});
