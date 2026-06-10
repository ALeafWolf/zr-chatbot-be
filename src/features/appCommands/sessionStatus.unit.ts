import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildSessionStatus } from "./sessionStatus";
import type { ChatMessage, ChatSession } from "../../db/schema/chat";

const SESSION_ID = "session-00000000-0000-0000-0000-000000000001";

function makeSession(overrides: Partial<ChatSession> = {}): ChatSession {
  return {
    sessionId: SESSION_ID, characterId: "char-1", playerId: "player-1",
    mode: "canonical_live", continuityScope: "main", continuityFamily: "main_world",
    personaOverlayId: null, memoryNamespace: "ns1", pinnedTime: null, pinnedLocation: null,
    writebackPolicy: "full_writeback", sessionSummary: null, displayTitle: "Test Session",
    thinking: true, temperature: 1.0, deletedAt: null,
    createdAt: new Date("2025-06-01T10:00:00Z"), updatedAt: new Date("2025-06-01T11:00:00Z"),
    ...overrides,
  };
}

function makeMsg(overrides: Partial<ChatMessage> = {}): ChatMessage {
  return {
    id: overrides.id ?? "msg-0", sessionId: overrides.sessionId ?? SESSION_ID,
    turnIndex: overrides.turnIndex ?? 0, role: overrides.role ?? "user",
    route: overrides.route ?? "roleplay_turn", content: overrides.content ?? "Hello",
    thoughts: overrides.thoughts ?? null, validatorResult: overrides.validatorResult ?? null,
    createdAt: overrides.createdAt ?? new Date("2025-06-01T10:00:00Z"),
  };
}

function vr(overrides: { inputTokens?: number; outputTokens?: number; estimatedCostUsd?: number | null } = {}) {
  return {
    in_character: true, canon_consistent: true, session_state_consistent: true,
    nsfw_within_bounds: true, issues: [], needs_rewrite: false,
    usage: {
      input_tokens: overrides.inputTokens ?? 500,
      output_tokens: overrides.outputTokens ?? 200,
      estimated_cost_usd: overrides.estimatedCostUsd !== undefined ? overrides.estimatedCostUsd : 0.0015,
    },
  };
}

