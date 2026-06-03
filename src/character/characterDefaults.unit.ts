import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { loadCharacterDefaults, compareDottedVersions } from "./characterDefaults";

describe("compareDottedVersions", () => {
  it("compares versions correctly: positive, negative, equal, null inputs, non-numeric, parseFloat trap", () => {
    const cases = [
      { name: '"2.10" vs "2.9" → positive', a: "2.10", b: "2.9", expect: (v: number | null) => v !== null && v > 0 },
      { name: '"2.9" vs "2.10" → negative', a: "2.9", b: "2.10", expect: (v: number | null) => v !== null && v < 0 },
      { name: 'equal "2.1" vs "2.1" → 0', a: "2.1", b: "2.1", expect: (v: number | null) => v === 0 },
      { name: '"2.1" vs "2.1.0" → 0 (trailing 0)', a: "2.1", b: "2.1.0", expect: (v: number | null) => v === 0 },
      { name: '"2.1.1" vs "2.1" → 1', a: "2.1.1", b: "2.1", expect: (v: number | null) => v !== null && v > 0 },
      { name: 'null vs "2.1" → null', a: null, b: "2.1", expected: null },
      { name: 'undefined vs "2.1" → null', a: undefined, b: "2.1", expected: null },
      { name: '"abc" vs "2.1" → null', a: "abc", b: "2.1", expected: null },
      { name: '"2.1" vs "xyz" → null', a: "2.1", b: "xyz", expected: null },
      { name: 'both null → null', a: null, b: null, expected: null },
      { name: '"3" vs "2" → positive (single segment)', a: "3", b: "2", expect: (v: number | null) => v !== null && v > 0 },
      { name: 'parseFloat trap: 2.10 > 2.9', a: "2.10", b: "2.9", expect: (v: number | null) => v !== null && v > 0 },
    ];
    for (const c of cases) {
      const result = compareDottedVersions(c.a as any, c.b as any);
      if ("expected" in c) {
        assert.equal(result, (c as any).expected, c.name);
      } else {
        assert.ok((c as any).expect(result), c.name);
      }
    }
  });
});

describe("zuo_ran.yaml guardrail phrases", () => {
  it("validates expression_constraint, autobiographical_caution, in_character_expression, preferred_patterns, avoid, and habits", () => {
    const defaults = loadCharacterDefaults("zuo_ran");

    // expression_constraint P04
    const ec = defaults.internal_logic?.expression_constraint ?? "";
    assert.ok(ec.includes("我习惯把事情想清楚再说出口"), "ec — P04 example 1");
    assert.ok(ec.includes("我不太擅长把这些说清楚"), "ec — P04 example 2");
    assert.ok(ec.includes("我不知道该怎么表达这种情绪"), "ec — P04 example 3");
    assert.ok(ec.includes("沉默、移开目光等细微动作"), "ec — P04 positive replacement");

    // autobiographical_caution P07
    const cc = defaults.canon_correction ?? "";
    assert.ok(cc.includes("autobiographical_caution"), "cc — autobiographical_caution section");
    assert.ok(cc.includes("我不记得自己这样说过"), "cc — cautious response 1");
    assert.ok(cc.includes("我不能确定那是不是我的原话"), "cc — cautious response 2");

    // in_character_expression P10 risk-control
    const ice = defaults.in_character_expression ?? "";
    assert.ok(ice.includes("那条路最近在施工"), "ice — P10 anti-invention example");
    assert.ok(ice.includes("那附近路灯坏了三天"), "ice — P10 environment prohibition");
    assert.ok(ice.includes("询问位置"), "ice — P10 neutral action");

    // P12 apology rule
    assert.ok(ice.includes("具体的补救行动"), "ice — P12 concrete repair action");
    assert.ok(ice.includes("对对方感受的承认"), "ice — P12 acknowledging feeling");

    // preferred_patterns: exactly 4 tokens, order preserved, removed tokens absent
    const prefs = defaults.speech_style?.preferred_patterns ?? [];
    const kept = ["logical_step_by_step", "precise_word_choice", "calm_and_measured", "restrained_tenderness_when_intimate"];
    assert.equal(prefs.length, 4, `prefs — expected 4, got ${prefs.length}`);
    for (let i = 0; i < kept.length; i++) {
      assert.equal(prefs[i], kept[i], `prefs — kept[${i}] should match`);
    }
    const removedPrefs = ["short_sentences_ellipsis_breathing", "indirect_emotion_via_action_environment", "natural_imagery_metaphor_sparing", "literary_narration_colloquial_dialogue"];
    for (const token of removedPrefs) {
      assert.ok(!prefs.includes(token), `prefs — removed "${token}" should NOT appear`);
    }

    // avoid: exactly 5 tokens, original keywords survive
    const avoid = defaults.speech_style?.avoid ?? [];
    const avoidKept = ["exaggeration_or_ornate_rhetoric", "frivolous_flirting_or_excessive_sweet_talk", "emotional_comfort_without_rational_basis", "cold_detached_ai_like_tone", "blunt_emotion_labels"];
    assert.equal(avoid.length, 5, `avoid — expected 5, got ${avoid.length}`);
    for (let i = 0; i < avoidKept.length; i++) {
      assert.equal(avoid[i], avoidKept[i], `avoid — kept[${i}] should match`);
    }
    const originalKeywords = ["exaggeration", "ornate_rhetoric", "frivolous_flirting", "excessive_sweet_talk", "emotional_comfort_without_rational_basis", "cold_detached_ai_like_tone", "blunt_emotion_labels"];
    const avoidText = avoid.join(" ");
    for (const keyword of originalKeywords) {
      assert.ok(avoidText.includes(keyword), `avoid — keyword "${keyword}" should survive`);
    }

    // private_habits_and_texture: exactly 3 universal lines, absent fragments
    const habits = defaults.private_habits_and_texture ?? [];
    const habitKept = [
      "紧张或有心事时，可能会不自觉揉捏手边的小物件（家里的生日小熊都被他捏得头不圆了）",
      "思考时动作细微，常表现为停顿、垂眼、整理袖口或轻触指节",
      "婚后的新习惯：思考时会转妻子手指上的戒指",
    ];
    assert.equal(habits.length, 3, `habits — expected 3, got ${habits.length}`);
    for (let i = 0; i < habitKept.length; i++) {
      assert.equal(habits[i], habitKept[i], `habits — kept[${i}] should match`);
    }
    const absentFragments = ["射击", "知更鸟", "科幻小说", "拔丝红薯", "撬锁", "电线杆", "埋情书", "偷喝冰箱", "糖炒栗子", "行李箱", "副驾驶"];
    const habitsText = habits.join(" ");
    for (const frag of absentFragments) {
      assert.ok(!habitsText.includes(frag), `habits — absent "${frag}" should NOT appear`);
    }
  });
});
