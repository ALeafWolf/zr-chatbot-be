import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { loadCharacterDefaults } from "./characterDefaults";

describe("zuo_ran.yaml guardrail phrases", () => {
  const defaults = loadCharacterDefaults("zuo_ran");

  it("loads expression_constraint with P04 self-analysis negative examples", () => {
    const ec = defaults.internal_logic?.expression_constraint ?? "";
    assert.ok(
      ec.includes("我习惯把事情想清楚再说出口"),
      "expression_constraint should contain P04 negative example: 我习惯把事情想清楚再说出口",
    );
    assert.ok(
      ec.includes("我不太擅长把这些说清楚"),
      "expression_constraint should contain P04 negative example: 我不太擅长把这些说清楚",
    );
    assert.ok(
      ec.includes("我不知道该怎么表达这种情绪"),
      "expression_constraint should contain P04 negative example: 我不知道该怎么表达这种情绪",
    );
    assert.ok(
      ec.includes("沉默、移开目光等细微动作"),
      "expression_constraint should contain P04 positive replacement pattern",
    );
  });

  it("includes autobiographical_caution with P07 accepted cautious responses", () => {
    const cc = defaults.canon_correction ?? "";
    assert.ok(
      cc.includes("autobiographical_caution"),
      "canon_correction should contain autobiographical_caution section",
    );
    assert.ok(
      cc.includes("我不记得自己这样说过"),
      "autobiographical_caution should contain accepted cautious response",
    );
    assert.ok(
      cc.includes("我不能确定那是不是我的原话"),
      "autobiographical_caution should contain accepted cautious response",
    );
  });

  it("includes risk-control anti-invention wording in in_character_expression (P10)", () => {
    const ice = defaults.in_character_expression ?? "";
    assert.ok(
      ice.includes("那条路最近在施工"),
      "in_character_expression should contain P10 risk-control anti-invention example",
    );
    assert.ok(
      ice.includes("那附近路灯坏了三天"),
      "in_character_expression should contain P10 environment/logistics fact prohibition",
    );
    assert.ok(
      ice.includes("询问位置"),
      "in_character_expression should contain P10 neutral action: 询问位置",
    );
  });

  it("includes concrete repair action in apology rule (P12)", () => {
    const ice = defaults.in_character_expression ?? "";
    assert.ok(
      ice.includes("具体的补救行动"),
      "in_character_expression should mention concrete repair action in apology rule",
    );
    assert.ok(
      ice.includes("对对方感受的承认"),
      "in_character_expression should mention acknowledging the user's feeling",
    );
  });

  it("preferred_patterns contains exactly the 4 internal-logic-derived tokens (authorial-craft duplication removed)", () => {
    const prefs = defaults.speech_style?.preferred_patterns ?? [];
    const kept = [
      "logical_step_by_step",
      "precise_word_choice",
      "calm_and_measured",
      "restrained_tenderness_when_intimate",
    ];
    // Exact cardinality
    assert.equal(
      prefs.length,
      4,
      `expected exactly 4 preferred_patterns, got ${prefs.length}`,
    );
    // Exact equality for each kept token
    for (let i = 0; i < kept.length; i++) {
      assert.equal(
        prefs[i],
        kept[i],
        `kept token ${i} should match exactly: "${kept[i]}"`,
      );
    }
    // Absence of the 4 removed authorial-craft tokens
    const removed = [
      "short_sentences_ellipsis_breathing",
      "indirect_emotion_via_action_environment",
      "natural_imagery_metaphor_sparing",
      "literary_narration_colloquial_dialogue",
    ];
    for (const token of removed) {
      assert.ok(
        !prefs.includes(token),
        `removed authorial-craft token "${token}" should NOT appear in preferred_patterns`,
      );
    }
  });

  it("avoid has exactly 5 compressed guardrail tokens (7 concepts merged to 5)", () => {
    const avoid = defaults.speech_style?.avoid ?? [];
    const kept = [
      "exaggeration_or_ornate_rhetoric",
      "frivolous_flirting_or_excessive_sweet_talk",
      "emotional_comfort_without_rational_basis",
      "cold_detached_ai_like_tone",
      "blunt_emotion_labels",
    ];
    // Exact cardinality
    assert.equal(
      avoid.length,
      5,
      `expected exactly 5 avoid tokens, got ${avoid.length}`,
    );
    // Exact equality for each kept token in order
    for (let i = 0; i < kept.length; i++) {
      assert.equal(
        avoid[i],
        kept[i],
        `avoid token ${i} should match exactly: "${kept[i]}"`,
      );
    }
    // All 7 original concept keywords survive inside the merged tokens
    const originalKeywords = [
      "exaggeration",
      "ornate_rhetoric",
      "frivolous_flirting",
      "excessive_sweet_talk",
      "emotional_comfort_without_rational_basis",
      "cold_detached_ai_like_tone",
      "blunt_emotion_labels",
    ];
    const avoidText = avoid.join(" ");
    for (const keyword of originalKeywords) {
      assert.ok(
        avoidText.includes(keyword),
        `original guardrail concept "${keyword}" should still appear in avoid tokens`,
      );
    }
  });

  it("private_habits_and_texture is trimmed to exactly the 3 universal always-on lines", () => {
    const habits = defaults.private_habits_and_texture ?? [];
    const kept = [
      "紧张或有心事时，可能会不自觉揉捏手边的小物件（家里的生日小熊都被他捏得头不圆了）",
      "思考时动作细微，常表现为停顿、垂眼、整理袖口或轻触指节",
      "婚后的新习惯：思考时会转妻子手指上的戒指",
    ];
    // Exact cardinality
    assert.equal(
      habits.length,
      3,
      `expected exactly 3 habits, got ${habits.length}`,
    );
    // Exact equality for each kept line
    for (let i = 0; i < kept.length; i++) {
      assert.equal(
        habits[i],
        kept[i],
        `kept line ${i} should match exactly: "${kept[i]}"`,
      );
    }
    // Absence of representative fragments from every relocated row
    const absentFragments = [
      "射击",
      "知更鸟",
      "科幻小说",
      "拔丝红薯",
      "撬锁",
      "电线杆",
      "埋情书",
      "偷喝冰箱",
      "糖炒栗子",
      "行李箱",
      "副驾驶",
    ];
    const habitsText = habits.join(" ");
    for (const frag of absentFragments) {
      assert.ok(
        !habitsText.includes(frag),
        `relocated fragment "${frag}" should NOT appear in trimmed habits`,
      );
    }
  });
});
