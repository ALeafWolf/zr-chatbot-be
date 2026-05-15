import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  characterTag,
  environmentTag,
  evalTag,
  sanitizeTraceTags,
  subsystemTag,
  turnTag,
} from "./traceTags";

describe("trace tags", () => {
  it("builds the approved tag formats", () => {
    assert.equal(characterTag("zuo_ran"), "character:zuo_ran");
    assert.equal(turnTag("foreground"), "turn:foreground");
    assert.equal(turnTag("background"), "turn:background");
    assert.equal(environmentTag("test"), "env:test");
    assert.equal(subsystemTag("retrieval"), "subsystem:retrieval");
    assert.deepEqual(evalTag(true), ["eval:true"]);
    assert.deepEqual(evalTag(false), []);
  });

  it("strips legacy and unapproved tags", () => {
    assert.deepEqual(
      sanitizeTraceTags([
        "phase1",
        "llm",
        "stream",
        "stage:draft",
        "phase:tier3",
        "dedup",
        "structmem",
        "retrieval",
        "character:zuo_ran",
        "turn:foreground",
        "env:test",
        "subsystem:llm",
        "eval:true",
      ]),
      ["character:zuo_ran", "turn:foreground", "env:test", "subsystem:llm", "eval:true"],
    );
  });
});
