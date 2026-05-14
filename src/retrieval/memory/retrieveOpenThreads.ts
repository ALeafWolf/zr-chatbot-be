import { sql } from "drizzle-orm";
import { db } from "../../db/client";
import type { SessionSummaryRecord } from "../../memory/session/sessionSummaryRepo";
import { normalizeSessionSummaryJson } from "../../memory/session/sessionSummaryJson";
import { traceStage } from "../../observability/langsmithTracing";

export type OpenThreadSource = "structmem_entry" | "session_summary";
export type OpenThreadStatus = "open" | "paused";

export interface RetrievedOpenThread {
  id: string;
  source: OpenThreadSource;
  text: string;
  status: OpenThreadStatus;
  sourceTurnIndex: number;
  score: number;
}

interface StructMemOpenThreadRow {
  id: string;
  turn_index: number;
  text: string;
  importance_score: number | null;
  confidence_score: number | null;
}

function isActiveSummaryThread(
  thread: { status: string },
): thread is { status: OpenThreadStatus } {
  return thread.status === "open" || thread.status === "paused";
}

export function scoreStructMemOpenThread(input: {
  turnIndex: number;
  latestFrontierTurnIndex: number;
  importanceScore: number | null;
  confidenceScore: number | null;
}): number {
  const frontier = Math.max(1, input.latestFrontierTurnIndex);
  const recency = Math.min(1, Math.max(0, (input.turnIndex + 1) / frontier));
  const importance = input.importanceScore ?? 0;
  const confidence = input.confidenceScore ?? 0;
  return 0.45 * importance + 0.35 * confidence + 0.2 * recency;
}

export function sortOpenThreads(
  threads: RetrievedOpenThread[],
): RetrievedOpenThread[] {
  return [...threads].sort(
    (a, b) =>
      b.score - a.score || b.sourceTurnIndex - a.sourceTurnIndex,
  );
}

export function retrieveSummaryOpenThreads(
  sessionSummary: SessionSummaryRecord,
  limit = 5,
): RetrievedOpenThread[] {
  if (!sessionSummary?.summaryJson) return [];
  const summary = normalizeSessionSummaryJson(sessionSummary.summaryJson);
  return summary.openThreads
    .filter(isActiveSummaryThread)
    .map((thread, index) => ({
      id: `session_summary:${thread.sourceTurnIndex}:${index}`,
      source: "session_summary" as const,
      text: thread.thread,
      status: (thread.status === "paused" ? "paused" : "open") as OpenThreadStatus,
      sourceTurnIndex: thread.sourceTurnIndex,
      score: thread.status === "open" ? 0.9 : 0.7,
    }))
    .sort((a, b) => b.score - a.score || b.sourceTurnIndex - a.sourceTurnIndex)
    .slice(0, limit);
}

async function retrieveStructMemOpenThreads(input: {
  sessionId: string;
  characterId: string;
  exclusiveRecentWindowFirstTurn: number;
  latestFrontierTurnIndex: number;
  limit?: number;
}): Promise<RetrievedOpenThread[]> {
  const limit = input.limit ?? 5;
  if (input.latestFrontierTurnIndex < 0) return [];

  const rows = await db.execute(sql`
    SELECT
      id,
      turn_index,
      text,
      importance_score,
      confidence_score
    FROM structmem_entries
    WHERE session_id = ${input.sessionId}
      AND character_id = ${input.characterId}
      AND entry_type = 'open_thread'
      AND turn_index < ${input.exclusiveRecentWindowFirstTurn}
    ORDER BY
      COALESCE(importance_score, 0) DESC,
      COALESCE(confidence_score, 0) DESC,
      turn_index DESC
    LIMIT ${Math.max(limit * 3, limit)}
  `);

  return (rows.rows as unknown as StructMemOpenThreadRow[])
    .map((row) => ({
      id: row.id,
      source: "structmem_entry" as const,
      text: row.text,
      status: "open" as const,
      sourceTurnIndex: row.turn_index,
      score: scoreStructMemOpenThread({
        turnIndex: row.turn_index,
        latestFrontierTurnIndex: input.latestFrontierTurnIndex,
        importanceScore: row.importance_score,
        confidenceScore: row.confidence_score,
      }),
    }))
    .sort((a, b) => b.score - a.score || b.sourceTurnIndex - a.sourceTurnIndex)
    .slice(0, limit);
}

function mergeOpenThreads(input: {
  summaryThreads: RetrievedOpenThread[];
  structMemThreads: RetrievedOpenThread[];
  limit: number;
}): RetrievedOpenThread[] {
  const seen = new Set<string>();
  const out: RetrievedOpenThread[] = [];
  for (const thread of [
    ...input.structMemThreads,
    ...input.summaryThreads,
  ].sort((a, b) => b.score - a.score || b.sourceTurnIndex - a.sourceTurnIndex)) {
    const key = thread.text.trim().toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(thread);
    if (out.length >= input.limit) break;
  }
  return out;
}

async function retrieveOpenThreads(input: {
  sessionId: string;
  characterId: string;
  sessionSummary: SessionSummaryRecord;
  structMemEnabled: boolean;
  exclusiveRecentWindowFirstTurn: number;
  latestFrontierTurnIndex: number;
  limit?: number;
}): Promise<RetrievedOpenThread[]> {
  const limit = input.limit ?? 5;
  const [summaryThreads, structMemThreads] = await Promise.all([
    Promise.resolve(retrieveSummaryOpenThreads(input.sessionSummary, limit)),
    input.structMemEnabled
      ? retrieveStructMemOpenThreads({
          sessionId: input.sessionId,
          characterId: input.characterId,
          exclusiveRecentWindowFirstTurn: input.exclusiveRecentWindowFirstTurn,
          latestFrontierTurnIndex: input.latestFrontierTurnIndex,
          limit,
        })
      : Promise.resolve([] as RetrievedOpenThread[]),
  ]);

  return mergeOpenThreads({ summaryThreads, structMemThreads, limit });
}

export const retrieveOpenThreadsTraced = traceStage(
  "retrieval.open_threads",
  retrieveOpenThreads,
);
