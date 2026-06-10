import { describe, it } from "node:test";
import assert from "node:assert";
import { PostTurnRunner } from "./postTurnRunner";
import type { PostTurnJobRow } from "../db/schema/jobs";
import { PostTurnGraphStateSchema } from "../orchestration/graphState/postTurnGraphState";
import { StateGraph, START } from "@langchain/langgraph";
import { createPostTurnMemoryGraph } from "../orchestration/graphs/postTurnMemoryGraph";
import { INITIAL_POST_TURN_STEP_STATUS, markStepCompleted } from "./postTurnJobPayload";
import { createAgentEvalCapture, withAgentEvalCapture } from "../eval/evalSnapshots";

class TestPostTurnRunner extends PostTurnRunner {
  public pscCalls: Array<{ jobId: string; step: string }> = [];
  public completeCalls: string[] = [];
  public fJobCalls: Array<{ errMessage: string; intendedStatus: string }> = [];
  public lastInvokeConfig: any = null;
  private _factory: ((deps: any) => any) | null = null;
  public setFactory(f: (deps: any) => any) { this._factory = f; }
  async persistStepComplete(jobId: string, step: string, _p: any, stepStatus: any): Promise<any> { this.pscCalls.push({ jobId, step }); return markStepCompleted(stepStatus, step as any); }
  async completeJob(jobId: string): Promise<void> { this.completeCalls.push(jobId); }
  protected async failJob(job: PostTurnJobRow, err: unknown): Promise<void> { this.fJobCalls.push({ errMessage: err instanceof Error ? err.message : String(err), intendedStatus: job.attempts >= job.maxAttempts ? "failed" : "retry" }); }
  protected createGraph(deps: any): any {
    const rawGraph = this._factory ? this._factory(deps) : new StateGraph(PostTurnGraphStateSchema).addNode("ok", async () => { await deps.completeJobFn("job_001"); deps.recordSnapshotFn({ status: "completed" }); return {}; }).addEdge(START, "ok").compile();
    const runner = this;
    const origInvoke = rawGraph.invoke.bind(rawGraph);
    rawGraph.invoke = async function (input: any, options?: any) { runner.lastInvokeConfig = options ?? null; return origInvoke(input, options); };
    return rawGraph;
  }
  async callRunClaimedJob(job: PostTurnJobRow): Promise<boolean> { return await (this as any).runClaimedJob(job); }
  override async loadAndClaimEvalJob(_jobId: string): Promise<{ job: PostTurnJobRow } | { missing: boolean; completed: boolean }> { return { job: job({ status: "pending", payload: PAYLOAD_WITH_SIG }) as PostTurnJobRow }; }
}

class MissingJobRunner extends TestPostTurnRunner {
  override async loadAndClaimEvalJob(_jobId: string): Promise<{ job: PostTurnJobRow } | { missing: boolean; completed: boolean }> { return { missing: true, completed: false }; }
}

const PAYLOAD: any = { version: 1, sessionId: "s", userMessage: "hi", assistantReply: "ho", session: { sessionId: "s", characterId: "c", playerId: "p", mode: "canonical_live", continuityScope: "main", continuityFamily: "main_world", personaOverlayId: null, memoryNamespace: "ns", pinnedTime: null, pinnedLocation: null, writebackPolicy: "normal", sessionSummary: null, displayTitle: null, thinking: false, temperature: 0.7 }, derivedState: { inferredMood: "n", inferredActivity: "c", conversationalStance: "n" }, shouldWriteMemory: true, userTurnIndex: 1, assistantTurnIndex: 2, userMessageId: "mu", assistantMessageId: "ma", recentMemorySummaries: [], signals: undefined };
const PAYLOAD_WITH_SIG: any = { ...PAYLOAD, signals: { memoryFacts: [], structMemEntries: [], emotionalDelta: null, modelReportedConfidence: { memoryFacts: 0.9, emotionalDelta: 0 } } };
function job(overrides?: Record<string, unknown>): any { return { id: "j1", sessionId: "s", userMessageId: "mu", assistantMessageId: "ma", status: "running", attempts: 1, maxAttempts: 3, runAfter: new Date(), lockedAt: null, lockedBy: null, stepStatus: null, payload: PAYLOAD, lastError: null, createdAt: new Date(), updatedAt: new Date(), ...overrides }; }
function st(step: string): any { return markStepCompleted({ ...INITIAL_POST_TURN_STEP_STATUS }, step as any); }

