import { describe, it } from "node:test";
import assert from "node:assert";
import { StateGraph, START } from "@langchain/langgraph";
import { StructMemConsolidationGraphStateSchema } from "../orchestration/graphState/structMemConsolidationGraphState";
import { structmemConsolidationRunner } from "./structmemConsolidationRunner";
import type { StructMemConsolidationJob } from "../db/schema/structmem";
import { env } from "../config/env";

class TestRunner extends (Object.getPrototypeOf(structmemConsolidationRunner).constructor as new () => InstanceType<any>) {
  public failCalls: Array<{ errMessage: string }> = [];
  private _jobs: StructMemConsolidationJob[] = [];
  private _graph: any = null;
  setFakeGraph(g: any) { this._graph = g; }
  setJobs(jobs: StructMemConsolidationJob[]) { this._jobs = [...jobs]; }
  protected async claimJob(): Promise<StructMemConsolidationJob | null> { return this._jobs.shift() ?? null; }
  protected createGraph(): any {
    if (this._graph) return this._graph;
    return new StateGraph(StructMemConsolidationGraphStateSchema).addNode("ok", async () => ({})).addEdge(START, "ok").compile();
  }
  protected async onJobFailed(_job: any, err: unknown): Promise<void> { this.failCalls.push({ errMessage: err instanceof Error ? err.message : String(err) }); }
  async testRunLoop(): Promise<void> { await (this as any).runLoop(); }
}

const FAKE_JOB: StructMemConsolidationJob = { id: "job_001", sessionId: "sess_001", characterId: "char_001", playerId: "player_001", memoryNamespace: "ns", status: "running", turnStart: 1, turnEnd: 10, attemptCount: 1, maxAttempts: 3, lastAttemptedAt: null, lockedAt: new Date(), lockedBy: "worker", errorMessage: null, createdAt: new Date(), completedAt: null };

describe("structMemConsolidationRunner", () => {
  it("invokes graph with jobId, handles success/error, config tags, and env flag off", async () => {
    // Invoke with jobId, no failures
    let r = new TestRunner();
    let invokedJobId: string | null = null;
    r.setFakeGraph(new StateGraph(StructMemConsolidationGraphStateSchema).addNode("capture", async (state: any) => { invokedJobId = state.jobId; return {}; }).addEdge(START, "capture").compile());
    r.setJobs([FAKE_JOB]);
    await r.testRunLoop();
    assert.strictEqual(invokedJobId, "job_001", "invoke — jobId");
    assert.strictEqual(r.failCalls.length, 0, "invoke — no failures");

    // Graph success → no failure call
    r = new TestRunner();
    r.setJobs([FAKE_JOB]);
    await r.testRunLoop();
    assert.strictEqual(r.failCalls.length, 0, "success — no failCalls");

    // Graph error → failure path called
    r = new TestRunner();
    r.setFakeGraph(new StateGraph(StructMemConsolidationGraphStateSchema).addNode("err", async () => ({ errors: [{ stage: "testStage", message: "test error" }] })).addEdge(START, "err").compile());
    r.setJobs([FAKE_JOB]);
    await r.testRunLoop();
    assert.strictEqual(r.failCalls.length, 1, "error — failCalls");
    assert.ok(r.failCalls[0].errMessage.includes("StructMem consolidation graph failed [testStage]"), "error — message");

    // Config tags
    r = new TestRunner();
    let capturedConfig: any = null;
    const graph = new StateGraph(StructMemConsolidationGraphStateSchema).addNode("ok", async () => ({})).addEdge(START, "ok").compile();
    const origInvoke = graph.invoke.bind(graph);
    (graph as any).invoke = async (input: any, config?: any) => { capturedConfig = config; return origInvoke(input, config); };
    r.setFakeGraph(graph);
    r.setJobs([FAKE_JOB]);
    await r.testRunLoop();
    assert.ok(capturedConfig, "config — present");
    assert.ok(capturedConfig.tags.includes("turn:background"), "config — turn:background");
    assert.ok(capturedConfig.tags.includes("subsystem:structmem"), "config — subsystem:structmem");
    assert.ok(capturedConfig.tags.includes("graph:structMemConsolidationGraph"), "config — graph tag");
    assert.strictEqual(capturedConfig.metadata.structmemConsolidationJobId, "job_001", "meta — jobId");
    assert.strictEqual(capturedConfig.metadata.sessionId, "sess_001", "meta — sessionId");
    assert.strictEqual(capturedConfig.metadata.characterId, "char_001", "meta — characterId");
    assert.strictEqual(capturedConfig.metadata.memoryNamespace, "ns", "meta — namespace");
    assert.strictEqual(capturedConfig.metadata.turnStart, 1, "meta — turnStart");
    assert.strictEqual(capturedConfig.metadata.turnEnd, 10, "meta — turnEnd");
    assert.strictEqual(capturedConfig.metadata.attemptCount, 1, "meta — attemptCount");
    assert.strictEqual(capturedConfig.metadata.maxAttempts, 3, "meta — maxAttempts");

    // env flag off → returns null
    const origEnabled = env.STRUCTMEM_ENABLED;
    (env as any).STRUCTMEM_ENABLED = false;
    const { claimStructMemConsolidationJob } = await import("./structmemConsolidationRunner");
    let result = await claimStructMemConsolidationJob("test-worker");
    (env as any).STRUCTMEM_ENABLED = origEnabled;
    assert.strictEqual(result, null, "disabled — null when STRUCTMEM_ENABLED false");

    const origConsol = env.STRUCTMEM_CONSOLIDATION_ENABLED;
    (env as any).STRUCTMEM_CONSOLIDATION_ENABLED = false;
    result = await claimStructMemConsolidationJob("test-worker");
    (env as any).STRUCTMEM_CONSOLIDATION_ENABLED = origConsol;
    assert.strictEqual(result, null, "disabled — null when CONSOLDATION_ENABLED false");
  });
});
