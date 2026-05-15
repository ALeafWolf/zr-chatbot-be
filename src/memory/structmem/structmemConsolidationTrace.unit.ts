import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildConsolidationBufferTraceOutput } from "./structmemConsolidationRepo";

describe("StructMem consolidation selection trace output", () => {
  it("reports selected buffer and semantic seed counts", () => {
    assert.deepEqual(
      buildConsolidationBufferTraceOutput({
        bufferCount: 3,
        semanticSeedCount: 2,
        turnStart: 4,
        turnEnd: 9,
      }),
      {
        bufferCount: 3,
        semanticSeedCount: 2,
        turnStart: 4,
        turnEnd: 9,
        skippedReason: null,
      },
    );
  });

  it("reports skipped selection reason", () => {
    assert.deepEqual(
      buildConsolidationBufferTraceOutput({
        bufferCount: 0,
        semanticSeedCount: 0,
        turnStart: null,
        turnEnd: null,
        skippedReason: "empty_buffer",
      }),
      {
        bufferCount: 0,
        semanticSeedCount: 0,
        turnStart: null,
        turnEnd: null,
        skippedReason: "empty_buffer",
      },
    );
  });
});
