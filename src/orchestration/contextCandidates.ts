import type { ConversationTurn } from "../retrieval/conversation/getRecentConversationWindow";
import type { RetrievedMemory } from "../retrieval/memory/retrieveInteractiveMemories";
import type { RetrievedOpenThread } from "../retrieval/memory/retrieveOpenThreads";
import type { RetrievedSessionMemoryChunk } from "../retrieval/memory/retrieveSessionMemoryChunks";
import type { RetrievedStructMemConsolidation } from "../retrieval/memory/retrieveStructMemConsolidations";
import type { RetrievedStructMemEntry } from "../retrieval/memory/retrieveStructMemEntries";
import type { RetrievedCanonChunk } from "../retrieval/canon/retrieveCanonNarrative";
import type { RetrievedCanonScene } from "../retrieval/canon/retrieveCanonTier3Pipeline";
import type { MemoryCorrectionContext } from "./memoryCorrections";

export type ContextCandidateSource =
  | "session_summary"
  | "latest_turn_delta"
  | "open_thread"
  | "session_chunk"
  | "structmem_entry"
  | "structmem_consolidation"
  | "interactive_memory"
  | "canon_chunk"
  | "motif_probe"
  | "memory_correction";

export interface ContextCandidate {
  id: string;
  source: ContextCandidateSource;
  text: string;
  score?: number | null;
  recency?: string;
  turnStart?: number | null;
  turnEnd?: number | null;
  entryType?: string;
  metadata?: Record<string, string | number | boolean | null>;
}

export interface CandidateShortlist {
  candidates: ContextCandidate[];
  diagnostics: CandidateShortlistDiagnostics;
}

export interface CandidateShortlistDiagnostics {
  totalRetrieved: number;
  totalShortlisted: number;
  countsBySource: Partial<Record<ContextCandidateSource, number>>;
  truncatedByTotalCap: number;
}

/** Per-source soft caps before applying the total hard cap. */
const SOURCE_CAPS: Partial<Record<ContextCandidateSource, number>> = {
  session_summary: 1,
  latest_turn_delta: 1,
  memory_correction: 3,
  open_thread: 3,
  session_chunk: 5,
  structmem_entry: 6,
  structmem_consolidation: 4,
  interactive_memory: 4,
  canon_chunk: 4,
  motif_probe: 3,
};

const TOTAL_CAP = 24;

const SOURCE_PRIORITY: Record<ContextCandidateSource, number> = {
  memory_correction: 0,
  open_thread: 1,
  latest_turn_delta: 2,
  session_summary: 3,
  structmem_entry: 4,
  structmem_consolidation: 5,
  motif_probe: 6,
  session_chunk: 7,
  interactive_memory: 8,
  canon_chunk: 9,
};

function emptyCounts(): Record<string, number> {
  return {};
}

/** Composite score for interactive memory items (mirrors promptMemoryContextSelector). */
function memoryScore(memory: RetrievedMemory): number {
  return (
    memory.cosineSimilarity +
    memory.importanceScore * 0.1 +
    memory.emotionScore * 0.05
  );
}

function rankCandidates(
  candidates: ContextCandidate[],
): ContextCandidate[] {
  return [...candidates].sort((a, b) => {
    const pa = SOURCE_PRIORITY[a.source] ?? 99;
    const pb = SOURCE_PRIORITY[b.source] ?? 99;
    return pa - pb || (b.score ?? 0) - (a.score ?? 0);
  });
}

function truncateText(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  return `${text.slice(0, maxChars - 1)}…`;
}

interface BuildCandidatesInput {
  memories: RetrievedMemory[];
  sessionRecall: RetrievedSessionMemoryChunk[];
  structMemEntries: RetrievedStructMemEntry[];
  structMemConsolidations: RetrievedStructMemConsolidation[];
  openThreads: RetrievedOpenThread[];
  canonChunks: RetrievedCanonChunk[];
  recentTurns: ConversationTurn[];
  sessionSummaryText?: string | null;
  latestTurnDeltaText?: string | null;
  motifProbeText?: string | null;
  memoryCorrections?: MemoryCorrectionContext[];
  /** Deterministic retrieval score caps from RetrievalPlan (fallback to defaults). */
  durableMemoryTopK?: number;
  sessionRecallTopK?: number;
  structMemEntryTopK?: number;
  structMemConsolidationTopK?: number;
  openThreadTopK?: number;
}

