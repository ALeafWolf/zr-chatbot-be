import type { ContextCandidateSource } from "./contextCandidates";
import type {
  MemoryRerankOutput,
  MemoryRerankSelected,
} from "./memoryRerank";
import type { RetrievedMemory } from "../retrieval/memory/retrieveInteractiveMemories";
import type { RetrievedSessionMemoryChunk } from "../retrieval/memory/retrieveSessionMemoryChunks";
import type { RetrievedStructMemEntry } from "../retrieval/memory/retrieveStructMemEntries";
import type { RetrievedStructMemConsolidation } from "../retrieval/memory/retrieveStructMemConsolidations";
import type { RetrievedOpenThread } from "../retrieval/memory/retrieveOpenThreads";
import type { RetrievedCanonChunk } from "../retrieval/canon/retrieveCanonNarrative";
import type { RetrievedCanonScene } from "../retrieval/canon/retrieveCanonTier3Pipeline";
import type { MemoryCorrectionContext } from "./memoryCorrections";
import type { LatestTurnDelta } from "./turnDelta";
import type { SessionSummaryRecord } from "../memory/session/sessionSummaryRepo";
import { formatTurnDelta } from "./turnDelta";

export type RecallVisibleMode = "direct" | "private_hint";

export interface RecallThoughtContextItem {
  source: ContextCandidateSource | "canon_scene";
  text: string;
  relevance?: string;
  usageInstruction?: string;
  reasonCode?: string;
  visibleMode: RecallVisibleMode;
}

export interface RecallThoughtContext {
  items: RecallThoughtContextItem[];
  countsBySource: Partial<Record<string, number>>;
  selectionMode: "rerank" | "fallback";
}

export interface BuildRecallThoughtContextInput {
  memories: RetrievedMemory[];
  sessionRecall: RetrievedSessionMemoryChunk[];
  structMemEntries: RetrievedStructMemEntry[];
  structMemConsolidations: RetrievedStructMemConsolidation[];
  openThreads: RetrievedOpenThread[];
  canonChunks: RetrievedCanonChunk[];
  canonScenes: RetrievedCanonScene[];
  sessionSummary: SessionSummaryRecord;
  latestTurnDelta: LatestTurnDelta | null;
  memoryCorrections: MemoryCorrectionContext[];
  rerankOutput: MemoryRerankOutput | null;
}

const RECALL_ITEM_MAX_CHARS = 200;
const RECALL_CANON_EXCERPT_CHARS = 160;
const RECALL_TOTAL_ITEM_CAP = 8;

/** Sensible ordering when rerank output is absent (fallback path). */
const FALLBACK_SOURCE_ORDER: ContextCandidateSource[] = [
  "memory_correction",
  "open_thread",
  "latest_turn_delta",
  "session_summary",
  "structmem_entry",
  "structmem_consolidation",
  "motif_probe",
  "session_chunk",
  "interactive_memory",
  "canon_chunk",
];

