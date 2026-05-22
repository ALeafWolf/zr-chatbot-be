import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  runRoleplayGenerationAdapter,
  type RoleplayGenerationEvent,
  type RoleplayGenerationInput,
} from "./roleplayGenerationAdapter";
import type { Thought } from "../thought/thoughtTypes";
import type { PromptContext } from "../prompt/buildPromptContext";
import type { ChatSession } from "../../db/schema/chat";
import type { PersonaOverlayDefaults } from "../../character/characterDefaults";
import type { GenerateAndValidateResult } from "../generation/generateAndValidate";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function fakeInput(
  overrides?: Partial<RoleplayGenerationInput>,
): RoleplayGenerationInput {
  return {
    promptContext: { systemPrompt: "[SYSTEM]\nTest.", conversationHistory: [] },
    userMessage: "hello",
    session: {
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
    } as ChatSession,
    personaOverlay: {
      overlay_id: "main",
      character_id: "zuo_ran",
    } as PersonaOverlayDefaults,
    thoughtSummaryCache: new Map(),
    thoughtsAcc: [],
    isFirstUserTurn: false,
    ...overrides,
  };
}

function fakeGenEvent(type: string, data?: unknown) {
  return { type, ...(data ?? {}) };
}

function fakeCompleteResult(
  overrides?: Partial<GenerateAndValidateResult>,
): GenerateAndValidateResult {
  return {
    content: "Hello there.",
    validatorResult: { status: "pass" },
    wasRewritten: false,
    wasDeflected: false,
    inputTokens: 100,
    outputTokens: 50,
    ...overrides,
  } as GenerateAndValidateResult;
}

const fakeThought: Thought = { kind: "recall", text: "A memory surfaces.", ts: Date.now() };