/** Build and normalize a diverse shortlist from all retrieval sources. */
export function buildPromptContextCandidates(
  input: BuildCandidatesInput,
): CandidateShortlist {
  const all: ContextCandidate[] = [];
  const retrievedBySource = emptyCounts();

  // Session summary
  if (input.sessionSummaryText?.trim()) {
    retrievedBySource["session_summary"] = 1;
    all.push({
      id: "session_summary",
      source: "session_summary",
      text: truncateText(input.sessionSummaryText.trim(), 600),
      score: null,
    });
  }

  // Latest turn delta
  if (input.latestTurnDeltaText?.trim()) {
    retrievedBySource["latest_turn_delta"] = 1;
    all.push({
      id: "latest_turn_delta",
      source: "latest_turn_delta",
      text: truncateText(input.latestTurnDeltaText.trim(), 400),
      score: null,
    });
  }

  // Memory corrections — high priority, injected as candidates
  const corrections = input.memoryCorrections ?? [];
  if (corrections.length > 0) {
    retrievedBySource["memory_correction"] = corrections.length;
    for (const c of corrections.slice(0, SOURCE_CAPS.memory_correction!)) {
      all.push({
        id: `correction_${c.sourceTurnIndex}`,
        source: "memory_correction",
        text: `[CORRECTION] Old: ${c.oldClaim} | New: ${c.correctedClaim}`,
        score: 1,
        turnStart: c.sourceTurnIndex,
        turnEnd: c.sourceTurnIndex,
      });
    }
  }

  // Open threads
  retrievedBySource["open_thread"] = input.openThreads.length;
  for (const t of input.openThreads.slice(0, input.openThreadTopK ?? 5)) {
    all.push({
      id: t.id,
      source: "open_thread",
      text: truncateText(t.text, 400),
      score: t.score,
      turnStart: t.sourceTurnIndex,
      turnEnd: t.sourceTurnIndex,
    });
  }

  // StructMem entries
  retrievedBySource["structmem_entry"] = input.structMemEntries.length;
  for (const e of input.structMemEntries.slice(
    0,
    input.structMemEntryTopK ?? 6,
  )) {
    all.push({
      id: e.id,
      source: "structmem_entry",
      text: truncateText(e.text, 400),
      score: e.finalScore,
      turnStart: e.turnIndex,
      turnEnd: e.turnIndex,
      entryType: e.entryType,
    });
  }

  // StructMem consolidations
  retrievedBySource["structmem_consolidation"] =
    input.structMemConsolidations.length;
  for (const c of input.structMemConsolidations.slice(
    0,
    input.structMemConsolidationTopK ?? 4,
  )) {
    all.push({
      id: c.id,
      source: "structmem_consolidation",
      text: truncateText(c.summaryText, 400),
      score: c.finalScore,
      turnStart: c.turnStart,
      turnEnd: c.turnEnd,
    });
  }

  // Session chunks
  retrievedBySource["session_chunk"] = input.sessionRecall.length;
  for (const sc of input.sessionRecall.slice(
    0,
    input.sessionRecallTopK ?? 5,
  )) {
    all.push({
      id: sc.id,
      source: "session_chunk",
      text: truncateText(sc.chunkText, 400),
      score: sc.finalScore,
      turnStart: sc.turnStart,
      turnEnd: sc.turnEnd,
    });
  }

  // Interactive memories
  retrievedBySource["interactive_memory"] = input.memories.length;
  for (const m of input.memories.slice(0, input.durableMemoryTopK ?? 4)) {
    all.push({
      id: m.id,
      source: "interactive_memory",
      text: truncateText(m.summary, 400),
      score: memoryScore(m),
      turnStart: null,
      turnEnd: null,
    });
  }

  // Canon chunks (compact)
  retrievedBySource["canon_chunk"] = input.canonChunks.length;
  for (const cc of input.canonChunks.slice(0, SOURCE_CAPS.canon_chunk!)) {
    all.push({
      id: cc.id,
      source: "canon_chunk",
      text: truncateText(cc.textContent, 500),
      score: cc.canonPriority ?? null,
      turnStart: null,
      turnEnd: null,
    });
  }

  // Motif probe
  if (input.motifProbeText?.trim()) {
    retrievedBySource["motif_probe"] = 1;
    all.push({
      id: "motif_probe",
      source: "motif_probe",
      text: truncateText(input.motifProbeText.trim(), 400),
      score: null,
    });
  }

  // Rank by priority then score
  const ranked = rankCandidates(all);

  // Apply soft per-source caps
  const shortlisted: ContextCandidate[] = [];
  const shortlistedBySource = emptyCounts();
  for (const c of ranked) {
    const cap = SOURCE_CAPS[c.source];
    const current = shortlistedBySource[c.source] ?? 0;
    if (cap !== undefined && current >= cap) continue;
    shortlisted.push(c);
    shortlistedBySource[c.source] = current + 1;
  }

  // Apply total hard cap
  const truncatedByTotalCap =
    shortlisted.length > TOTAL_CAP ? shortlisted.length - TOTAL_CAP : 0;
  const final = shortlisted.slice(0, TOTAL_CAP);

  const countsBySource: Partial<Record<ContextCandidateSource, number>> = {};
  for (const c of final) {
    countsBySource[c.source] = (countsBySource[c.source] ?? 0) + 1;
  }

  return {
    candidates: final,
    diagnostics: {
      totalRetrieved: all.length,
      totalShortlisted: final.length,
      countsBySource,
      truncatedByTotalCap,
    },
  };
}

