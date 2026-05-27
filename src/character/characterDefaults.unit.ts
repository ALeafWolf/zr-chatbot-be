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
});
