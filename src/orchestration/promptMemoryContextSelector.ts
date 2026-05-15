import type { ConversationTurn } from "../retrieval/conversation/getRecentConversationWindow";
import type { RetrievedMemory } from "../retrieval/memory/retrieveInteractiveMemories";
import type { RetrievedOpenThread } from "../retrieval/memory/retrieveOpenThreads";
import type { RetrievedSessionMemoryChunk } from "../retrieval/memory/retrieveSessionMemoryChunks";
import type { RetrievedStructMemConsolidation } from "../retrieval/memory/retrieveStructMemConsolidations";
import type { RetrievedStructMemEntry } from "../retrieval/memory/retrieveStructMemEntries";
import type { RetrievalPlan } from "./retrievalPlan";

export type PromptMemorySource =
  | "session_chunk"
  | "structmem_entry"
  | "structmem_consolidation"
  | "interactive_memory"
  | "open_thread";

export interface PromptMemoryContextSelection {
  memories: RetrievedMemory[];
  sessionRecall: RetrievedSessionMemoryChunk[];
  structMemEntries: RetrievedStructMemEntry[];
  structMemConsolidations: RetrievedStructMemConsolidation[];
  openThreads: RetrievedOpenThread[];
  diagnostics: PromptMemorySelectionDiagnostics;
}

export interface PromptMemorySelectionDiagnostics {
  retrievedCounts: Record<PromptMemorySource, number>;
  injectedCounts: Record<PromptMemorySource, number>;
  droppedDuplicateCount: number;
  droppedLowScoreCount: number;
  topSources: PromptMemorySource[];
  averageInjectedScore: number | null;
}

interface Candidate<T> {
  id: string;
  source: PromptMemorySource;
  text: string;
  turnStart: number | null;
  turnEnd: number | null;
  score: number | null;
  importance: number | null;
  original: T;
  priority: number;
  cap: number;
}

const MIN_SCORE: Record<PromptMemorySource, number> = {
  open_thread: 0,
  structmem_entry: 0.32,
  structmem_consolidation: 0.3,
  session_chunk: 0.32,
  interactive_memory: 0.22,
};

const SOURCE_PRIORITY: Record<PromptMemorySource, number> = {
  open_thread: 0,
  structmem_entry: 1,
  structmem_consolidation: 2,
  session_chunk: 3,
  interactive_memory: 4,
};

function memoryScore(memory: RetrievedMemory): number {
  return (
    memory.cosineSimilarity +
    memory.importanceScore * 0.1 +
    memory.emotionScore * 0.05
  );
}

function counts(): Record<PromptMemorySource, number> {
  return {
    session_chunk: 0,
    structmem_entry: 0,
    structmem_consolidation: 0,
    interactive_memory: 0,
    open_thread: 0,
  };
}

function candidateRange(candidate: Candidate<unknown>): [number, number] | null {
  if (candidate.turnStart == null || candidate.turnEnd == null) return null;
  return [
    Math.min(candidate.turnStart, candidate.turnEnd),
    Math.max(candidate.turnStart, candidate.turnEnd),
  ];
}

function rangeCoveredByRecent(
  candidate: Candidate<unknown>,
  recentTurnIndexes: Set<number>,
): boolean {
  const range = candidateRange(candidate);
  if (!range) return false;
  for (let i = range[0]; i <= range[1]; i++) {
    if (!recentTurnIndexes.has(i)) return false;
  }
  return true;
}

function overlaps(a: Candidate<unknown>, b: Candidate<unknown>): boolean {
  const ar = candidateRange(a);
  const br = candidateRange(b);
  if (ar && br) return ar[0] <= br[1] && br[0] <= ar[1];

  const at = a.text.trim().toLowerCase();
  const bt = b.text.trim().toLowerCase();
  return at.length > 24 && (at === bt || at.includes(bt) || bt.includes(at));
}

function rankCandidates(candidates: Candidate<unknown>[]): Candidate<unknown>[] {
  return [...candidates].sort(
    (a, b) =>
      a.priority - b.priority ||
      (b.score ?? 0) - (a.score ?? 0) ||
      (b.importance ?? 0) - (a.importance ?? 0),
  );
}

