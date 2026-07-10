import assert from "node:assert/strict";
import test from "node:test";
import {
  INTIMATE_SENSORY_GUIDANCE_BLOCK,
  buildIntimateSensoryGuidanceBlock,
} from "./intimateSensoryGuidance";

test("intimate sensory guidance contains readable approved content", () => {
  const block = buildIntimateSensoryGuidanceBlock();

  assert.strictEqual(block, INTIMATE_SENSORY_GUIDANCE_BLOCK);
  assert.strictEqual(block.codePointAt(0), 0x3010);
  for (const term of [
    [0x611f, 0x5b98], // 感官
    [0x89e6, 0x89c9], // 触觉
    [0x89c6, 0x89c9], // 视觉
    [0x542c, 0x89c9], // 听觉
    [0x55c5, 0x5473, 0x89c9], // 嗅味觉 (as approved)
  ]) {
    assert.ok(block.includes(String.fromCodePoint(...term)), `missing approved term U+${term.map((cp) => cp.toString(16)).join(" U+")}`);
  }

  for (const char of block) {
    const codePoint = char.codePointAt(0)!;
    assert.ok(
      codePoint < 0xe000 || codePoint > 0xf8ff,
      `unexpected private-use codepoint U+${codePoint.toString(16)}`,
    );
  }
  assert.equal(block.includes(String.fromCodePoint(0x20ac)), false);
});