describe("PostTurnRunner behavior", () => {
  it("handles success, step-skip, errors with retry/failed, eval flow, tags, and missing job", async () => {
    // 1. Success: completeJob called, failJob NOT called
    let r = new TestPostTurnRunner();
    await r.callRunClaimedJob(job());
    assert.strictEqual(r.completeCalls.length, 1, "success — completeJob called");
    assert.strictEqual(r.fJobCalls.length, 0, "success — no failJob");

    // 2. raw_chunk complete → writeRawFn not called
    r = new TestPostTurnRunner();
    let rawCalled = false;
    r.setFactory((deps: any) => createPostTurnMemoryGraph({ ...deps, persistStepComplete: async (_j: any, st: any, _p: any, s: any) => markStepCompleted(s, st), completeJobFn: async () => {}, writeRawFn: async (_i: any) => { rawCalled = true; return {} as any; }, extractFn: async (_i: any) => PAYLOAD_WITH_SIG.signals! }));
    await r.callRunClaimedJob(job({ stepStatus: st("raw_chunk"), payload: PAYLOAD_WITH_SIG }));
    assert.strictEqual(rawCalled, false, "raw_chunk skip — writeRawFn not called");

    // 3. extract_signals complete → extractFn not called
    r = new TestPostTurnRunner();
    let extCalled = false;
    r.setFactory((deps: any) => createPostTurnMemoryGraph({ ...deps, persistStepComplete: async (_j: any, st: any, _p: any, s: any) => markStepCompleted(s, st), completeJobFn: async () => {}, extractFn: async (_i: any) => { extCalled = true; return PAYLOAD_WITH_SIG.signals!; } }));
    await r.callRunClaimedJob(job({ stepStatus: st("extract_signals"), payload: PAYLOAD_WITH_SIG }));
    assert.strictEqual(extCalled, false, "extract skip — extractFn not called");

    // 4. errors + attempts<max → retry
    r = new TestPostTurnRunner();
    r.setFactory(() => new StateGraph(PostTurnGraphStateSchema).addNode("e", async () => ({ errors: [{ stage: "s", message: "fail" }] })).addEdge(START, "e").compile() as any);
    await r.callRunClaimedJob(job({ attempts: 1, maxAttempts: 3 }));
    assert.strictEqual(r.fJobCalls.length, 1, "retry — failJob called");
    assert.strictEqual(r.fJobCalls[0].intendedStatus, "retry", "retry — intendedStatus");
    assert.ok(r.fJobCalls[0].errMessage.includes("Post-turn memory graph failed ["), "retry — errMessage");

    // 5. errors + attempts>=max → failed
    r = new TestPostTurnRunner();
    r.setFactory(() => new StateGraph(PostTurnGraphStateSchema).addNode("e", async () => ({ errors: [{ stage: "s", message: "fail" }] })).addEdge(START, "e").compile() as any);
    await r.callRunClaimedJob(job({ attempts: 5, maxAttempts: 3 }));
    assert.strictEqual(r.fJobCalls.length, 1, "failed — failJob called");
    assert.strictEqual(r.fJobCalls[0].intendedStatus, "failed", "failed — intendedStatus");

    // 6. runJobByIdForEval → loads pending job and completes
    r = new TestPostTurnRunner();
    r.completeCalls = []; r.fJobCalls = [];
    await r.runJobByIdForEval("existing-job");
    assert.strictEqual(r.completeCalls.length, 2, "eval — completeJob called twice");
    assert.strictEqual(r.fJobCalls.length, 0, "eval — no failJob");

    // B5: runClaimedJob passes tags
    r = new TestPostTurnRunner();
    r.completeCalls = []; r.lastInvokeConfig = null;
    await r.callRunClaimedJob(job({ payload: PAYLOAD_WITH_SIG }));
    assert.ok(r.lastInvokeConfig !== null, "tags — invoke config present");
    assert.ok(r.lastInvokeConfig.tags, "tags — config.tags present");
    assert.ok(r.lastInvokeConfig.tags.includes("turn:background"), "tags — turn:background");
    assert.ok(r.lastInvokeConfig.tags.includes("subsystem:post_turn"), "tags — subsystem:post_turn");
    assert.ok(r.lastInvokeConfig.tags.includes("graph:postTurnMemoryGraph"), "tags — graph tag");
    assert.ok(r.lastInvokeConfig.metadata, "tags — metadata present");
    assert.strictEqual(r.lastInvokeConfig.metadata.postTurnJobId, "j1", "tags — postTurnJobId");

    // A. Eval failure propagation
    r = new TestPostTurnRunner();
    r.setFactory(() => new StateGraph(PostTurnGraphStateSchema).addNode("e", async () => ({ errors: [{ stage: "s", message: "graph error" }] })).addEdge(START, "e").compile() as any);
    const capture = createAgentEvalCapture({ scenarioId: "test", evalSessionId: "s" });
    let threw = false;
    await withAgentEvalCapture(capture, async () => { try { await r.runJobByIdForEval("test-job"); } catch { threw = true; } });
    assert.strictEqual(threw, true, "eval fail — throws");
    assert.strictEqual(r.completeCalls.length, 1, "eval fail — completeJob called");
    assert.strictEqual(capture.memoryWrite.status, "failed", "eval fail — capture status");

    // B. Missing job throws
    const r2 = new MissingJobRunner();
    const capture2 = createAgentEvalCapture({ scenarioId: "test", evalSessionId: "s" });
    let threw2 = false;
    await withAgentEvalCapture(capture2, async () => { try { await r2.runJobByIdForEval("nonexistent-job"); } catch { threw2 = true; } });
    assert.strictEqual(threw2, true, "missing job — throws");
    assert.strictEqual(capture2.memoryWrite.status, "failed", "missing job — capture status");
    assert.strictEqual(r2.completeCalls.length, 0, "missing job — no completeJob");
  });
});