async function collect(
  gen: AsyncGenerator<RoleplayGenerationEvent>,
): Promise<RoleplayGenerationEvent[]> {
  const events: RoleplayGenerationEvent[] = [];
  for await (const ev of gen) {
    events.push(ev);
  }
  return events;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("runRoleplayGenerationAdapter", () => {
  it("maps thought events to frontend-safe thought events", async () => {
    const input = fakeInput();
    const fakeStream = async function* () {
      yield fakeGenEvent("thought", { thought: fakeThought });
    };

    const events = await collect(
      runRoleplayGenerationAdapter(input, {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        generateAndValidate: fakeStream as any,
      }),
    );

    assert.equal(events.length, 1);
    assert.equal(events[0]!.event, "thought");
    const ev = events[0]! as { event: "thought"; data: Thought };
    assert.equal(ev.data.kind, "recall");
    assert.equal(ev.data.text, "A memory surfaces.");
  });

  it("maps tool_call events to frontend-safe tool_call events", async () => {
    const input = fakeInput();
    const fakeStream = async function* () {
      yield fakeGenEvent("tool_call", {
        id: "t1",
        name: "web_search",
        args: { q: "test" },
      });
    };

    const events = await collect(
      runRoleplayGenerationAdapter(input, { generateAndValidate: fakeStream as any }),
    );

    assert.equal(events.length, 1);
    assert.equal(events[0]!.event, "tool_call");
    const ev = events[0]! as { event: "tool_call"; data: { id: string; name: string } };
    assert.equal(ev.data.id, "t1");
    assert.equal(ev.data.name, "web_search");
  });

  it("maps tool_result events to frontend-safe tool_result events", async () => {
    const input = fakeInput();
    const fakeStream = async function* () {
      yield fakeGenEvent("tool_result", {
        id: "t1",
        name: "web_search",
        summary: "found results",
      });
    };

    const events = await collect(
      runRoleplayGenerationAdapter(input, { generateAndValidate: fakeStream as any }),
    );

    assert.equal(events.length, 1);
    assert.equal(events[0]!.event, "tool_result");
    const ev = events[0]! as { event: "tool_result"; data: { id: string; name: string; summary: string } };
    assert.equal(ev.data.id, "t1");
    assert.equal(ev.data.summary, "found results");
  });

  it("suppresses raw draft delta events", async () => {
    const input = fakeInput();
    const fakeStream = async function* () {
      yield fakeGenEvent("delta", { text: "partial draft..." });
      yield fakeGenEvent("delta", { text: " more draft..." });
    };

    const events = await collect(
      runRoleplayGenerationAdapter(input, { generateAndValidate: fakeStream as any }),
    );

    assert.equal(events.length, 0);
  });

  it("captures _complete as a non-frontend event with result payload", async () => {
    const input = fakeInput();
    const result = fakeCompleteResult({ content: "Final reply." });
    const fakeStream = async function* () {
      yield { type: "_complete", result };
    };

    const events = await collect(
      runRoleplayGenerationAdapter(input, { generateAndValidate: fakeStream as any }),
    );

    assert.equal(events.length, 1);
    assert.equal(events[0]!.event, "_complete");
    const ev = events[0]! as { event: "_complete"; data: GenerateAndValidateResult };
    assert.equal(ev.data.content, "Final reply.");
    assert.equal(ev.data.wasRewritten, false);
  });

  it("emits queued recall thoughts before each mapped generation event", async () => {
    const recallOne: Thought = { kind: "recall", text: "Recall 1", ts: 1 };
    const recallTwo: Thought = { kind: "recall", text: "Recall 2", ts: 2 };
    let callCount = 0;

    const input = fakeInput({
      takeReadyRecallThought: () => {
        callCount++;
        return callCount === 1 ? recallOne : callCount === 2 ? recallTwo : null;
      },
    });

    const fakeStream = async function* () {
      yield fakeGenEvent("thought", { thought: fakeThought });
      yield fakeGenEvent("tool_call", { id: "t1", name: "test", args: {} });
    };

    const events = await collect(
      runRoleplayGenerationAdapter(input, { generateAndValidate: fakeStream as any }),
    );

    // Expected: recallOne, fakeThought, recallTwo, tool_call
    assert.equal(events.length, 4);
    assert.equal(events[0]!.event, "thought");
    assert.equal((events[0]! as { data: Thought }).data.text, "Recall 1");
    assert.equal(events[1]!.event, "thought");
    assert.equal((events[1]! as { data: Thought }).data.text, "A memory surfaces.");
    assert.equal(events[2]!.event, "thought");
    assert.equal((events[2]! as { data: Thought }).data.text, "Recall 2");
    assert.equal(events[3]!.event, "tool_call");
  });

  it("stops early when signal is aborted during generation", async () => {
    const abortController = new AbortController();
    const input = fakeInput({ signal: abortController.signal });
    let yieldedBeforeAbort = false;

    const fakeStream = async function* () {
      yield fakeGenEvent("thought", { thought: fakeThought });
      yieldedBeforeAbort = true;
      abortController.abort();
      yield fakeGenEvent("tool_call", { id: "t1", name: "test", args: {} });
    };

    const events = await collect(
      runRoleplayGenerationAdapter(input, { generateAndValidate: fakeStream as any }),
    );

    // First event should yield (abort happens before second event is yielded)
    assert.equal(yieldedBeforeAbort, true);
    // But second event should not be yielded
    assert.equal(events.length, 1);
    assert.equal(events[0]!.event, "thought");
  });

  it("returns no events when signal is already aborted before generation starts", async () => {
    const abortController = new AbortController();
    abortController.abort();
    const input = fakeInput({ signal: abortController.signal });

    const fakeStream = async function* () {
      yield fakeGenEvent("thought", { thought: fakeThought });
    };

    const events = await collect(
      runRoleplayGenerationAdapter(input, { generateAndValidate: fakeStream as any }),
    );

    assert.equal(events.length, 0);
  });

  it("passes promptContext, userMessage, session, personaOverlay, signal, thoughtSummaryCache, thoughtsOut, isFirstUserTurn to generateAndValidateStream", async () => {
    const promptContext: PromptContext = {
      systemPrompt: "[SYSTEM]\nCustom.",
      conversationHistory: [{ role: "user", content: "hi" }],
    };
    const session = fakeInput().session;
    const personaOverlay = fakeInput().personaOverlay;
    const thoughtSummaryCache = new Map([["k", "v"]]);
    const thoughtsAcc: Thought[] = [{ kind: "drafting", text: "prior thought", ts: 0 }];

    let capturedInput: Record<string, unknown> | undefined;
    const fakeStream = async function* (streamInput: Record<string, unknown>) {
      capturedInput = streamInput;
    };

    await collect(
      runRoleplayGenerationAdapter(
        {
          ...fakeInput(),
          promptContext,
          userMessage: "test message",
          session,
          personaOverlay,
          thoughtSummaryCache,
          thoughtsAcc,
          isFirstUserTurn: true,
        },
        { generateAndValidate: fakeStream as any },
      ),
    );

    assert.ok(capturedInput);
    assert.equal(capturedInput!.promptContext, promptContext);
    assert.equal(capturedInput!.userMessage, "test message");
    assert.equal(capturedInput!.session, session);
    assert.equal(capturedInput!.personaOverlay, personaOverlay);
    assert.equal(capturedInput!.thoughtSummaryCache, thoughtSummaryCache);
    assert.equal(capturedInput!.thoughtsOut, thoughtsAcc);
    assert.equal(capturedInput!.isFirstUserTurn, true);
    // signal is undefined in our fake, but the adapter passes input.signal
    // which is undefined in this test
  });
});
