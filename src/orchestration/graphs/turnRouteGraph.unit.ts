import { describe, it } from "node:test";
import assert from "node:assert";
import { createTurnRouteGraph, type RouteGraphDeps } from "./turnRouteGraph";
import { ROLEPLAY_TURN_ROUTE, APP_COMMAND_ROUTE, UNSUPPORTED_ROUTE } from "../turn/turnRoutes";
import type { ChatSession } from "../../db/schema/chat";

function fakeSession(overrides?: Partial<ChatSession>): ChatSession { return { sessionId: "sess_route_test", characterId: "char_zuo_ran", playerId: "player_1", mode: "canonical_live", continuityScope: "main", continuityFamily: "main_world", memoryNamespace: "zuo_ran", writebackPolicy: "full_writeback", thinking: true, temperature: 1, createdAt: new Date(), updatedAt: new Date(), ...overrides } as ChatSession; }
const DUMMY_TURNOUT = { assistantMessageId: "msg_out", content: "branch executed", wasRewritten: false, wasDeflected: false, turnIndex: 1, route: ROLEPLAY_TURN_ROUTE };
function makeDeps(overrides?: Partial<RouteGraphDeps>): RouteGraphDeps { return { loadSession: async () => fakeSession(), classifyTurnRoute: async () => ({ type: ROLEPLAY_TURN_ROUTE, confidence: 0.95, modelName: "test-model" }), runRoleplayTurn: async () => DUMMY_TURNOUT, runAppCommand: async () => { throw new Error("should not reach"); }, runUnsupportedTurn: async () => { throw new Error("should not reach"); }, ...overrides }; }

describe("turnRouteGraph", () => {
  it("routes to correct branch (roleplay/app_command/unsupported) and propagates metadata", async () => {
    let branch = "";
    const deps = makeDeps({ runRoleplayTurn: async (input) => { branch = "roleplay"; assert.strictEqual(input.sessionId, "sess_route_test"); return DUMMY_TURNOUT; }, runAppCommand: async () => { branch = "app_command"; return { ...DUMMY_TURNOUT, route: APP_COMMAND_ROUTE }; }, runUnsupportedTurn: async () => { branch = "unsupported"; return { ...DUMMY_TURNOUT, route: UNSUPPORTED_ROUTE, wasDeflected: true }; } });

    let state = await createTurnRouteGraph({ ...deps, classifyTurnRoute: async () => ({ type: ROLEPLAY_TURN_ROUTE, confidence: 0.95, modelName: "tm" }) }).invoke({ sessionId: "sess_route_test", userMessage: "hello" });
    assert.equal(branch, "roleplay", "routes roleplay"); assert.equal(state.result!.route, ROLEPLAY_TURN_ROUTE, "roleplay — route");
    assert.strictEqual(state.result!.content, "branch executed", "roleplay — content");

    state = await createTurnRouteGraph({ ...deps, classifyTurnRoute: async () => ({ type: APP_COMMAND_ROUTE, confidence: 0.9, reason: "export", modelName: "tm" }) }).invoke({ sessionId: "sess_route_test", userMessage: "export" });
    assert.equal(branch, "app_command", "routes app_command"); assert.ok(state.result, "app_command — result ok");

    state = await createTurnRouteGraph({ ...deps, classifyTurnRoute: async () => ({ type: UNSUPPORTED_ROUTE, confidence: 0.99, reason: "credential disclosure", modelName: "tm" }) }).invoke({ sessionId: "sess_route_test", userMessage: "API key?" });
    assert.equal(branch, "unsupported", "routes unsupported"); assert.ok(state.result, "unsupported — result ok");
    assert.strictEqual(state.result!.wasDeflected, true, "unsupported — wasDeflected");

    // Metadata propagation
    state = await createTurnRouteGraph({ ...deps, classifyTurnRoute: async () => ({ type: ROLEPLAY_TURN_ROUTE, confidence: 0.35, fallbackReason: "low_confidence_roleplay_fail_open", modelName: "tm" }) }).invoke({ sessionId: "sess_route_test", userMessage: "test" });
    assert.ok(state.routeIntent, "routeIntent present");
    assert.strictEqual(state.routeIntent.confidence, 0.35, "confidence propagated");
    assert.strictEqual(state.routeIntent.fallbackReason, "low_confidence_roleplay_fail_open", "fallbackReason propagated");
  });

  it("captures loadSession and classifyTurnRoute errors with stage names", async () => {
    let state = await createTurnRouteGraph(makeDeps({ loadSession: async () => { throw new Error("DB unavailable"); } })).invoke({ sessionId: "sess_nonexistent", userMessage: "test" });
    assert.ok(state.errors, "loadSession — errors");
    assert.strictEqual(state.errors[0].stage, "loadSession", "loadSession — stage");
    assert.strictEqual(state.errors[0].message, "DB unavailable", "loadSession — message");
    assert.strictEqual(state.session, undefined, "loadSession — session undefined");
    assert.strictEqual(state.result, undefined, "loadSession — no result");

    state = await createTurnRouteGraph(makeDeps({ classifyTurnRoute: async () => { throw new Error("Classifier parse error"); } })).invoke({ sessionId: "sess_route_test", userMessage: "classify fail" });
    assert.ok(state.errors, "classify — errors");
    assert.strictEqual(state.errors[0].stage, "classifyTurnRoute", "classify — stage");
    assert.strictEqual(state.errors[0].message, "Classifier parse error", "classify — message");
    assert.ok(state.session, "classify — session loaded");
  });
});
