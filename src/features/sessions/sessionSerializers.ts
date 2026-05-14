import type { ChatMessage, ChatSession } from "../../db/schema/chat";

export function serializeSessionListItem(
  s: Pick<
    ChatSession,
    | "sessionId"
    | "characterId"
    | "mode"
    | "continuityScope"
    | "sessionSummary"
    | "displayTitle"
    | "thinking"
    | "temperature"
    | "createdAt"
    | "updatedAt"
  >,
) {
  return {
    session_id: s.sessionId,
    character_id: s.characterId,
    mode: s.mode,
    continuity_scope: s.continuityScope,
    session_summary: s.sessionSummary,
    display_title: s.displayTitle,
    thinking: s.thinking,
    temperature: s.temperature,
    created_at: s.createdAt,
    updated_at: s.updatedAt,
  };
}

export function serializeSessionDetail(
  s: ChatSession,
  messages: ChatMessage[],
) {
  return {
    session_id: s.sessionId,
    character_id: s.characterId,
    mode: s.mode,
    continuity_scope: s.continuityScope,
    pinned_time: s.pinnedTime,
    pinned_location: s.pinnedLocation,
    session_summary: s.sessionSummary,
    display_title: s.displayTitle,
    thinking: s.thinking,
    temperature: s.temperature,
    created_at: s.createdAt,
    updated_at: s.updatedAt,
    messages: messages.map((m) => ({
      id: m.id,
      role: m.role,
      content: m.content,
      turn_index: m.turnIndex,
      created_at: m.createdAt,
      thoughts: Array.isArray(m.thoughts) ? (m.thoughts as unknown[]) : [],
    })),
  };
}
