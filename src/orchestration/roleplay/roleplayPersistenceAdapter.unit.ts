import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  persistRoleplayTurn,
  type PersistRoleplayTurnInput,
  type PersistRoleplayTurnOutput,
} from "./roleplayPersistenceAdapter";
import type { ChatSession } from "../../db/schema/chat";
import type {
  GenerateAndValidateResult,
} from "../generation/generateAndValidate";
import type { ModelBinding } from "../../config/models";
import type { PersistCompletedTurnResult } from "../persistence/turnPersistence";

// ---------------------------------------------------------------------------
// Fakes
// ---------------------------------------------------------------------------

function fakeSession(): ChatSession {
  return {
    sessionId: "s-001",
    characterId: "zuo_ran",
    playerId: "p-001",
    mode: "canonical_live",
    continuityScope: "main",
    continuityFamily: "main_world",
    personaOverlayId: null,
    memoryNamespace: "main",
    pinnedTime: null,
    pinnedLocation: null,
    writebackPolicy: "full_writeback",
    sessionSummary: null,
    displayTitle: null,
    thinking: true,
    temperature: 1,
    deletedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

function fakeGenerationResult(
  overrides?: Partial<GenerateAndValidateResult>,
): GenerateAndValidateResult {
  return {
    content: "Test reply.",
    validatorResult: {
      in_character: true,
      canon_consistent: true,
      session_state_consistent: true,
      nsfw_within_bounds: true,
      issues: [],
      needs_rewrite: false,
    },
    wasRewritten: false,
    wasDeflected: false,
    inputTokens: 100,
    outputTokens: 50,
    ...overrides,
  } as GenerateAndValidateResult;
}

const fakeModelBinding: ModelBinding = {
  provider: "deepseek",
  model: "deepseek-chat",
};

function fakeInput(
  overrides?: Partial<PersistRoleplayTurnInput>,
): PersistRoleplayTurnInput {
  return {
    session: fakeSession(),
    userMessage: "hello",
    generationResult: fakeGenerationResult(),
    derivedState: {
      inferredMood: "calm",
      inferredActivity: "conversing",
      conversationalStance: "neutral",
    },
    memories: [],
    thoughts: [],
    generationModelBinding: fakeModelBinding,
    finalRecallTimedOut: false,
    ...overrides,
  };
}

const fakePersistResult: PersistCompletedTurnResult = {
  userMessageId: "um-001",
  assistantMessageId: "am-001",
  assistantTurnIndex: 5,
  jobId: null,
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("persistRoleplayTurn", () => {
  it("selects the roleplay persisted route when generation was not deflected", async () => {
    const input = fakeInput({
      generationResult: fakeGenerationResult({ wasDeflected: false }),
    });

    const output = await persistRoleplayTurn(input, {
      persistCompletedTurn: async () => fakePersistResult,
      wakePostTurnRunner: () => {},
    });

    assert.equal(output.persistedRoute, "roleplay_turn");
  });

  it("selects the unsupported persisted route when generation was deflected", async () => {
    const input = fakeInput({
      generationResult: fakeGenerationResult({ wasDeflected: true }),
    });

    const output = await persistRoleplayTurn(input, {
      persistCompletedTurn: async () => fakePersistResult,
      wakePostTurnRunner: () => {},
    });

    assert.equal(output.persistedRoute, "unsupported");
  });

  it("calls traceRouteSwitch with classifiedRoute and persistedRoute", async () => {
    let capturedInput: { classifiedRoute: string; persistedRoute?: string } | undefined;
    const fakeRouteSwitch = async (input: { classifiedRoute: string; persistedRoute?: string }) => {
      capturedInput = input;
    };

    await persistRoleplayTurn(
      fakeInput({ generationResult: fakeGenerationResult({ wasDeflected: false }) }),
      {
        traceRouteSwitch: fakeRouteSwitch as any,
        persistCompletedTurn: async () => fakePersistResult,
        wakePostTurnRunner: () => {},
      },
    );

    assert.ok(capturedInput);
    assert.equal(capturedInput!.classifiedRoute, "roleplay_turn");
    assert.equal(capturedInput!.persistedRoute, "roleplay_turn");
  });

  it("passes correct input to persistCompletedTurn", async () => {
    const session = fakeSession();
    const result = fakeGenerationResult({
      content: "Custom reply.",
      validatorResult: {
        in_character: false,
        canon_consistent: true,
        session_state_consistent: true,
        nsfw_within_bounds: true,
        issues: ["not in character"],
        needs_rewrite: true,
      },
    });
    let capturedInput: Record<string, unknown> | undefined;
    const fakePersist = async (input: Record<string, unknown>) => {
      capturedInput = input;
      return fakePersistResult;
    };

    await persistRoleplayTurn(
      fakeInput({
        session,
        generationResult: result,
        derivedState: { inferredMood: "happy", inferredActivity: "thinking", conversationalStance: "warm" },
        memories: [],
        thoughts: [{ kind: "drafting", text: "thought", ts: 1 }],
      }),
      {
        persistCompletedTurn: fakePersist as any,
        wakePostTurnRunner: () => {},
      },
    );

    assert.ok(capturedInput);
    assert.equal(capturedInput!.session, session);
    assert.equal(capturedInput!.userMessage, "hello");
    assert.equal(capturedInput!.assistantReply, "Custom reply.");
    assert.deepEqual(capturedInput!.validatorResult, {
      in_character: false,
      canon_consistent: true,
      session_state_consistent: true,
      nsfw_within_bounds: true,
      issues: ["not in character"],
      needs_rewrite: true,
    });
    assert.equal(capturedInput!.route, "roleplay_turn");
    assert.equal((capturedInput!.usage as Record<string, unknown>).inputTokens, 100);
    assert.equal((capturedInput!.usage as Record<string, unknown>).outputTokens, 50);
  });

  it("calls persistLateRecallThought when finalRecallTimedOut is true", async () => {
    let calledWith: string | undefined;
    const lateCallback = (id: string) => {
      calledWith = id;
    };

    await persistRoleplayTurn(
      fakeInput({
        finalRecallTimedOut: true,
        persistLateRecallThought: lateCallback,
      }),
      {
        persistCompletedTurn: async () => fakePersistResult,
        wakePostTurnRunner: () => {},
      },
    );

    assert.equal(calledWith, "am-001");
  });

  it("does not call persistLateRecallThought when finalRecallTimedOut is false", async () => {
    let called = false;

    await persistRoleplayTurn(
      fakeInput({
        finalRecallTimedOut: false,
        persistLateRecallThought: () => {
          called = true;
        },
      }),
      {
        persistCompletedTurn: async () => fakePersistResult,
        wakePostTurnRunner: () => {},
      },
    );

    assert.equal(called, false);
  });

  it("calls wakePostTurnRunner when persistence returns a jobId", async () => {
    let woken = false;

    await persistRoleplayTurn(
      fakeInput(),
      {
        persistCompletedTurn: async () => ({
          ...fakePersistResult,
          jobId: "job-001",
        }),
        wakePostTurnRunner: () => {
          woken = true;
        },
      },
    );

    assert.equal(woken, true);
  });

  it("does not call wakePostTurnRunner when jobId is null", async () => {
    let woken = false;

    await persistRoleplayTurn(
      fakeInput(),
      {
        persistCompletedTurn: async () => fakePersistResult,
        wakePostTurnRunner: () => {
          woken = true;
        },
      },
    );

    assert.equal(woken, false);
  });

  it("returns persistedRoute and persisted result", async () => {
    const output = await persistRoleplayTurn(
      fakeInput({
        generationResult: fakeGenerationResult({ wasDeflected: false }),
      }),
      {
        persistCompletedTurn: async () => fakePersistResult,
        wakePostTurnRunner: () => {},
      },
    );

    assert.equal(output.persistedRoute, "roleplay_turn");
    assert.equal(output.persisted.assistantMessageId, "am-001");
    assert.equal(output.persisted.assistantTurnIndex, 5);
  });
});
