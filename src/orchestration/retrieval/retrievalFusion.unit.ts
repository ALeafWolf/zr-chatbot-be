import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { fuseById } from "./retrievalFusion";

type Item = { id: string; score: number; label: string };

describe("fuseById", () => {
  it("collapses duplicates preserving best score, orders by RRF, returns primary unchanged when secondary empty", () => {
    // Collapses duplicates, preserves best score
    const result = fuseById<Item>(
      [{ id: "a", score: 0.4, label: "primary-a" }, { id: "b", score: 0.7, label: "primary-b" }],
      [{ id: "a", score: 0.9, label: "secondary-a" }, { id: "c", score: 0.6, label: "secondary-c" }],
      { getId: (item) => item.id, getScore: (item) => item.score },
    );
    assert.equal(result.length, 3, "collapsed — length");
    assert.equal(result.find((item) => item.id === "a")?.label, "secondary-a", "collapsed — best label");

    // Orders by RRF with stable first-seen ties
    const rrfResult = fuseById<Item>(
      [{ id: "a", score: 0, label: "a" }, { id: "b", score: 0, label: "b" }],
      [{ id: "b", score: 0, label: "b2" }, { id: "a", score: 0, label: "a2" }],
      { getId: (item) => item.id, rrfK: 60 },
    );
    assert.deepEqual(rrfResult.map((item) => item.id), ["a", "b"], "RRF — order");

    // Returns primary unchanged (same reference) when secondary empty
    const primary: Item[] = [{ id: "a", score: 1, label: "a" }];
    const identityResult = fuseById(primary, [], { getId: (item) => item.id });
    assert.equal(identityResult, primary, "identity — same reference");
  });
});
