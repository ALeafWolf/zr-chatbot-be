import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildDurableMemoryWriteTraceOutput } from "./writeInteractiveMemory";

describe("durable memory write trace output", () => {
  it("reports written/deduplicated/below-threshold status", () => {
    assert.deepEqual(buildDurableMemoryWriteTraceOutput("written"), {
      status: "written", written: true, deduplicated: false, skippedBelowThreshold: false,
    }, "written");
    assert.deepEqual(buildDurableMemoryWriteTraceOutput("deduplicated"), {
      status: "deduplicated", written: false, deduplicated: true, skippedBelowThreshold: false,
    }, "deduplicated");
    assert.deepEqual(buildDurableMemoryWriteTraceOutput("below_threshold"), {
      status: "below_threshold", written: false, deduplicated: false, skippedBelowThreshold: true,
    }, "below_threshold");
  });
});
