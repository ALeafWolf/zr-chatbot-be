import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { characterTag, environmentTag, evalTag, sanitizeTraceTags, subsystemTag, turnTag } from "./traceTags";

describe("trace tags", () => {
  it("builds the approved tag formats", () => {
    const cases = [
      { name: "character", fn: () => characterTag("zuo_ran"), expected: "character:zuo_ran" },
      { name: "turn foreground", fn: () => turnTag("foreground"), expected: "turn:foreground" },
      { name: "turn background", fn: () => turnTag("background"), expected: "turn:background" },
      { name: "environment", fn: () => environmentTag("test"), expected: "env:test" },
      { name: "subsystem", fn: () => subsystemTag("retrieval"), expected: "subsystem:retrieval" },
      { name: "eval true", fn: () => evalTag(true), expected: ["eval:true"] },
      { name: "eval false", fn: () => evalTag(false), expected: [] },
    ];
    for (const c of cases) {
      assert.deepEqual(c.fn(), c.expected, c.name);
    }
  });

  it("strips legacy and unapproved tags", () => {
    assert.deepEqual(
      sanitizeTraceTags(["phase1", "llm", "stream", "stage:draft", "phase:tier3", "dedup", "structmem", "retrieval", "character:zuo_ran", "turn:foreground", "env:test", "subsystem:llm", "eval:true"]),
      ["character:zuo_ran", "turn:foreground", "env:test", "subsystem:llm", "eval:true"],
    );
  });
});