describe("buildSessionStatus", () => {
  it("returns untracked usage for a session with no messages", () => {
    const result = buildSessionStatus({ session: makeSession(), messages: [] });
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

  it("includes session metadata, route counts, and completed turns", () => {
    const session = makeSession({
      displayTitle: "My Chat", characterId: "char-abc", mode: "sandbox",
      continuityScope: "scenario_1", pinnedTime: "afternoon", pinnedLocation: "garden",
      thinking: false, temperature: 0.7,
    });
    const messages: ChatMessage[] = [
      makeMsg({ id: "m1", turnIndex: 0, role: "user", route: "roleplay_turn" }),
      makeMsg({ id: "m2", turnIndex: 1, role: "assistant", route: "roleplay_turn", validatorResult: vr() }),
      makeMsg({ id: "m3", turnIndex: 2, role: "user", route: "app_command" }),
      makeMsg({ id: "m4", turnIndex: 3, role: "assistant", route: "app_command", validatorResult: { route: "app_command" } }),
      makeMsg({ id: "m5", turnIndex: 4, role: "user", route: "unsupported" }),
      makeMsg({ id: "m6", turnIndex: 5, role: "assistant", route: "unsupported" }),
    ];
    const result = buildSessionStatus({ session, messages });

    // metadata
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

    // route counts
    assert.equal(result.fields.roleplay_count, 2);
    assert.equal(result.fields.app_command_count, 2);
    assert.equal(result.fields.unsupported_count, 2);
    assert.equal(result.fields.message_count, 6);
    assert.equal(result.fields.latest_turn_index, 5);

    // completed turns (number of user messages)
    assert.equal(result.fields.completed_turns, 3);
  });

  it("handles null pinned_time / pinned_location and display title fallback", () => {
    const result = buildSessionStatus({ session: makeSession({ pinnedTime: null, pinnedLocation: null, displayTitle: null }), messages: [] });
    assert.equal(result.fields.pinned_time, null);
    assert.equal(result.fields.pinned_location, null);
    assert.match(result.fields.display_title, /^Session /);

    const withTitle = buildSessionStatus({ session: makeSession({ displayTitle: "My Awesome Chat" }), messages: [] });
    assert.equal(withTitle.fields.display_title, "My Awesome Chat");
  });

  it("reports usage coverage: complete, partial, untracked, and unknown cost", () => {
    // complete
    let msgs: ChatMessage[] = [
      makeMsg({ id: "m1", turnIndex: 0, role: "user" }),
      makeMsg({ id: "m2", turnIndex: 1, role: "assistant", validatorResult: vr({ inputTokens: 100, outputTokens: 50, estimatedCostUsd: 0.0005 }) }),
      makeMsg({ id: "m3", turnIndex: 2, role: "user" }),
      makeMsg({ id: "m4", turnIndex: 3, role: "assistant", validatorResult: vr({ inputTokens: 200, outputTokens: 80, estimatedCostUsd: 0.0010 }) }),
    ];
    let result = buildSessionStatus({ session: makeSession(), messages: msgs });
    assert.equal(result.fields.usage.coverage, "complete", "complete — coverage");
    assert.equal(result.fields.usage.input_tokens, 300, "complete — input");
    assert.equal(result.fields.usage.output_tokens, 130, "complete — output");
    assert.equal(result.fields.usage.total_tokens, 430, "complete — total");
    assert.equal(result.fields.usage.estimated_cost_usd, 0.0015, "complete — cost");
    assert.equal(result.fields.usage.untracked_turn_count, 0, "complete — untracked count");

    // partial (one row lacks usage)
    msgs = [
      makeMsg({ id: "m1", turnIndex: 0, role: "user" }),
      makeMsg({ id: "m2", turnIndex: 1, role: "assistant", route: "roleplay_turn", validatorResult: { in_character: true, canon_consistent: true, issues: [] } }),
      makeMsg({ id: "m3", turnIndex: 2, role: "user" }),
      makeMsg({ id: "m4", turnIndex: 3, role: "assistant", validatorResult: vr({ inputTokens: 500, outputTokens: 200, estimatedCostUsd: 0.0020 }) }),
    ];
    result = buildSessionStatus({ session: makeSession(), messages: msgs });
    assert.equal(result.fields.usage.coverage, "partial", "partial — coverage");
    assert.equal(result.fields.usage.input_tokens, 500, "partial — input");
    assert.equal(result.fields.usage.output_tokens, 200, "partial — output");
    assert.equal(result.fields.usage.total_tokens, 700, "partial — total");
    assert.equal(result.fields.usage.untracked_turn_count, 1, "partial — untracked count");

    // partial with only input_tokens
    msgs = [
      makeMsg({ id: "m1", turnIndex: 0, role: "user" }),
      makeMsg({ id: "m2", turnIndex: 1, role: "assistant", validatorResult: { in_character: true, usage: { input_tokens: 300, estimated_cost_usd: 0.0009 } } }),
      makeMsg({ id: "m3", turnIndex: 2, role: "user" }),
      makeMsg({ id: "m4", turnIndex: 3, role: "assistant", validatorResult: vr({ inputTokens: 500, outputTokens: 200, estimatedCostUsd: 0.0020 }) }),
    ];
    result = buildSessionStatus({ session: makeSession(), messages: msgs });
    assert.equal(result.fields.usage.coverage, "partial", "partial (input-only) — coverage");
    assert.equal(result.fields.usage.input_tokens, 500, "partial (input-only) — input");
    assert.equal(result.fields.usage.output_tokens, 200, "partial (input-only) — output");
    assert.equal(result.fields.usage.total_tokens, 700, "partial (input-only) — total");
    assert.equal(result.fields.usage.untracked_turn_count, 1, "partial (input-only) — untracked count");

    // untracked (no usage metadata at all)
    msgs = [
      makeMsg({ id: "m1", turnIndex: 0, role: "user" }),
      makeMsg({ id: "m2", turnIndex: 1, role: "assistant", route: "roleplay_turn", validatorResult: { in_character: true } }),
    ];
    result = buildSessionStatus({ session: makeSession(), messages: msgs });
    assert.equal(result.fields.usage.coverage, "untracked", "untracked — coverage");
    assert.equal(result.fields.usage.input_tokens, 0, "untracked — input");
    assert.equal(result.fields.usage.output_tokens, 0, "untracked — output");
    assert.equal(result.fields.usage.total_tokens, 0, "untracked — total");
    assert.equal(result.fields.usage.estimated_cost_usd, null, "untracked — cost null");
    assert.equal(result.fields.usage.untracked_turn_count, 1, "untracked — count");

    // unknown cost null
    msgs = [
      makeMsg({ id: "m1", turnIndex: 0, role: "user" }),
      makeMsg({ id: "m2", turnIndex: 1, role: "assistant", validatorResult: vr({ inputTokens: 100, outputTokens: 50, estimatedCostUsd: null }) }),
    ];
    result = buildSessionStatus({ session: makeSession(), messages: msgs });
    assert.equal(result.fields.usage.coverage, "complete", "null cost — coverage");
    assert.equal(result.fields.usage.estimated_cost_usd, null, "null cost — cost null");
  });
});
