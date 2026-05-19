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
  it("does not block when the recall thought is not ready", async () => {
    const task = createRecallThoughtTask(async () => {
      await delay(20);
      return recall("late");
    });

    const result = await waitForRecallThought(task, 1);

    assert.deepEqual(result, { thought: null, timedOut: true });
    assert.equal(task.emitted, false);
  });

  it("emits a ready recall thought once", async () => {
    const task = createRecallThoughtTask(async () => recall("ready"));

    await task.promise;

    assert.deepEqual(takeReadyRecallThought(task), recall("ready"));
    assert.equal(takeReadyRecallThought(task), null);
  });

  it("returns null for failed recall generation", async () => {
    const originalWarn = console.warn;
    console.warn = () => undefined;
    try {
      const task = createRecallThoughtTask(async () => {
        throw new Error("boom");
      });

      const result = await waitForRecallThought(task, 10);

      assert.deepEqual(result, { thought: null, timedOut: false });
      assert.equal(task.emitted, false);
    } finally {
      console.warn = originalWarn;
    }
  });
});
