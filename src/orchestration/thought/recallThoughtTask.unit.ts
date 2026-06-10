import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  createRecallThoughtTask,
  takeReadyRecallThought,
  waitForRecallThought,
} from "./recallThoughtTask";
import type { Thought } from "./thoughtTypes";

function recall(text: string): Thought {
  return { kind: "recall", text, ts: 1 };
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe("recallThoughtTask", () => {
  it("waitForRecallThought times out on slow recall and returns non-timed-out null on failure", async () => {
    // Slow recall, short timeout → times out without emitting
    const slowTask = createRecallThoughtTask(async () => {
      await delay(20);
      return recall("late");
    });
    const slowResult = await waitForRecallThought(slowTask, 1);
    assert.deepEqual(slowResult, { thought: null, timedOut: true }, "slow — timed out");
    assert.equal(slowTask.emitted, false, "slow — not emitted");

    // Failed generation → null, NOT timed out, not emitted
    const originalWarn = console.warn;
    console.warn = () => undefined;
    try {
      const failTask = createRecallThoughtTask(async () => {
        throw new Error("boom");
      });
      const failResult = await waitForRecallThought(failTask, 10);
      assert.deepEqual(failResult, { thought: null, timedOut: false }, "failed — not timed out");
      assert.equal(failTask.emitted, false, "failed — not emitted");
    } finally {
      console.warn = originalWarn;
    }
  });

  it("takeReadyRecallThought emits a ready recall thought exactly once", async () => {
    const task = createRecallThoughtTask(async () => recall("ready"));
    await task.promise;

    assert.deepEqual(takeReadyRecallThought(task), recall("ready"), "first take — thought");
    assert.equal(takeReadyRecallThought(task), null, "second take — null");
  });
});
