import type { Thought } from "./thoughtTypes";

export const RECALL_THOUGHT_FINAL_WAIT_MS = 150;

export interface RecallThoughtTask {
  promise: Promise<Thought | null>;
  settled: boolean;
  emitted: boolean;
  thought: Thought | null;
}

export function createRecallThoughtTask(
  buildThought: () => Promise<Thought>,
): RecallThoughtTask {
  const task: RecallThoughtTask = {
    promise: Promise.resolve(null),
    settled: false,
    emitted: false,
    thought: null,
  };

  task.promise = (async () => {
    try {
      const thought = await buildThought();
      task.thought = thought;
      return thought;
    } catch (err) {
      console.warn("[recallThought] generation failed:", err);
      task.thought = null;
      return null;
    } finally {
      task.settled = true;
    }
  })();

  return task;
}

export function takeReadyRecallThought(
  task: RecallThoughtTask | undefined,
): Thought | null {
  if (!task || !task.settled || task.emitted || !task.thought) {
    return null;
  }
  task.emitted = true;
  return task.thought;
}

export async function waitForRecallThought(
  task: RecallThoughtTask | undefined,
  timeoutMs = RECALL_THOUGHT_FINAL_WAIT_MS,
): Promise<{ thought: Thought | null; timedOut: boolean }> {
  if (!task) return { thought: null, timedOut: false };

  const ready = takeReadyRecallThought(task);
  if (ready) return { thought: ready, timedOut: false };
  if (task.emitted || task.settled) return { thought: null, timedOut: false };

  const timeout = Symbol("recall-thought-timeout");
  let timeoutId: NodeJS.Timeout | undefined;
  const timeoutPromise = new Promise<typeof timeout>((resolve) => {
    timeoutId = setTimeout(() => resolve(timeout), timeoutMs);
  });

  const result = await Promise.race([task.promise, timeoutPromise]);
  if (timeoutId) clearTimeout(timeoutId);
  if (result === timeout) {
    return { thought: null, timedOut: true };
  }

  return { thought: takeReadyRecallThought(task), timedOut: false };
}
