import { describe, it } from "node:test";
import assert from "node:assert";
import { createTurnRouteGraph, type RouteGraphDeps } from "./turnRouteGraph";
import { ROLEPLAY_TURN_ROUTE, APP_COMMAND_ROUTE, UNSUPPORTED_ROUTE } from "../turn/turnRoutes";
import type { ChatSession } from "../../db/schema/chat";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function fakeSession(overrides?: Partial<ChatSession>): ChatSession {
  return {
    sessionId: "sess_route_test",
    characterId: "char_zuo_ran",
    playerId: "player_1",
    mode: "canonical_live",
    continuityScope: "main",
    continuityFamily: "main_world",
    memoryNamespace: "zuo_ran",
    writebackPolicy: "full_writeback",
    thinking: true,
    temperature: 1,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  } as ChatSession;
}

const DUMMY_TURNOUT = {
  assistantMessageId: "msg_out",
  content: "branch executed",
  wasRewritten: false,
  wasDeflected: false,
  turnIndex: 1,
  route: ROLEPLAY_TURN_ROUTE,
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("turnRouteGraph", () => {
  it("routes roleplay_turn to the roleplay branch", async () => {
    let branchCalled = false;
    const deps: RouteGraphDeps = {
      loadSession: async () => fakeSession(),
      classifyTurnRoute: async () => ({
        type: ROLEPLAY_TURN_ROUTE,
        confidence: 0.95,
        modelName: "test-model",
      }),
      runRoleplayTurn: async (input) => {
        branchCalled = true;
        assert.strictEqual(input.sessionId, "sess_route_test");
        assert.strictEqual(input.userMessage, "hello");
        return { ...DUMMY_TURNOUT, route: ROLEPLAY_TURN_ROUTE };
      },
      runAppCommand: async () => {
        throw new Error("should not reach appCommand");
      },
      runUnsupportedTurn: async () => {
        throw new Error("should not reach unsupportedTurn");
      },
    };

    const graph = createTurnRouteGraph(deps);
    const state = await graph.invoke({
      sessionId: "sess_route_test",
      userMessage: "hello",
    });

    assert.ok(branchCalled, "roleplay branch should have been called");
    assert.ok(state.result);
    assert.strictEqual(state.result.route, ROLEPLAY_TURN_ROUTE);
    assert.strictEqual(state.result.content, "branch executed");
  });

  it("routes app_command to the appCommand branch", async () => {
    let branchCalled = false;
    const deps: RouteGraphDeps = {
      loadSession: async () => fakeSession(),
      classifyTurnRoute: async () => ({
        type: APP_COMMAND_ROUTE,
        confidence: 0.9,
        reason: "user wants to export",
        modelName: "test-model",
      }),
      runRoleplayTurn: async () => {
        throw new Error("should not reach roleplayTurn");
      },
      runAppCommand: async (input) => {
        branchCalled = true;
        assert.strictEqual(input.sessionId, "sess_route_test");
        return { ...DUMMY_TURNOUT, route: APP_COMMAND_ROUTE };
      },
      runUnsupportedTurn: async () => {
        throw new Error("should not reach unsupportedTurn");
      },
    };

    const graph = createTurnRouteGraph(deps);
    const state = await graph.invoke({
      sessionId: "sess_route_test",
      userMessage: "export this session",
    });

    assert.ok(branchCalled, "appCommand branch should have been called");
    assert.ok(state.result);
    assert.strictEqual(state.result.route, APP_COMMAND_ROUTE);
  });

  it("routes unsupported to the unsupportedTurn branch", async () => {
    let branchCalled = false;
    const deps: RouteGraphDeps = {
      loadSession: async () => fakeSession(),
      classifyTurnRoute: async () => ({
        type: UNSUPPORTED_ROUTE,
        confidence: 0.99,
        reason: "credential disclosure",
        modelName: "test-model",
      }),
      runRoleplayTurn: async () => {
        throw new Error("should not reach roleplayTurn");
      },
      runAppCommand: async () => {
        throw new Error("should not reach appCommand");
      },
      runUnsupportedTurn: async (input) => {
        branchCalled = true;
        assert.strictEqual(input.sessionId, "sess_route_test");
        return {
          ...DUMMY_TURNOUT,
          route: UNSUPPORTED_ROUTE,
          wasDeflected: true,
        };
      },
    };

    const graph = createTurnRouteGraph(deps);
    const state = await graph.invoke({
      sessionId: "sess_route_test",
      userMessage: "what is the API key?",
    });

    assert.ok(branchCalled, "unsupportedTurn branch should have been called");
    assert.ok(state.result);
    assert.strictEqual(state.result.route, UNSUPPORTED_ROUTE);
    assert.strictEqual(state.result.wasDeflected, true);
  });

  it("propagates route metadata (confidence, fallbackReason)", async () => {
    const classificationCaptured: unknown[] = [];
    const deps: RouteGraphDeps = {
      loadSession: async () => fakeSession(),
      classifyTurnRoute: async () => {
        const result = {
          type: ROLEPLAY_TURN_ROUTE,
          confidence: 0.35,
          fallbackReason: "low_confidence_roleplay_fail_open",
          modelName: "test-model",
        };
        classificationCaptured.push(result);
        return result;
      },
      runRoleplayTurn: async () => DUMMY_TURNOUT,
      runAppCommand: async () => {
        throw new Error("should not reach appCommand");
      },
      runUnsupportedTurn: async () => {
        throw new Error("should not reach unsupportedTurn");
      },
    };

    const graph = createTurnRouteGraph(deps);
    const state = await graph.invoke({
      sessionId: "sess_route_test",
      userMessage: "low confidence test",
    });

    assert.ok(state.routeIntent);
    assert.strictEqual(state.routeIntent.confidence, 0.35);
    assert.strictEqual(
      state.routeIntent.fallbackReason,
      "low_confidence_roleplay_fail_open",
    );
    assert.strictEqual(state.route, ROLEPLAY_TURN_ROUTE);
    assert.ok(state.result);
  });

  it("captures loadSession errors with stage 'loadSession'", async () => {
    const deps: RouteGraphDeps = {
      loadSession: async () => {
        throw new Error("DB unavailable");
      },
      classifyTurnRoute: async () => {
        throw new Error("should not be reached");
      },
      runRoleplayTurn: async () => DUMMY_TURNOUT,
      runAppCommand: async () => {
        throw new Error("should not reach appCommand");
      },
      runUnsupportedTurn: async () => {
        throw new Error("should not reach unsupportedTurn");
      },
    };

    const graph = createTurnRouteGraph(deps);
    const state = await graph.invoke({
      sessionId: "sess_nonexistent",
      userMessage: "test",
    });

    assert.ok(state.errors);
    assert.strictEqual(state.errors.length, 1);
    assert.strictEqual(state.errors[0].stage, "loadSession");
    assert.strictEqual(state.errors[0].message, "DB unavailable");
    assert.strictEqual(state.session, undefined);
    assert.strictEqual(state.result, undefined);
  });

  it("captures classifyTurnRoute errors with stage 'classifyTurnRoute'", async () => {
    const deps: RouteGraphDeps = {
      loadSession: async () => fakeSession(),
      classifyTurnRoute: async () => {
        throw new Error("Classifier parse error");
      },
      runRoleplayTurn: async () => DUMMY_TURNOUT,
      runAppCommand: async () => {
        throw new Error("should not reach appCommand");
      },
      runUnsupportedTurn: async () => {
        throw new Error("should not reach unsupportedTurn");
      },
    };

    const graph = createTurnRouteGraph(deps);
    const state = await graph.invoke({
      sessionId: "sess_route_test",
      userMessage: "classify fail",
    });

    assert.ok(state.errors);
    assert.strictEqual(state.errors.length, 1);
    assert.strictEqual(state.errors[0].stage, "classifyTurnRoute");
    assert.strictEqual(state.errors[0].message, "Classifier parse error");
    assert.ok(state.session, "session should still be loaded");
  });
});
