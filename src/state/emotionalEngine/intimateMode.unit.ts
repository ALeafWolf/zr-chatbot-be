import assert from "node:assert/strict";
import test from "node:test";
import { isIntimateMode } from "./intimateMode";

test("isIntimateMode preserves all three intimate trigger paths", () => {
  assert.equal(
    isIntimateMode(undefined, undefined, { arousal: "high" }),
    true,
    "arousal high triggers intimate mode",
  );
  assert.equal(
    isIntimateMode(undefined, "recent intimate_moment event", { arousal: "mid" }),
    true,
    "intimate_moment event triggers intimate mode",
  );

  const highBandLine = String.fromCodePoint(0x5524, 0x8d77, 0xff1a, 0x9ad8); // 唤起：高
  assert.equal(
    isIntimateMode(highBandLine, undefined, { arousal: "mid" }),
    true,
    "唤起：高 band line triggers intimate mode",
  );

  // The label formatBandLine actually renders for the high band is "偏高".
  const highLabelBandLine = String.fromCodePoint(0x5524, 0x8d77, 0xff1a, 0x504f, 0x9ad8); // 唤起：偏高
  assert.equal(
    isIntimateMode(highLabelBandLine, undefined, { arousal: "mid" }),
    true,
    "唤起：偏高 (rendered high label) band line triggers intimate mode",
  );

  assert.equal(
    isIntimateMode("当前状态：唤起：中", "routine_exchange", { arousal: "mid" }),
    false,
    "non-intimate state does not trigger intimate mode",
  );
});
