import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildSessionStatus } from "./sessionStatus";
import type { ChatMessage, ChatSession } from "../../db/schema/chat";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------
const SESSION_ID = "session-00000000-0000-0000-0000-000000000001";

function makeSession(overrides: Partial<ChatSession> = {}): ChatSession {
  return {
    sessionId: SESSION_ID,
    characterId: "char-1",
    playerId: "player-1",
    mode: "canonical_live",
    continuityScope: "main",
    continuityFamily: "main_world",
    personaOverlayId: null,
    memoryNamespace: "ns1",
    pinnedTime: null,
    pinnedLocation: null,
    writebackPolicy: "full_writeback",
    sessionSummary: null,
    displayTitle: "Test Session",
    thinking: true,
    temperature: 1.0,
    deletedAt: null,
    createdAt: new Date("2025-06-01T10:00:00Z"),
    updatedAt: new Date("2025-06-01T11:00:00Z"),
    ...overrides,
  };
}

function makeMsg(
  overrides: Partial<ChatMessage> = {},
): ChatMessage {
  return {
    id: overrides.id ?? "msg-0",
    sessionId: overrides.sessionId ?? SESSION_ID,
    turnIndex: overrides.turnIndex ?? 0,
    role: overrides.role ?? "user",
    route: overrides.route ?? "roleplay_turn",
    content: overrides.content ?? "Hello",
    thoughts: overrides.thoughts ?? null,
    validatorResult: overrides.validatorResult ?? null,
    createdAt: overrides.createdAt ?? new Date("2025-06-01T10:00:00Z"),
  };
}

