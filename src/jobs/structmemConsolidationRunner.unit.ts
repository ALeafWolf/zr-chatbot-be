import { describe, it } from "node:test";
import assert from "node:assert";
import { StateGraph, START } from "@langchain/langgraph";
import { StructMemConsolidationGraphStateSchema } from "../orchestration/graphState/structMemConsolidationGraphState";
import { structmemConsolidationRunner } from "./structmemConsolidationRunner";
import type { StructMemConsolidationJob } from "../db/schema/structmem";
import { env } from "../config/env";

// ---------------------------------------------------------------------------
// Test subclass that stubs all DB-bound production seams
// ---------------------------------------------------------------------------

class TestRunner extends (Object.getPrototypeOf(structmemConsolidationRunner).constructor as new () => InstanceType<any>) {
  public failCalls: Array<{ errMessage: string }> = [];
  public lastGraph: any = null;
  public lastInvokeInput: any = null;
  public lastInvokeConfig: any = null;

  private _jobs: StructMemConsolidationJob[] = [];
  private _graph: any = null;

  /** Set the fake graph. */
  setFakeGraph(g: any) { this._graph = g; }

  /** Set the sequence of jobs claimJob() returns. */
  setJobs(jobs: StructMemConsolidationJob[]) { this._jobs = [...jobs]; }

  protected async claimJob(): Promise<StructMemConsolidationJob | null> {
    return this._jobs.shift() ?? null;
  }

  protected createGraph(): any {
    if (this._graph) return this._graph;
    // Default: success graph
    return new StateGraph(StructMemConsolidationGraphStateSchema)
      .addNode("ok", async () => ({}))
      .addEdge(START, "ok")
      .compile();
  }

  protected async onJobFailed(_job: any, err: unknown): Promise<void> {
    this.failCalls.push({
      errMessage: err instanceof Error ? err.message : String(err),
    });
  }

  /** Expose runLoop for tests. */
  async testRunLoop(): Promise<void> {
    await (this as any).runLoop();
  }
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const FAKE_JOB: StructMemConsolidationJob = {
  id: "job_001",
  sessionId: "sess_001",
  characterId: "char_001",
  playerId: "player_001",
  memoryNamespace: "ns",
  status: "running",
  turnStart: 1, turnEnd: 10,
  attemptCount: 1, maxAttempts: 3,
  lastAttemptedAt: null,
  lockedAt: new Date(),
  lockedBy: "worker",
  errorMessage: null,
  createdAt: new Date(),
  completedAt: null,
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("structMemConsolidationRunner - TG2 fix round 2", () => {
  it("claimed job invokes the graph with the claimed job id", async () => {
    const r = new TestRunner();
    let invokedJobId: string | null = null;
    r.setFakeGraph(new StateGraph(StructMemConsolidationGraphStateSchema)
      .addNode("capture", async (state: any) => {
        invokedJobId = state.jobId;
        return {};
      })
      .addEdge(START, "capture")
      .compile());
    r.setJobs([FAKE_JOB]);

    await r.testRunLoop();

    assert.strictEqual(invokedJobId, "job_001");
    assert.strictEqual(r.failCalls.length, 0);
  });

  it("graph success does not call the failure path", async () => {
    const r = new TestRunner();
    r.setJobs([FAKE_JOB]);

    await r.testRunLoop();

    assert.strictEqual(r.failCalls.length, 0);
  });

  it("graph error calls the failure path", async () => {
    const r = new TestRunner();
    r.setFakeGraph(new StateGraph(StructMemConsolidationGraphStateSchema)
      .addNode("err", async () => ({ errors: [{ stage: "testStage", message: "test error" }] }))
      .addEdge(START, "err")
      .compile());
    r.setJobs([FAKE_JOB]);

    await r.testRunLoop();

    assert.strictEqual(r.failCalls.length, 1);
    assert.ok(r.failCalls[0].errMessage.includes("StructMem consolidation graph failed [testStage]"));
  });

  it("graph invoke config includes all required tags and metadata", async () => {
    const r = new TestRunner();
    let capturedConfig: any = null;
    const graph = new StateGraph(StructMemConsolidationGraphStateSchema)
      .addNode("ok", async () => ({}))
      .addEdge(START, "ok")
      .compile();
    const origInvoke = graph.invoke.bind(graph);
    (graph as any).invoke = async (input: any, config?: any) => {
      capturedConfig = config;
      return origInvoke(input, config);
    };
    r.setFakeGraph(graph);
    r.setJobs([FAKE_JOB]);

    await r.testRunLoop();

    assert.ok(capturedConfig, "graph should be invoked with config");
    // Tags
    assert.ok(capturedConfig.tags.includes("turn:background"), "missing turn:background");
    assert.ok(capturedConfig.tags.includes("subsystem:structmem"), "missing subsystem:structmem");
    assert.ok(capturedConfig.tags.includes("graph:structMemConsolidationGraph"), "missing graph:structMemConsolidationGraph");
    // Metadata
    assert.strictEqual(capturedConfig.metadata.structmemConsolidationJobId, "job_001");
    assert.strictEqual(capturedConfig.metadata.sessionId, "sess_001");
    assert.strictEqual(capturedConfig.metadata.characterId, "char_001");
    assert.strictEqual(capturedConfig.metadata.memoryNamespace, "ns");
    assert.strictEqual(capturedConfig.metadata.turnStart, 1);
    assert.strictEqual(capturedConfig.metadata.turnEnd, 10);
    assert.strictEqual(capturedConfig.metadata.attemptCount, 1);
    assert.strictEqual(capturedConfig.metadata.maxAttempts, 3);
  });

  it("claimStructMemConsolidationJob returns null when STRUCTMEM_ENABLED is false", async () => {
    const orig = env.STRUCTMEM_ENABLED;
    (env as any).STRUCTMEM_ENABLED = false;

    // claimStructMemConsolidationJob is the standalone function (not the runner method).
    // It checks env.STRUCTMEM_ENABLED && env.STRUCTMEM_CONSOLIDATION_ENABLED first.
    const { claimStructMemConsolidationJob } = await import("./structmemConsolidationRunner");
    // It won't connect to DB because the function returns null early when flags are off.
    const result = await claimStructMemConsolidationJob("test-worker");

    (env as any).STRUCTMEM_ENABLED = orig;

    assert.strictEqual(result, null, "should return null when STRUCTMEM_ENABLED is false");
  });

  it("claimStructMemConsolidationJob returns null when STRUCTMEM_CONSOLIDATION_ENABLED is false", async () => {
    const orig = env.STRUCTMEM_CONSOLIDATION_ENABLED;
    (env as any).STRUCTMEM_CONSOLIDATION_ENABLED = false;

    const { claimStructMemConsolidationJob } = await import("./structmemConsolidationRunner");
    const result = await claimStructMemConsolidationJob("test-worker");

    (env as any).STRUCTMEM_CONSOLIDATION_ENABLED = orig;

    assert.strictEqual(result, null, "should return null when STRUCTMEM_CONSOLIDATION_ENABLED is false");
  });
});
