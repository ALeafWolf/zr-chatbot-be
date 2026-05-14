export interface ConsolidationCandidateEntry {
  id: string;
  eventId: string;
  turnIndex: number;
  entryType: string;
  text: string;
}

export interface ConsolidationThresholdInput {
  enabled: boolean;
  sessionMode: string;
  unconsolidatedTurnCount: number;
  unconsolidatedEntryCount: number;
  minTurns: number;
  minEntries: number;
}

export type ConsolidationEligibility =
  | "eligible"
  | "disabled"
  | "sandbox"
  | "below_threshold";

export function consolidationEligibility(
  input: ConsolidationThresholdInput,
): ConsolidationEligibility {
  if (!input.enabled) return "disabled";
  if (input.sessionMode === "sandbox") return "sandbox";
  if (
    input.unconsolidatedTurnCount < input.minTurns ||
    input.unconsolidatedEntryCount < input.minEntries
  ) {
    return "below_threshold";
  }
  return "eligible";
}

export function selectBufferEntries<T extends ConsolidationCandidateEntry>(
  entries: T[],
  maxBufferEntries: number,
): T[] {
  return [...entries]
    .sort((a, b) => a.turnIndex - b.turnIndex || a.id.localeCompare(b.id))
    .slice(0, Math.max(0, maxBufferEntries));
}

export function selectSeedEntriesByEvent<
  T extends ConsolidationCandidateEntry,
>(
  semanticMatches: T[],
  opts: {
    bufferEntryIds: Set<string>;
    maxSeedEvents: number;
    maxEntriesPerEvent: number;
  },
): T[] {
  const out: T[] = [];
  const eventCounts = new Map<string, number>();
  const eventOrder: string[] = [];

  for (const entry of semanticMatches) {
    if (opts.bufferEntryIds.has(entry.id)) continue;

    if (!eventCounts.has(entry.eventId)) {
      if (eventOrder.length >= opts.maxSeedEvents) continue;
      eventCounts.set(entry.eventId, 0);
      eventOrder.push(entry.eventId);
    }

    const count = eventCounts.get(entry.eventId) ?? 0;
    if (count >= opts.maxEntriesPerEvent) continue;

    eventCounts.set(entry.eventId, count + 1);
    out.push(entry);
  }

  return out;
}