export interface ApplySelectionInput {
  shortlist: ContextCandidate[];
  selectedIds: string[];
  memories: RetrievedMemory[];
  sessionRecall: RetrievedSessionMemoryChunk[];
  structMemEntries: RetrievedStructMemEntry[];
  structMemConsolidations: RetrievedStructMemConsolidation[];
  openThreads: RetrievedOpenThread[];
}

export interface SelectedTypedArrays {
  memories: RetrievedMemory[];
  sessionRecall: RetrievedSessionMemoryChunk[];
  structMemEntries: RetrievedStructMemEntry[];
  structMemConsolidations: RetrievedStructMemConsolidation[];
  openThreads: RetrievedOpenThread[];
  /** IDs of all selected memory items (excludes session_summary / latest_turn_delta). */
  selectedMemoryIds: string[];
  /** Whether session_summary was selected by the reranker. */
  sessionSummarySelected: boolean;
  /** Whether latest_turn_delta was selected by the reranker. */
  latestTurnDeltaSelected: boolean;
  /** IDs of memory_correction candidates that were selected by the reranker. */
  selectedCorrectionIds: string[];
}

/** Convert reranker-selected candidate IDs back into typed source arrays for buildPromptContext. */
export function applyCandidateSelection(
  input: ApplySelectionInput,
): SelectedTypedArrays {
  const selectedSet = new Set(input.selectedIds);

  const byId = new Map<string, ContextCandidate>();
  for (const c of input.shortlist) {
    byId.set(c.id, c);
  }

  const selectedCorrectionIds = input.shortlist
    .filter((c) => c.source === "memory_correction" && selectedSet.has(c.id))
    .map((c) => c.id);

  return {
    memories: input.memories.filter((m) => selectedSet.has(m.id)),
    sessionRecall: input.sessionRecall.filter((c) => selectedSet.has(c.id)),
    structMemEntries: input.structMemEntries.filter((e) => selectedSet.has(e.id)),
    structMemConsolidations: input.structMemConsolidations.filter((c) =>
      selectedSet.has(c.id),
    ),
    openThreads: input.openThreads.filter((t) => selectedSet.has(t.id)),
    selectedMemoryIds: input.selectedIds.filter(
      (id) => byId.get(id)?.source !== "session_summary" && byId.get(id)?.source !== "latest_turn_delta",
    ),
    sessionSummarySelected: selectedSet.has("session_summary"),
    latestTurnDeltaSelected: selectedSet.has("latest_turn_delta"),
    selectedCorrectionIds,
  };
}

/**
 * Filter canon chunks and scenes to only those selected by the reranker.
 *
 * When no canon candidate is selected, both arrays are emptied.
 * When canon chunks are selected, scenes are cleared to prevent
 * re-expanding a selected chunk into the whole scene via formatCanonScenes.
 *
 * @param selectedCanonChunkIds IDs of canon_chunk candidates the reranker selected (may be empty).
 */
export function filterCanonBySelection(
  canonChunks: RetrievedCanonChunk[],
  canonScenes: RetrievedCanonScene[],
  selectedCanonChunkIds: string[],
): { canonChunks: RetrievedCanonChunk[]; canonScenes: RetrievedCanonScene[] } {
  const selectedIdSet = new Set(selectedCanonChunkIds);
  return {
    canonChunks: canonChunks.filter((c) => selectedIdSet.has(c.id)),
    // Clear scenes to prevent re-expanding a selected chunk into the whole scene;
    // formatCanon(chunks) is used instead when scenes are empty.
    canonScenes: [],
  };
}