function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max - 1)}…`;
}

function buildRerankLookup(
  rerankOutput: MemoryRerankOutput,
): Map<string, MemoryRerankSelected> {
  const map = new Map<string, MemoryRerankSelected>();
  for (const item of rerankOutput.selected) {
    map.set(item.id, item);
  }
  return map;
}

function visibleModeFor(
  rerankMeta: MemoryRerankSelected | undefined,
): RecallVisibleMode {
  if (!rerankMeta) return "direct";
  if (
    rerankMeta.usageInstruction === "do_not_mention_explicitly" ||
    rerankMeta.usageInstruction === "tone_only"
  ) {
    return "private_hint";
  }
  return "direct";
}

function privateHintText(usageInstruction: string | undefined): string {
  if (usageInstruction === "do_not_mention_explicitly") {
    return "(private continuity reference, not for narration)";
  }
  if (usageInstruction === "tone_only") {
    return "(tone guidance, not for narration)";
  }
  return "(private context, not for narration)";
}

function pushMemoryItem(
  items: RecallThoughtContextItem[],
  memory: RetrievedMemory,
  rerankMeta: MemoryRerankSelected | undefined,
): void {
  const mode = visibleModeFor(rerankMeta);
  const text =
    mode === "private_hint"
      ? privateHintText(rerankMeta?.usageInstruction)
      : truncate(`[${memory.memoryType}] ${memory.summary}`, RECALL_ITEM_MAX_CHARS);
  items.push({
    source: "interactive_memory",
    text,
    relevance: rerankMeta?.relevance,
    usageInstruction: rerankMeta?.usageInstruction,
    reasonCode: rerankMeta?.reasonCode,
    visibleMode: mode,
  });
}

function pushSessionChunkItem(
  items: RecallThoughtContextItem[],
  chunk: RetrievedSessionMemoryChunk,
  rerankMeta: MemoryRerankSelected | undefined,
): void {
  const mode = visibleModeFor(rerankMeta);
  const text =
    mode === "private_hint"
      ? privateHintText(rerankMeta?.usageInstruction)
      : truncate(chunk.chunkText, RECALL_ITEM_MAX_CHARS);
  items.push({
    source: "session_chunk",
    text,
    relevance: rerankMeta?.relevance,
    usageInstruction: rerankMeta?.usageInstruction,
    reasonCode: rerankMeta?.reasonCode,
    visibleMode: mode,
  });
}

function pushStructMemEntryItem(
  items: RecallThoughtContextItem[],
  entry: RetrievedStructMemEntry,
  rerankMeta: MemoryRerankSelected | undefined,
): void {
  const mode = visibleModeFor(rerankMeta);
  const text =
    mode === "private_hint"
      ? privateHintText(rerankMeta?.usageInstruction)
      : truncate(`[${entry.entryType}, turn ${entry.turnIndex}] ${entry.text}`, RECALL_ITEM_MAX_CHARS);
  items.push({
    source: "structmem_entry",
    text,
    relevance: rerankMeta?.relevance,
    usageInstruction: rerankMeta?.usageInstruction,
    reasonCode: rerankMeta?.reasonCode,
    visibleMode: mode,
  });
}

function pushStructMemConsolidationItem(
  items: RecallThoughtContextItem[],
  con: RetrievedStructMemConsolidation,
  rerankMeta: MemoryRerankSelected | undefined,
): void {
  const mode = visibleModeFor(rerankMeta);
  const range =
    con.turnStart != null && con.turnEnd != null
      ? `turns ${con.turnStart}-${con.turnEnd}`
      : "unknown range";
  const text =
    mode === "private_hint"
      ? privateHintText(rerankMeta?.usageInstruction)
      : truncate(`[${range}] ${con.summaryText}`, RECALL_ITEM_MAX_CHARS);
  items.push({
    source: "structmem_consolidation",
    text,
    relevance: rerankMeta?.relevance,
    usageInstruction: rerankMeta?.usageInstruction,
    reasonCode: rerankMeta?.reasonCode,
    visibleMode: mode,
  });
}

function pushOpenThreadItem(
  items: RecallThoughtContextItem[],
  thread: RetrievedOpenThread,
  rerankMeta: MemoryRerankSelected | undefined,
): void {
  const mode = visibleModeFor(rerankMeta);
  const text =
    mode === "private_hint"
      ? privateHintText(rerankMeta?.usageInstruction)
      : truncate(thread.text, RECALL_ITEM_MAX_CHARS);
  items.push({
    source: "open_thread",
    text,
    relevance: rerankMeta?.relevance,
    usageInstruction: rerankMeta?.usageInstruction,
    reasonCode: rerankMeta?.reasonCode,
    visibleMode: mode,
  });
}

function pushCanonExcerptItem(
  items: RecallThoughtContextItem[],
  excerpt: string,
  source: "canon_chunk" | "canon_scene",
  rerankMeta: MemoryRerankSelected | undefined,
): void {
  const mode = visibleModeFor(rerankMeta);
  const text =
    mode === "private_hint"
      ? privateHintText(rerankMeta?.usageInstruction)
      : truncate(excerpt, RECALL_CANON_EXCERPT_CHARS);
  items.push({
    source,
    text,
    relevance: rerankMeta?.relevance,
    usageInstruction: rerankMeta?.usageInstruction,
    reasonCode: rerankMeta?.reasonCode,
    visibleMode: mode,
  });
}

function pushSessionSummaryItem(
  items: RecallThoughtContextItem[],
  summaryText: string,
  rerankMeta?: MemoryRerankSelected | undefined,
): void {
  const mode = visibleModeFor(rerankMeta);
  const text =
    mode === "private_hint"
      ? privateHintText(rerankMeta?.usageInstruction)
      : truncate(summaryText, RECALL_ITEM_MAX_CHARS);
  items.push({
    source: "session_summary",
    text,
    relevance: rerankMeta?.relevance,
    usageInstruction: rerankMeta?.usageInstruction,
    reasonCode: rerankMeta?.reasonCode,
    visibleMode: mode,
  });
}

function pushLatestTurnDeltaItem(
  items: RecallThoughtContextItem[],
  delta: LatestTurnDelta,
  rerankMeta?: MemoryRerankSelected | undefined,
): void {
  const mode = visibleModeFor(rerankMeta);
  const text =
    mode === "private_hint"
      ? privateHintText(rerankMeta?.usageInstruction)
      : truncate(formatTurnDelta(delta), RECALL_ITEM_MAX_CHARS);
  items.push({
    source: "latest_turn_delta",
    text,
    relevance: rerankMeta?.relevance,
    usageInstruction: rerankMeta?.usageInstruction,
    reasonCode: rerankMeta?.reasonCode,
    visibleMode: mode,
  });
}

function pushMemoryCorrectionItem(
  items: RecallThoughtContextItem[],
  correction: MemoryCorrectionContext,
  rerankMeta?: MemoryRerankSelected | undefined,
): void {
  const mode = visibleModeFor(rerankMeta);
  const text =
    mode === "private_hint"
      ? privateHintText(rerankMeta?.usageInstruction)
      : truncate(
          `Old: ${correction.oldClaim} → New: ${correction.correctedClaim}`,
          RECALL_ITEM_MAX_CHARS,
        );
  items.push({
    source: "memory_correction",
    text,
    relevance: rerankMeta?.relevance,
    usageInstruction: rerankMeta?.usageInstruction,
    reasonCode: rerankMeta?.reasonCode,
    visibleMode: mode,
  });
}

/**
 * Build recall-thought context from the final selected context that generation
 * will receive. When rerankOutput is present, items follow rerank selected order.
 * When rerankOutput is null (fallback), items follow a stable priority order.
 *
 * Rejected candidates are never included.
 * Successful rerank with `selected: []` produces empty items.
 */
export function buildRecallThoughtContext(
  input: BuildRecallThoughtContextInput,
): RecallThoughtContext {
  const items: RecallThoughtContextItem[] = [];

  if (input.rerankOutput && input.rerankOutput.selected.length === 0) {
    return { items: [], countsBySource: {}, selectionMode: "rerank" };
  }

  const selectionMode: "rerank" | "fallback" =
    input.rerankOutput ? "rerank" : "fallback";

  if (input.rerankOutput) {
    // Rerank path — follow reranker selected order
    const lookup = buildRerankLookup(input.rerankOutput);

    // Build fast ID-based lookups for each source type
    const memoryById = new Map<string, RetrievedMemory>();
    for (const m of input.memories) memoryById.set(m.id, m);

    const chunkById = new Map<string, RetrievedSessionMemoryChunk>();
    for (const c of input.sessionRecall) chunkById.set(c.id, c);

    const entryById = new Map<string, RetrievedStructMemEntry>();
    for (const e of input.structMemEntries) entryById.set(e.id, e);

    const conById = new Map<string, RetrievedStructMemConsolidation>();
    for (const c of input.structMemConsolidations) conById.set(c.id, c);

    const threadById = new Map<string, RetrievedOpenThread>();
    for (const t of input.openThreads) threadById.set(t.id, t);

    const canonChunkById = new Map<string, RetrievedCanonChunk>();
    for (const cc of input.canonChunks) canonChunkById.set(cc.id, cc);

    for (const selected of input.rerankOutput.selected) {
      const rerankMeta = lookup.get(selected.id);
      const source = selected.source;

      if (source === "interactive_memory") {
        const m = memoryById.get(selected.id);
        if (m) pushMemoryItem(items, m, rerankMeta);
      } else if (source === "session_chunk") {
        const c = chunkById.get(selected.id);
        if (c) pushSessionChunkItem(items, c, rerankMeta);
      } else if (source === "structmem_entry") {
        const e = entryById.get(selected.id);
        if (e) pushStructMemEntryItem(items, e, rerankMeta);
      } else if (source === "structmem_consolidation") {
        const c = conById.get(selected.id);
        if (c) pushStructMemConsolidationItem(items, c, rerankMeta);
      } else if (source === "open_thread") {
        const t = threadById.get(selected.id);
        if (t) pushOpenThreadItem(items, t, rerankMeta);
      } else if (source === "canon_chunk") {
        const cc = canonChunkById.get(selected.id);
        if (cc) {
          pushCanonExcerptItem(items, cc.textContent, "canon_chunk", rerankMeta);
        }
      } else if (source === "session_summary" && input.sessionSummary?.summaryText) {
        pushSessionSummaryItem(items, input.sessionSummary.summaryText, rerankMeta);
      } else if (source === "latest_turn_delta" && input.latestTurnDelta) {
        pushLatestTurnDeltaItem(items, input.latestTurnDelta, rerankMeta);
      } else if (source === "memory_correction") {
        const correction = input.memoryCorrections.find(
          (c) => `correction_${c.sourceTurnIndex}` === selected.id,
        );
        if (correction) pushMemoryCorrectionItem(items, correction, rerankMeta);
      }
    }

    // Add canon scene excerpts after rerank-selected canon chunks
    if (input.canonScenes.length > 0) {
      for (const scene of input.canonScenes) {
        for (const unit of scene.units.slice(0, 3)) {
          pushCanonExcerptItem(items, unit.textContent, "canon_scene", undefined);
        }
      }
    }
  } else {
    // Fallback path — deterministic priority order
    for (const source of FALLBACK_SOURCE_ORDER) {
      if (source === "interactive_memory") {
        for (const m of input.memories) pushMemoryItem(items, m, undefined);
      } else if (source === "session_chunk") {
        for (const c of input.sessionRecall) pushSessionChunkItem(items, c, undefined);
      } else if (source === "structmem_entry") {
        for (const e of input.structMemEntries) pushStructMemEntryItem(items, e, undefined);
      } else if (source === "structmem_consolidation") {
        for (const c of input.structMemConsolidations) pushStructMemConsolidationItem(items, c, undefined);
      } else if (source === "open_thread") {
        for (const t of input.openThreads) pushOpenThreadItem(items, t, undefined);
      } else if (source === "canon_chunk") {
        for (const cc of input.canonChunks) {
          pushCanonExcerptItem(items, cc.textContent, "canon_chunk", undefined);
        }
      } else if (source === "session_summary" && input.sessionSummary?.summaryText) {
        pushSessionSummaryItem(items, input.sessionSummary.summaryText);
      } else if (source === "latest_turn_delta" && input.latestTurnDelta) {
        pushLatestTurnDeltaItem(items, input.latestTurnDelta);
      } else if (source === "memory_correction") {
        for (const c of input.memoryCorrections) pushMemoryCorrectionItem(items, c);
      }
    }

    // Add canon scenes after chunks in fallback
    if (input.canonScenes.length > 0 && input.canonChunks.length === 0) {
      for (const scene of input.canonScenes) {
        for (const unit of scene.units.slice(0, 3)) {
          pushCanonExcerptItem(items, unit.textContent, "canon_scene", undefined);
        }
      }
    }
  }

  const capped = items.slice(0, RECALL_TOTAL_ITEM_CAP);
  const countsBySource: Partial<Record<string, number>> = {};
  for (const item of capped) {
    countsBySource[item.source] = (countsBySource[item.source] ?? 0) + 1;
  }

  return { items: capped, countsBySource, selectionMode };
}

export const __testing = {
  buildRerankLookup,
  visibleModeFor,
  privateHintText,
  truncate,
  RECALL_TOTAL_ITEM_CAP,
};
