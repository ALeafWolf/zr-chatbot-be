import assert from "node:assert/strict";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { describe, it } from "node:test";
import { buildSeedAxisState, loadOocReplayScenario } from "./loadOocReplayScenario";
import {
  parsePersistedAxisState,
  mergeAxisStateIntoDelta,
} from "../../state/emotionalEngine/axisStatePersistence";

describe("TG0.7b-fix — buildSeedAxisState round-trip", () => {
  // The ACTUAL reduced shape from the transcript (turn 259's emotional_axis):
  // { version, tick, scope, axes, bands } — NO history/lastTrace/couplingsFired.
  const transcriptAxis: Record<string, unknown> = {
    version: 1,
    source: "post_turn_engine",
    tick: 259,
    scope: "main_married",
    axes: {
      connection: 0.42,
      valence: 0.08,
      arousal: 0.35,
      restraint: 0.28,
    },
    bands: {
      connection: "mid",
      valence: "mid",
      arousal: "mid",
      restraint: "low",
    },
  };

  it("builds a valid PersistedAxisState from the reduced transcript shape", () => {
    const seed = buildSeedAxisState(transcriptAxis);
    assert.ok(seed !== undefined, "seed should be defined");
    assert.equal(seed.version, 1);
    assert.equal(seed.tick, 259);
    assert.deepEqual(seed.axes, transcriptAxis.axes);
    assert.deepEqual(seed.history, [], "empty history");
    assert.ok(Array.isArray(seed.lastTrace.couplingsFired), "couplingsFired is array");
    assert.equal(seed.lastTrace.tick, 259);
    assert.deepEqual(seed.lastTrace.axesBefore, transcriptAxis.axes);
    assert.deepEqual(seed.lastTrace.axesAfter, transcriptAxis.axes);
  });

  it("round-trips through parsePersistedAxisState without null", () => {
    const seed = buildSeedAxisState(transcriptAxis);
    assert.ok(seed !== undefined);
    const parsed = parsePersistedAxisState(seed as any);
    assert.ok(parsed !== null, "parsePersistedAxisState must return non-null");
  });

  it("round-trips through mergeAxisStateIntoDelta without throwing", () => {
    const seed = buildSeedAxisState(transcriptAxis);
    assert.ok(seed !== undefined);
    assert.doesNotThrow(() => {
      mergeAxisStateIntoDelta({}, seed!);
    }, "mergeAxisStateIntoDelta must not throw");
  });

  it("returns undefined for missing / invalid input", () => {
    assert.equal(buildSeedAxisState(undefined), undefined);
    assert.equal(buildSeedAxisState({}), undefined);
    assert.equal(buildSeedAxisState({ version: "wrong" }), undefined);
    assert.equal(buildSeedAxisState({ version: 1 }), undefined); // no tick
    assert.equal(
      buildSeedAxisState({ version: 1, tick: 1, axes: { foo: 1 } }),
      undefined,
    );
  });
});

describe("TG0.7c — loadOocReplayScenario memory export seeding", () => {
  it("loads the sibling memory export when it exists", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "ooc-scenario-"));
    const transcriptPath = path.join(tmpDir, "sample-transcript.json");
    const memoryPath = path.join(tmpDir, "sample-memory.json");

    fs.writeFileSync(
      transcriptPath,
      JSON.stringify(
        {
          session_id: "test-session",
          title: "test transcript",
          message_count: 3,
          messages: [
            {
              id: "m1",
              role: "user",
              route: "chat",
              turn_type: "user",
              turn_index: 0,
              created_at: "2026-07-09T00:00:00.000Z",
              content: "seed one",
            },
            {
              id: "m2",
              role: "assistant",
              route: "chat",
              turn_type: "assistant",
              turn_index: 1,
              created_at: "2026-07-09T00:00:01.000Z",
              content: "seed two",
            },
            {
              id: "m3",
              role: "user",
              route: "chat",
              turn_type: "user",
              turn_index: 259,
              created_at: "2026-07-09T00:00:02.000Z",
              content: "replay turn",
            },
          ],
        },
        null,
        2,
      ),
      "utf-8",
    );

    fs.writeFileSync(
      memoryPath,
      JSON.stringify(
        {
          sessionSummary: "known summary",
          durableMemories: [
            {
              memoryType: "durable",
              summary: "memory one",
              importanceScore: 0.9,
              emotionScore: 0.1,
              tags: ["a", "b"],
              memoryNamespace: "session",
            },
          ],
          structMemEntries: [
            {
              turnIndex: 2,
              entryType: "fact",
              text: "struct one",
              importanceScore: 0.8,
              confidenceScore: 0.7,
            },
          ],
          sessionChunks: [
            {
              turnStart: 1,
              turnEnd: 2,
              chunkType: "raw_turn_pair",
              chunkText: "chunk one",
            },
          ],
        },
        null,
        2,
      ),
      "utf-8",
    );

    const scenario = loadOocReplayScenario(transcriptPath);

    assert.equal(scenario.sessionSummary, "known summary");
    assert.deepEqual(scenario.durableMemories, [
      {
        memoryType: "durable",
        summary: "memory one",
        importanceScore: 0.9,
        emotionScore: 0.1,
        tags: ["a", "b"],
        memoryNamespace: "session",
      },
    ]);
    assert.deepEqual(scenario.structMemEntries, [
      {
        turnIndex: 2,
        entryType: "fact",
        text: "struct one",
        importanceScore: 0.8,
        confidenceScore: 0.7,
      },
    ]);
    assert.deepEqual(scenario.sessionChunks, [
      {
        turnStart: 1,
        turnEnd: 2,
        chunkType: "raw_turn_pair",
        chunkText: "chunk one",
      },
    ]);
  });

  it("leaves memory fields undefined when the sibling export is absent", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "ooc-scenario-"));
    const transcriptPath = path.join(
      tmpDir,
      "session-2dc74568-transcript.json",
    );

    fs.writeFileSync(
      transcriptPath,
      JSON.stringify(
        {
          session_id: "test-session",
          title: "test transcript",
          message_count: 3,
          messages: [
            {
              id: "m1",
              role: "user",
              route: "chat",
              turn_type: "user",
              turn_index: 0,
              created_at: "2026-07-09T00:00:00.000Z",
              content: "seed one",
            },
            {
              id: "m2",
              role: "assistant",
              route: "chat",
              turn_type: "assistant",
              turn_index: 1,
              created_at: "2026-07-09T00:00:01.000Z",
              content: "seed two",
            },
            {
              id: "m3",
              role: "user",
              route: "chat",
              turn_type: "user",
              turn_index: 259,
              created_at: "2026-07-09T00:00:02.000Z",
              content: "replay turn",
            },
          ],
        },
        null,
        2,
      ),
      "utf-8",
    );

    const scenario = loadOocReplayScenario(transcriptPath);

    assert.equal(scenario.sessionSummary, undefined);
    assert.equal(scenario.durableMemories, undefined);
    assert.equal(scenario.structMemEntries, undefined);
    assert.equal(scenario.sessionChunks, undefined);
  });
});
