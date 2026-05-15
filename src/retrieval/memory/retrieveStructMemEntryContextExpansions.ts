import { sql } from "drizzle-orm";
import { db } from "../../db/client";
import { traceStage } from "../../observability/langsmithTracing";
import type { RetrievedStructMemEntry } from "./retrieveStructMemEntries";

export interface StructMemEntryContextExpansion {
  entryId: string;
  eventId: string;
  messages: Array<{
    turnIndex: number;
    role: "user" | "assistant";
    content: string;
  }>;
}

export interface StructMemEntryExpansionDiagnostics {
  eligibleCount: number;
  expandedCount: number;
  droppedByBudgetCount: number;
}

export interface StructMemEntryExpansionResult {
  expansions: StructMemEntryContextExpansion[];
  diagnostics: StructMemEntryExpansionDiagnostics;
}

const EXPANDABLE_ENTRY_TYPES = new Set([
  "open_thread",
  "decision",
  "emotional_shift",
]);
const SHORT_ENTRY_TEXT_CHARS = 180;
const MAX_EXPANDED_ENTRIES = 3;
const MAX_MESSAGES_PER_ENTRY = 4;

export function isStructMemEntryExpansionEligible(
  entry: Pick<RetrievedStructMemEntry, "entryType" | "text">,
): boolean {
  return (
    EXPANDABLE_ENTRY_TYPES.has(entry.entryType) ||
    entry.text.trim().length <= SHORT_ENTRY_TEXT_CHARS
  );
}

export function selectStructMemEntriesForExpansion(
  entries: RetrievedStructMemEntry[],
  limit = MAX_EXPANDED_ENTRIES,
): {
  selected: RetrievedStructMemEntry[];
  diagnostics: StructMemEntryExpansionDiagnostics;
} {
  const eligible = entries.filter(isStructMemEntryExpansionEligible);
  const selected = eligible.slice(0, Math.max(0, limit));
  return {
    selected,
    diagnostics: {
      eligibleCount: eligible.length,
      expandedCount: selected.length,
      droppedByBudgetCount: Math.max(0, eligible.length - selected.length),
    },
  };
}

async function retrieveStructMemEntryContextExpansions(input: {
  sessionId: string;
  entries: RetrievedStructMemEntry[];
  entryLimit?: number;
  messagesPerEntry?: number;
}): Promise<StructMemEntryExpansionResult> {
  const entryLimit = input.entryLimit ?? MAX_EXPANDED_ENTRIES;
  const messagesPerEntry = input.messagesPerEntry ?? MAX_MESSAGES_PER_ENTRY;
  const { selected, diagnostics } = selectStructMemEntriesForExpansion(
    input.entries,
    entryLimit,
  );
  if (selected.length === 0) {
    return { expansions: [], diagnostics };
  }

  const eventIds = [...new Set(selected.map((entry) => entry.eventId))];
  const rows = await db.execute(sql`
    SELECT
      sem.event_id,
      cm.turn_index,
      cm.role,
      cm.content
    FROM structmem_event_messages sem
    JOIN chat_messages cm ON cm.id = sem.message_id
    WHERE sem.event_id = ANY(ARRAY[${sql.join(
      eventIds.map((id) => sql`${id}`),
      sql`, `,
    )}]::text[])
      AND cm.session_id = ${input.sessionId}
    ORDER BY cm.turn_index ASC
  `);

  type Row = {
    event_id: string;
    turn_index: number;
    role: "user" | "assistant";
    content: string;
  };
  const messagesByEventId = new Map<string, Row[]>();
  for (const row of rows.rows as unknown as Row[]) {
    const bucket = messagesByEventId.get(row.event_id) ?? [];
    bucket.push(row);
    messagesByEventId.set(row.event_id, bucket);
  }

  return {
    expansions: selected
      .map((entry) => ({
        entryId: entry.id,
        eventId: entry.eventId,
        messages: (messagesByEventId.get(entry.eventId) ?? [])
          .slice(0, messagesPerEntry)
          .map((message) => ({
            turnIndex: message.turn_index,
            role: message.role,
            content: message.content,
          })),
      }))
      .filter((expansion) => expansion.messages.length > 0),
    diagnostics,
  };
}

export const retrieveStructMemEntryContextExpansionsTraced = traceStage(
  "retrieval.structmem_entry_context_expansions",
  retrieveStructMemEntryContextExpansions,
  { tags: ["retrieval", "structmem"] },
);