function usageValidatorResult(overrides: {
  inputTokens?: number;
  outputTokens?: number;
  estimatedCostUsd?: number | null;
} = {}) {
  return {
    in_character: true,
    canon_consistent: true,
    session_state_consistent: true,
    nsfw_within_bounds: true,
    issues: [],
    needs_rewrite: false,
    usage: {
      input_tokens: overrides.inputTokens ?? 500,
      output_tokens: overrides.outputTokens ?? 200,
      // Explicit null (unknown cost) must pass through, not resolve to default
      estimated_cost_usd:
        overrides.estimatedCostUsd !== undefined
          ? overrides.estimatedCostUsd
          : 0.0015,
    },
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe("buildSessionStatus", () => {
  // ---- empty session ----
  it("returns untracked usage for a session with no messages", () => {
    const session = makeSession();
    const result = buildSessionStatus({ session, messages: [] });

    assert.equal(result.kind, "session_status");
    assert.equal(result.command, "show_session_status");
    assert.equal(result.fields.completed_turns, 0);
    assert.equal(result.fields.message_count, 0);
    assert.equal(result.fields.latest_turn_index, 0);
    assert.equal(result.fields.roleplay_count, 0);
    assert.equal(result.fields.app_command_count, 0);
    assert.equal(result.fields.unsupported_count, 0);
    assert.equal(result.fields.usage.coverage, "untracked");
    assert.equal(result.fields.usage.input_tokens, 0);
    assert.equal(result.fields.usage.output_tokens, 0);
    assert.equal(result.fields.usage.total_tokens, 0);
    assert.equal(result.fields.usage.estimated_cost_usd, null);
  });

  // ---- session metadata ----
  it("includes session metadata fields", () => {
    const session = makeSession({
      displayTitle: "My Chat",
      characterId: "char-abc",
      mode: "sandbox",
      continuityScope: "scenario_1",
      pinnedTime: "afternoon",
      pinnedLocation: "garden",
      thinking: false,
      temperature: 0.7,
    });
    const result = buildSessionStatus({ session, messages: [] });

    assert.equal(result.fields.display_title, "My Chat");
    assert.equal(result.fields.session_id, SESSION_ID);
    assert.equal(result.fields.character_id, "char-abc");
    assert.equal(result.fields.mode, "sandbox");
    assert.equal(result.fields.continuity_scope, "scenario_1");
    assert.equal(result.fields.pinned_time, "afternoon");
    assert.equal(result.fields.pinned_location, "garden");
    assert.equal(result.fields.thinking, false);
    assert.equal(result.fields.temperature, 0.7);
    assert.equal(result.fields.created_at, "2025-06-01T10:00:00.000Z");
    assert.equal(result.fields.updated_at, "2025-06-01T11:00:00.000Z");
  });

  // ---- route counts ----
  it("counts messages by route", () => {
    const messages: ChatMessage[] = [
      makeMsg({ id: "m1", turnIndex: 0, role: "user", route: "roleplay_turn" }),
      makeMsg({ id: "m2", turnIndex: 1, role: "assistant", route: "roleplay_turn", validatorResult: usageValidatorResult() }),
      makeMsg({ id: "m3", turnIndex: 2, role: "user", route: "app_command" }),
      makeMsg({ id: "m4", turnIndex: 3, role: "assistant", route: "app_command", validatorResult: { route: "app_command" } }),
      makeMsg({ id: "m5", turnIndex: 4, role: "user", route: "unsupported" }),
      makeMsg({ id: "m6", turnIndex: 5, role: "assistant", route: "unsupported" }),
    ];

    const result = buildSessionStatus({
      session: makeSession(),
      messages,
    });

    assert.equal(result.fields.roleplay_count, 2);
    assert.equal(result.fields.app_command_count, 2);
    assert.equal(result.fields.unsupported_count, 2);
    assert.equal(result.fields.message_count, 6);
    assert.equal(result.fields.completed_turns, 3);
    assert.equal(result.fields.latest_turn_index, 5);
  });

  // ---- completed turns ----
  it("calculates completed turns as number of user messages", () => {
    const messages: ChatMessage[] = [
      makeMsg({ id: "m1", turnIndex: 0, role: "user" }),
      makeMsg({ id: "m2", turnIndex: 1, role: "assistant" }),
      makeMsg({ id: "m3", turnIndex: 2, role: "user" }),
      makeMsg({ id: "m4", turnIndex: 3, role: "assistant" }),
    ];

    const result = buildSessionStatus({
      session: makeSession(),
      messages,
    });

    assert.equal(result.fields.completed_turns, 2);
  });

  // ---- usage: complete coverage ----
  it("reports complete coverage when all assistant roleplay turns have usage", () => {
    const messages: ChatMessage[] = [
      makeMsg({ id: "m1", turnIndex: 0, role: "user" }),
      makeMsg({ id: "m2", turnIndex: 1, role: "assistant", validatorResult: usageValidatorResult({ inputTokens: 100, outputTokens: 50, estimatedCostUsd: 0.0005 }) }),
      makeMsg({ id: "m3", turnIndex: 2, role: "user" }),
      makeMsg({ id: "m4", turnIndex: 3, role: "assistant", validatorResult: usageValidatorResult({ inputTokens: 200, outputTokens: 80, estimatedCostUsd: 0.0010 }) }),
    ];

    const result = buildSessionStatus({
      session: makeSession(),
      messages,
    });

    assert.equal(result.fields.usage.coverage, "complete");
    assert.equal(result.fields.usage.input_tokens, 300);
    assert.equal(result.fields.usage.output_tokens, 130);
    assert.equal(result.fields.usage.total_tokens, 430);
    assert.equal(result.fields.usage.estimated_cost_usd, 0.0015);
    assert.equal(result.fields.usage.untracked_turn_count, 0);
  });

  // ---- usage: partial coverage ----
  it("reports partial coverage when some assistant roleplay turns lack usage", () => {
    const messages: ChatMessage[] = [
      makeMsg({ id: "m1", turnIndex: 0, role: "user" }),
      // This assistant row has no usage metadata (old turn before tracking was added)
      makeMsg({ id: "m2", turnIndex: 1, role: "assistant", route: "roleplay_turn", validatorResult: { in_character: true, canon_consistent: true, issues: [] } }),
      makeMsg({ id: "m3", turnIndex: 2, role: "user" }),
      makeMsg({ id: "m4", turnIndex: 3, role: "assistant", validatorResult: usageValidatorResult({ inputTokens: 500, outputTokens: 200, estimatedCostUsd: 0.0020 }) }),
    ];

    const result = buildSessionStatus({
      session: makeSession(),
      messages,
    });

    assert.equal(result.fields.usage.coverage, "partial");
    assert.equal(result.fields.usage.input_tokens, 500);
    assert.equal(result.fields.usage.output_tokens, 200);
    assert.equal(result.fields.usage.total_tokens, 700);
    assert.equal(result.fields.usage.untracked_turn_count, 1);
  });

  // ---- usage: untracked ----
  it("reports untracked when no assistant roleplay turns have usage metadata", () => {
    const messages: ChatMessage[] = [
      makeMsg({ id: "m1", turnIndex: 0, role: "user" }),
      makeMsg({ id: "m2", turnIndex: 1, role: "assistant", route: "roleplay_turn", validatorResult: { in_character: true } }),
    ];

    const result = buildSessionStatus({
      session: makeSession(),
      messages,
    });

    assert.equal(result.fields.usage.coverage, "untracked");
    assert.equal(result.fields.usage.input_tokens, 0);
    assert.equal(result.fields.usage.output_tokens, 0);
    assert.equal(result.fields.usage.total_tokens, 0);
    // null, not 0, to avoid falsely reporting known usage
    assert.equal(result.fields.usage.estimated_cost_usd, null);
    assert.equal(result.fields.usage.untracked_turn_count, 1);
  });

  // ---- usage: unknown cost null ----
  it("sets estimated_cost_usd to null when any tracked turn has unknown cost", () => {
    const messages: ChatMessage[] = [
      makeMsg({ id: "m1", turnIndex: 0, role: "user" }),
      makeMsg({ id: "m2", turnIndex: 1, role: "assistant", validatorResult: usageValidatorResult({ inputTokens: 100, outputTokens: 50, estimatedCostUsd: null }) }),
    ];

    const result = buildSessionStatus({
      session: makeSession(),
      messages,
    });

    assert.equal(result.fields.usage.coverage, "complete");
    assert.equal(result.fields.usage.estimated_cost_usd, null);
  });

  // ---- null pinned fields ----
  it("returns null for pinned_time and pinned_location when not set", () => {
    const session = makeSession({ pinnedTime: null, pinnedLocation: null });
    const result = buildSessionStatus({ session, messages: [] });

    assert.equal(result.fields.pinned_time, null);
    assert.equal(result.fields.pinned_location, null);
  });

  // ---- fallback display title ----
  it("returns fallback title when display_title is not set", () => {
    const session = makeSession({ displayTitle: null });
    const result = buildSessionStatus({ session, messages: [] });

    assert.match(result.fields.display_title, /^Session /);
    assert.notEqual(result.fields.display_title, null);
  });

  it("returns the actual display_title when set", () => {
    const session = makeSession({ displayTitle: "My Awesome Chat" });
    const result = buildSessionStatus({ session, messages: [] });

    assert.equal(result.fields.display_title, "My Awesome Chat");
  });
});
