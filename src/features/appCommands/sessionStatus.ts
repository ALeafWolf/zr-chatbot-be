import type { ChatMessage, ChatSession } from "../../db/schema/chat";
import type { SessionStatusResult } from "./appCommandTypes";

// ---------------------------------------------------------------------------
// Aggregation helpers
// ---------------------------------------------------------------------------

interface UsageAggregate {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  estimatedCostUsd: number | null;
  coverage: "complete" | "partial" | "untracked";
  untrackedTurnCount: number;
}

function aggregateUsage(
  assistantRoleplayRows: ChatMessage[],
): UsageAggregate {
  if (assistantRoleplayRows.length === 0) {
    return {
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
      estimatedCostUsd: null,
      coverage: "untracked",
      untrackedTurnCount: 0,
    };
  }

  let trackedInput = 0;
  let trackedOutput = 0;
  let trackedCost = 0;
  let trackedCount = 0;
  let costFullyKnown = true;

  for (const msg of assistantRoleplayRows) {
    const vr = msg.validatorResult as Record<string, unknown> | null | undefined;
    const usage = vr?.usage as
      | Record<string, unknown>
      | null
      | undefined;

    if (usage && typeof usage.input_tokens === "number" && typeof usage.output_tokens === "number") {
      trackedInput += usage.input_tokens;
      trackedOutput += usage.output_tokens;
      trackedCount++;

      const cost = usage.estimated_cost_usd;
      if (typeof cost === "number") {
        trackedCost += cost;
      } else {
        costFullyKnown = false;
      }
    }
  }

  const untrackedCount = assistantRoleplayRows.length - trackedCount;

  let coverage: "complete" | "partial" | "untracked";
  if (trackedCount === 0) {
    coverage = "untracked";
  } else if (trackedCount < assistantRoleplayRows.length) {
    coverage = "partial";
  } else {
    coverage = "complete";
  }

  // When no turns have been tracked (untracked coverage), cost must be null
  // rather than 0 to avoid falsely reporting known usage for old untracked turns.
  const estimatedCostUsd = trackedCount === 0 ? null : costFullyKnown ? trackedCost : null;

  return {
    inputTokens: trackedInput,
    outputTokens: trackedOutput,
    totalTokens: trackedInput + trackedOutput,
    estimatedCostUsd,
    coverage,
    untrackedTurnCount: untrackedCount,
  };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface BuildSessionStatusInput {
  session: ChatSession;
  messages: ChatMessage[];
}

export function buildSessionStatus(
  input: BuildSessionStatusInput,
): SessionStatusResult {
  const { session, messages } = input;

  // Message counts by route (all roles)
  const roleplayCount = messages.filter(
    (m) => m.route === "roleplay_turn",
  ).length;
  const appCommandCount = messages.filter(
    (m) => m.route === "app_command",
  ).length;
  const unsupportedCount = messages.filter(
    (m) => m.route === "unsupported",
  ).length;

  // Completed turns = number of user messages (each turn has exactly one user message)
  const completedTurns = messages.filter((m) => m.role === "user").length;

  // Latest turn index
  const latestTurnIndex =
    messages.length > 0
      ? Math.max(...messages.map((m) => m.turnIndex))
      : 0;

  // Usage — only aggregate over assistant roleplay rows where usage metadata lives
  const assistantRoleplayRows = messages.filter(
    (m) => m.role === "assistant" && m.route === "roleplay_turn",
  );
  const usage = aggregateUsage(assistantRoleplayRows);

  return {
    kind: "session_status",
    command: "show_session_status",
    message: "Session status overview.",
    fields: {
      display_title: session.displayTitle ?? `Session ${session.sessionId.slice(0, 8)}`,
      session_id: session.sessionId,
      character_id: session.characterId,
      mode: session.mode,
      continuity_scope: session.continuityScope,
      pinned_time: session.pinnedTime ?? null,
      pinned_location: session.pinnedLocation ?? null,
      created_at: session.createdAt.toISOString(),
      updated_at: session.updatedAt.toISOString(),
      completed_turns: completedTurns,
      message_count: messages.length,
      latest_turn_index: latestTurnIndex,
      roleplay_count: roleplayCount,
      app_command_count: appCommandCount,
      unsupported_count: unsupportedCount,
      thinking: session.thinking,
      temperature: session.temperature,
      usage: {
        input_tokens: usage.inputTokens,
        output_tokens: usage.outputTokens,
        total_tokens: usage.totalTokens,
        estimated_cost_usd: usage.estimatedCostUsd,
        coverage: usage.coverage,
        untracked_turn_count: usage.untrackedTurnCount,
      },
    },
  };
}
