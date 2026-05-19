import type { MemoryNamespace } from "../../memory/shared/memoryNamespace";
import type { RetrievedSessionMemoryChunk } from "../../retrieval/memory/retrieveSessionMemoryChunks";
import type { RetrievedStructMemEntry } from "../../retrieval/memory/retrieveStructMemEntries";
import type { RetrievedStructMemConsolidation } from "../../retrieval/memory/retrieveStructMemConsolidations";

export interface StructMemConsolidationRetrievalFlags {
  structMemEnabled: boolean;
  structMemConsolidationEnabled: boolean;
  structMemCrossSessionRetrievalEnabled: boolean;
}

export function shouldRetrieveStructMemConsolidations(
  flags: StructMemConsolidationRetrievalFlags,
): boolean {
  return (
    flags.structMemEnabled &&
    (flags.structMemConsolidationEnabled ||
      flags.structMemCrossSessionRetrievalEnabled)
  );
}

export interface OlderRecallInput {
  queryEmbedding: number[];
  sessionId: string;
  characterId: string;
  memoryNamespace: MemoryNamespace | string;
  exclusiveRecentWindowFirstTurn: number;
  latestFrontierTurnIndex: number;
  structMemEnabled: boolean;
  retrieveStructMemConsolidations: boolean;
  sessionRecallLimit?: number;
  structMemEntryLimit?: number;
  structMemConsolidationLimit?: number;
}

export interface OlderRecallRetrievers {
  sessionMemoryChunks: (
    input: Pick<
      OlderRecallInput,
      | "queryEmbedding"
      | "sessionId"
      | "characterId"
      | "exclusiveRecentWindowFirstTurn"
      | "latestFrontierTurnIndex"
    > & { limit?: number },
  ) => Promise<RetrievedSessionMemoryChunk[]>;
  structMemEntries: (
    input: Pick<
      OlderRecallInput,
      | "queryEmbedding"
      | "sessionId"
      | "characterId"
      | "exclusiveRecentWindowFirstTurn"
      | "latestFrontierTurnIndex"
    > & { limit?: number },
  ) => Promise<RetrievedStructMemEntry[]>;
  structMemConsolidations: (
    input: Pick<
      OlderRecallInput,
      | "queryEmbedding"
      | "sessionId"
      | "characterId"
      | "memoryNamespace"
      | "exclusiveRecentWindowFirstTurn"
      | "latestFrontierTurnIndex"
    > & { limit?: number },
  ) => Promise<RetrievedStructMemConsolidation[]>;
}

export interface OlderRecallResult {
  sessionRecall: RetrievedSessionMemoryChunk[];
  structMemEntries: RetrievedStructMemEntry[];
  structMemConsolidations: RetrievedStructMemConsolidation[];
}

export const OLDER_RECALL_RECENT_OVERLAP_TURNS = 2;

export function olderRecallExclusiveFirstTurn(
  recentWindowStartTurn: number,
  overlapTurns = OLDER_RECALL_RECENT_OVERLAP_TURNS,
): number {
  return Math.max(0, recentWindowStartTurn + Math.max(0, overlapTurns));
}

export async function retrieveOlderRecall(
  input: OlderRecallInput,
  retrievers: OlderRecallRetrievers,
): Promise<OlderRecallResult> {
  if (input.latestFrontierTurnIndex < 0) {
    return {
      sessionRecall: [],
      structMemEntries: [],
      structMemConsolidations: [],
    };
  }

  const base = {
    queryEmbedding: input.queryEmbedding,
    sessionId: input.sessionId,
    characterId: input.characterId,
    exclusiveRecentWindowFirstTurn: input.exclusiveRecentWindowFirstTurn,
    latestFrontierTurnIndex: input.latestFrontierTurnIndex,
  };

  const [sessionRecall, structMemEntries, structMemConsolidations] =
    await Promise.all([
      retrievers.sessionMemoryChunks({
        ...base,
        limit: input.sessionRecallLimit,
      }),
      input.structMemEnabled
        ? retrievers.structMemEntries({
            ...base,
            limit: input.structMemEntryLimit,
          })
        : Promise.resolve([] as RetrievedStructMemEntry[]),
      input.retrieveStructMemConsolidations
        ? retrievers.structMemConsolidations({
            ...base,
            memoryNamespace: input.memoryNamespace,
            limit: input.structMemConsolidationLimit,
          })
        : Promise.resolve([] as RetrievedStructMemConsolidation[]),
    ]);

  return { sessionRecall, structMemEntries, structMemConsolidations };
}
