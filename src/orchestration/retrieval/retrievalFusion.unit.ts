import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { fuseById } from "./retrievalFusion";

type Item = { id: string; score: number; label: string };

describe("fuseById", () => {
  it("collapses duplicate ids and preserves the best-scored item", () => {
    const result = fuseById<Item>(
      [
        { id: "a", score: 0.4, label: "primary-a" },
        { id: "b", score: 0.7, label: "primary-b" },
      ],
      [
        { id: "a", score: 0.9, label: "secondary-a" },
        { id: "c", score: 0.6, label: "secondary-c" },
      ],
      { getId: (item) => item.id, getScore: (item) => item.score },
    );

    assert.equal(result.length, 3);
    assert.equal(result.find((item) => item.id === "a")?.label, "secondary-a");
  });

  it("orders by reciprocal rank fusion with stable first-seen tie breaks", () => {
    const result = fuseById<Item>(
      [
        { id: "a", score: 0, label: "a" },
        { id: "b", score: 0, label: "b" },
      ],
      [
        { id: "b", score: 0, label: "b2" },
        { id: "a", score: 0, label: "a2" },
      ],
      { getId: (item) => item.id, rrfK: 60 },
    );

    assert.deepEqual(
      result.map((item) => item.id),
      ["a", "b"],
    );
  });

  it("returns primary unchanged when secondary is empty", () => {
    const primary = [{ id: "a", score: 1, label: "a" }];
    assert.equal(
      fuseById(primary, [], { getId: (item) => item.id }),
      primary,
    );
  });
});