export function selectPromptMemoryContext(input: {
  memories: RetrievedMemory[];
  sessionRecall: RetrievedSessionMemoryChunk[];
  structMemEntries: RetrievedStructMemEntry[];
  structMemConsolidations: RetrievedStructMemConsolidation[];
  openThreads: RetrievedOpenThread[];
  recentTurns: ConversationTurn[];
  retrievalPlan: RetrievalPlan;
}): PromptMemoryContextSelection {
  const retrievedCounts = counts();
  const injectedCounts = counts();
  retrievedCounts.interactive_memory = input.memories.length;
  retrievedCounts.session_chunk = input.sessionRecall.length;
  retrievedCounts.structmem_entry = input.structMemEntries.length;
  retrievedCounts.structmem_consolidation = input.structMemConsolidations.length;
  retrievedCounts.open_thread = input.openThreads.length;

  const recentTurnIndexes = new Set(input.recentTurns.map((t) => t.turnIndex));
  const candidates: Candidate<unknown>[] = [
    ...input.openThreads.map<Candidate<RetrievedOpenThread>>((thread) => ({
      id: thread.id,
      source: "open_thread",
      text: thread.text,
      turnStart: thread.sourceTurnIndex,
      turnEnd: thread.sourceTurnIndex,
      score: thread.score,
      importance: thread.score,
      original: thread,
      priority: SOURCE_PRIORITY.open_thread,
      cap: input.retrievalPlan.openThreadTopK,
    })),
    ...input.structMemEntries.map<Candidate<RetrievedStructMemEntry>>((entry) => ({
      id: entry.id,
      source: "structmem_entry",
      text: entry.text,
      turnStart: entry.turnIndex,
      turnEnd: entry.turnIndex,
      score: entry.finalScore,
      importance: entry.importanceScore,
      original: entry,
      priority: SOURCE_PRIORITY.structmem_entry,
      cap: input.retrievalPlan.structMemEntryTopK,
    })),
    ...input.structMemConsolidations.map<
      Candidate<RetrievedStructMemConsolidation>
    >((item) => ({
      id: item.id,
      source: "structmem_consolidation",
      text: item.summaryText,
      turnStart: item.turnStart,
      turnEnd: item.turnEnd,
      score: item.finalScore,
      importance: item.confidenceScore,
      original: item,
      priority: SOURCE_PRIORITY.structmem_consolidation,
      cap: input.retrievalPlan.structMemConsolidationTopK,
    })),
    ...input.sessionRecall.map<Candidate<RetrievedSessionMemoryChunk>>((chunk) => ({
      id: chunk.id,
      source: "session_chunk",
      text: chunk.chunkText,
      turnStart: chunk.turnStart,
      turnEnd: chunk.turnEnd,
      score: chunk.finalScore,
      importance: chunk.cosineSimilarity,
      original: chunk,
      priority: SOURCE_PRIORITY.session_chunk,
      cap: input.retrievalPlan.sessionRecallTopK,
    })),
    ...input.memories.map<Candidate<RetrievedMemory>>((memory) => ({
      id: memory.id,
      source: "interactive_memory",
      text: memory.summary,
      turnStart: null,
      turnEnd: null,
      score: memoryScore(memory),
      importance: memory.importanceScore,
      original: memory,
      priority: SOURCE_PRIORITY.interactive_memory,
      cap: input.retrievalPlan.durableMemoryTopK,
    })),
  ];

  const selected: Candidate<unknown>[] = [];
  const selectedBySource = counts();
  let droppedDuplicateCount = 0;
  let droppedLowScoreCount = 0;

  for (const candidate of rankCandidates(candidates)) {
    if (selectedBySource[candidate.source] >= candidate.cap) continue;
    if ((candidate.score ?? 0) < MIN_SCORE[candidate.source]) {
      droppedLowScoreCount += 1;
      continue;
    }
    if (
      candidate.source !== "open_thread" &&
      rangeCoveredByRecent(candidate, recentTurnIndexes)
    ) {
      droppedDuplicateCount += 1;
      continue;
    }
    if (selected.some((existing) => overlaps(candidate, existing))) {
      droppedDuplicateCount += 1;
      continue;
    }

    selected.push(candidate);
    selectedBySource[candidate.source] += 1;
    injectedCounts[candidate.source] += 1;
  }

  const selectedIds = new Set(selected.map((c) => `${c.source}:${c.id}`));
  const bySourceScore = [...selected]
    .sort((a, b) => (b.score ?? 0) - (a.score ?? 0))
    .map((c) => c.source);
  const topSources = [...new Set(bySourceScore)].slice(0, 5);
  const scored = selected
    .map((c) => c.score)
    .filter((score): score is number => typeof score === "number");

  return {
    memories: input.memories.filter((m) =>
      selectedIds.has(`interactive_memory:${m.id}`),
    ),
    sessionRecall: input.sessionRecall.filter((c) =>
      selectedIds.has(`session_chunk:${c.id}`),
    ),
    structMemEntries: input.structMemEntries.filter((e) =>
      selectedIds.has(`structmem_entry:${e.id}`),
    ),
    structMemConsolidations: input.structMemConsolidations.filter((c) =>
      selectedIds.has(`structmem_consolidation:${c.id}`),
    ),
    openThreads: input.openThreads.filter((t) =>
      selectedIds.has(`open_thread:${t.id}`),
    ),
    diagnostics: {
      retrievedCounts,
      injectedCounts,
      droppedDuplicateCount,
      droppedLowScoreCount,
      topSources,
      averageInjectedScore:
        scored.length > 0
          ? scored.reduce((sum, score) => sum + score, 0) / scored.length
          : null,
    },
  };
}
