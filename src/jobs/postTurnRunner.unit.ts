import { describe, it } from "node:test";
import assert from "node:assert";
import { PostTurnRunner } from "./postTurnRunner";
import type { PostTurnJobRow } from "../db/schema/jobs";
import { PostTurnGraphStateSchema } from "../orchestration/graphState/postTurnGraphState";
import { StateGraph, START } from "@langchain/langgraph";
import { createPostTurnMemoryGraph } from "../orchestration/graphs/postTurnMemoryGraph";
import type { PostTurnMemoryGraphDeps } from "../orchestration/graphs/postTurnMemoryGraph";
import type { PostTurnJobPayloadV1, PostTurnStepName, PostTurnStepStatus } from "./postTurnJobPayload";
import { INITIAL_POST_TURN_STEP_STATUS, markStepCompleted } from "./postTurnJobPayload";
import {
  createAgentEvalCapture,
  withAgentEvalCapture,
} from "../eval/evalSnapshots";

// NOTE: No mock.module is used here because it is globally scoped and would
// break other test suites that need the real db client. Instead, all DB-bound
// methods are overridden in TestPostTurnRunner (persistStepComplete,
// completeJob, failJob) and runJobByIdForEval is overridden to skip the
// Drizzle chain and directly call runClaimedJob.

// ---------------------------------------------------------------------------
// Test subclass that stubs DB-bound methods
// ---------------------------------------------------------------------------

class TestPostTurnRunner extends PostTurnRunner {
  public pscCalls: Array<{ jobId: string; step: string }> = [];
  public completeCalls: string[] = [];
  public fJobCalls: Array<{ errMessage: string; intendedStatus: string }> = [];

  /** Captures the run config passed to the graph's invoke(). */
  public lastInvokeConfig: any = null;

  private _factory: ((deps: PostTurnMemoryGraphDeps) => any) | null = null;

  /** Set a custom graph factory. */
  public setFactory(f: (deps: PostTurnMemoryGraphDeps) => any) {
    this._factory = f;
  }

  async persistStepComplete(
    jobId: string, step: PostTurnStepName, _p: PostTurnJobPayloadV1, stepStatus: PostTurnStepStatus,
  ): Promise<PostTurnStepStatus> {
    this.pscCalls.push({ jobId, step });
    return markStepCompleted(stepStatus, step);
  }

  async completeJob(jobId: string): Promise<void> {
    this.completeCalls.push(jobId);
  }

  protected async failJob(job: PostTurnJobRow, err: unknown): Promise<void> {
    this.fJobCalls.push({
      errMessage: err instanceof Error ? err.message : String(err),
      intendedStatus: job.attempts >= job.maxAttempts ? "failed" : "retry",
    });
  }

  protected createGraph(deps: PostTurnMemoryGraphDeps): any {
    const rawGraph = this._factory ? this._factory(deps) : new StateGraph(PostTurnGraphStateSchema)
      .addNode("ok", async () => {
        await deps.completeJobFn("job_001");
        deps.recordSnapshotFn({ status: "completed" });
        return {};
      })
      .addEdge(START, "ok")
      .compile();

    // Wrap invoke to capture the run config.
    const runner = this;
    const originalInvoke = rawGraph.invoke.bind(rawGraph);
    rawGraph.invoke = async function (input: any, options?: any) {
      runner.lastInvokeConfig = options ?? null;
      return originalInvoke(input, options);
    };
    return rawGraph;
  }

  /** Expose protected runClaimedJob for tests. */
  async callRunClaimedJob(job: PostTurnJobRow): Promise<boolean> {
    return await (this as any).runClaimedJob(job);
  }

  /** Override the eval load/claim seam so runJobByIdForEval doesn't need DB. */
  override async loadAndClaimEvalJob(
    _jobId: string,
  ): Promise<{ job: PostTurnJobRow } | { missing: boolean; completed: boolean }> {
    return {
      job: job({ status: "pending", payload: PAYLOAD_WITH_SIG }) as PostTurnJobRow,
    };
  }
}

// ---------------------------------------------------------------------------
// MissingJobRunner — for Test B (missing job throws)
// ---------------------------------------------------------------------------

class MissingJobRunner extends TestPostTurnRunner {
  override async loadAndClaimEvalJob(
    _jobId: string,
  ): Promise<{ job: PostTurnJobRow } | { missing: boolean; completed: boolean }> {
    return { missing: true, completed: false };
  }
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const PAYLOAD: PostTurnJobPayloadV1 = {
  version: 1, sessionId: "s", userMessage: "hi", assistantReply: "ho",
  session: {
    sessionId: "s", characterId: "c", playerId: "p", mode: "canonical_live",
    continuityScope: "main", continuityFamily: "main_world",
    personaOverlayId: null, memoryNamespace: "ns",
    pinnedTime: null, pinnedLocation: null, writebackPolicy: "normal",
    sessionSummary: null, displayTitle: null, thinking: false, temperature: 0.7,
  },
  derivedState: { inferredMood: "n", inferredActivity: "c", conversationalStance: "n" },
  shouldWriteMemory: true, userTurnIndex: 1, assistantTurnIndex: 2,
  userMessageId: "mu", assistantMessageId: "ma", recentMemorySummaries: [], signals: undefined,
};

const PAYLOAD_WITH_SIG: PostTurnJobPayloadV1 = {
  ...PAYLOAD,
  signals: { memoryFacts: [], structMemEntries: [], emotionalDelta: null, modelReportedConfidence: { memoryFacts: 0.9, emotionalDelta: 0 } },
};

function job(overrides?: Record<string, unknown>): any {
  return {
    id: "j1", sessionId: "s", userMessageId: "mu", assistantMessageId: "ma",
    status: "running", attempts: 1, maxAttempts: 3,
    runAfter: new Date(), lockedAt: null, lockedBy: null,
    stepStatus: null, payload: PAYLOAD, lastError: null,
    createdAt: new Date(), updatedAt: new Date(),
    ...overrides,
  };
}

function st(step: PostTurnStepName): PostTurnStepStatus {
  return markStepCompleted({ ...INITIAL_POST_TURN_STEP_STATUS }, step);
}

// ---------------------------------------------------------------------------
// Tests — 6 required behaviors from tasks.md TG2
// ---------------------------------------------------------------------------

describe("PostTurnRunner behavior (TG2 round 3)", () => {
  // 1. Success path
  it("1. runClaimedJob success: completeJob called, failJob NOT called", async () => {
    const r = new TestPostTurnRunner();
    // Default factory makes success graph that calls deps.completeJobFn,
    // which is bound to the runner's completeJob → completeCalls.
    await r.callRunClaimedJob(job());
    assert.strictEqual(r.completeCalls.length, 1);
    assert.strictEqual(r.fJobCalls.length, 0);
  });

  // 2. raw_chunk complete → writeRawFn not called (REAL graph)
  it("2. raw_chunk complete: REAL graph skips writeRawFn", async () => {
    const r = new TestPostTurnRunner();
    let rawCalled = false;
    r.setFactory((deps) => createPostTurnMemoryGraph({
      ...deps,
      persistStepComplete: async (_j, st, _p, s) => markStepCompleted(s, st),
      completeJobFn: async () => {},
      writeRawFn: async (_i: any) => { rawCalled = true; return {} as any; },
      extractFn: async (_i: any) => PAYLOAD_WITH_SIG.signals!,
    }));
    await r.callRunClaimedJob(job({ stepStatus: st("raw_chunk"), payload: PAYLOAD_WITH_SIG }));
    assert.strictEqual(rawCalled, false);
  });

  // 3. extract_signals complete → extractFn not called (REAL graph)
  it("3. extract_signals complete: REAL graph skips extractFn", async () => {
    const r = new TestPostTurnRunner();
    let extCalled = false;
    r.setFactory((deps) => createPostTurnMemoryGraph({
      ...deps,
      persistStepComplete: async (_j, st, _p, s) => markStepCompleted(s, st),
      completeJobFn: async () => {},
      extractFn: async (_i: any) => { extCalled = true; return PAYLOAD_WITH_SIG.signals!; },
    }));
    await r.callRunClaimedJob(job({ stepStatus: st("extract_signals"), payload: PAYLOAD_WITH_SIG }));
    assert.strictEqual(extCalled, false);
  });

  // 4. errors + attempts<max → failJob intendedStatus "retry"
  it("4. errors + attempts<max: failJob intendedStatus is retry", async () => {
    const r = new TestPostTurnRunner();
    r.setFactory(() => new StateGraph(PostTurnGraphStateSchema)
      .addNode("e", async () => ({ errors: [{ stage: "s", message: "fail" }] }))
      .addEdge(START, "e").compile() as any);
    await r.callRunClaimedJob(job({ attempts: 1, maxAttempts: 3 }));
    assert.strictEqual(r.fJobCalls.length, 1);
    assert.strictEqual(r.fJobCalls[0].intendedStatus, "retry");
    assert.ok(r.fJobCalls[0].errMessage.includes("Post-turn memory graph failed ["));
  });

  // 5. errors + attempts>=max → failJob intendedStatus "failed"
  it("5. errors + attempts>=max: failJob intendedStatus is failed", async () => {
    const r = new TestPostTurnRunner();
    r.setFactory(() => new StateGraph(PostTurnGraphStateSchema)
      .addNode("e", async () => ({ errors: [{ stage: "s", message: "fail" }] }))
      .addEdge(START, "e").compile() as any);
    await r.callRunClaimedJob(job({ attempts: 5, maxAttempts: 3 }));
    assert.strictEqual(r.fJobCalls.length, 1);
    assert.strictEqual(r.fJobCalls[0].intendedStatus, "failed");
  });

  // 6. runJobByIdForEval → flows through graph for pending job
  it("6. runJobByIdForEval: loads pending job via seam and completes through graph", async () => {
    const r = new TestPostTurnRunner();
    r.completeCalls = [];
    r.fJobCalls = [];

    await r.runJobByIdForEval("existing-job");

    // completeJob is called twice: once by the graph's completeJobFn, once by
    // runJobByIdForEval (to force "completed" and prevent FK violations).
    assert.strictEqual(r.completeCalls.length, 2,
      `completeCalls should have 2 entries, got ${JSON.stringify(r.completeCalls)}`);
    assert.strictEqual(r.fJobCalls.length, 0,
      `failJob should NOT have been called, got ${JSON.stringify(r.fJobCalls)}`);
  });

  // ---- B5: graph-run tags ---------------------------------------------------

  it("B5: runClaimedJob passes tags to graph.invoke()", async () => {
    const r = new TestPostTurnRunner();
    r.completeCalls = [];
    r.lastInvokeConfig = null;

    await r.callRunClaimedJob(job({ payload: PAYLOAD_WITH_SIG }));

    assert.ok(r.lastInvokeConfig !== null, "graph.invoke should have been called with config");
    assert.ok(r.lastInvokeConfig.tags, "config should contain tags");
    assert.ok(r.lastInvokeConfig.tags.includes("turn:background"),
      `expected tags to include "turn:background", got ${JSON.stringify(r.lastInvokeConfig.tags)}`);
    assert.ok(r.lastInvokeConfig.tags.includes("subsystem:post_turn"),
      `expected tags to include "subsystem:post_turn", got ${JSON.stringify(r.lastInvokeConfig.tags)}`);
    assert.ok(r.lastInvokeConfig.tags.includes("graph:postTurnMemoryGraph"),
      `expected tags to include "graph:postTurnMemoryGraph", got ${JSON.stringify(r.lastInvokeConfig.tags)}`);
    assert.ok(r.lastInvokeConfig.metadata, "config should contain metadata");
    assert.strictEqual(r.lastInvokeConfig.metadata.postTurnJobId, "j1");
  });

  // ---------------------------------------------------------------------------
  // TG2: Eval failure propagation
  // ---------------------------------------------------------------------------

  // A. Eval failure propagation
  it("A. runJobByIdForEval throws when graph fails", async () => {
    const r = new TestPostTurnRunner();
    r.setFactory(() =>
      new StateGraph(PostTurnGraphStateSchema)
        .addNode("e", async () => ({ errors: [{ stage: "s", message: "graph error" }] }))
        .addEdge(START, "e")
        .compile() as any,
    );

    const capture = createAgentEvalCapture({ scenarioId: "test", evalSessionId: "s" });
    let threw = false;
    await withAgentEvalCapture(capture, async () => {
      try {
        await r.runJobByIdForEval("test-job");
      } catch {
        threw = true;
      }
    });

    assert.strictEqual(threw, true, "runJobByIdForEval should throw when graph fails");
    assert.strictEqual(r.completeCalls.length, 1,
      "completeJob should still be called to prevent FK violation");
    assert.strictEqual(capture.memoryWrite.status, "failed",
      "capture status should be failed");
  });

  // B. Missing job throws
  it("B. runJobByIdForEval throws when job is missing", async () => {
    const r = new MissingJobRunner();
    const capture = createAgentEvalCapture({ scenarioId: "test", evalSessionId: "s" });
    let threw = false;
    await withAgentEvalCapture(capture, async () => {
      try {
        await r.runJobByIdForEval("nonexistent-job");
      } catch {
        threw = true;
      }
    });

    assert.strictEqual(threw, true, "should throw when job is missing");
    assert.strictEqual(capture.memoryWrite.status, "failed");
    assert.strictEqual(r.completeCalls.length, 0,
      "completeJob should NOT be called for a missing job");
  });
});
