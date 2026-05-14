import type { MemoryNamespace } from "../memory/shared/memoryNamespace";
import type { RetrievedSessionMemoryChunk } from "../retrieval/memory/retrieveSessionMemoryChunks";
import type { RetrievedStructMemEntry } from "../retrieval/memory/retrieveStructMemEntries";
import type { RetrievedStructMemConsolidation } from "../retrieval/memory/retrieveStructMemConsolidations";

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
    >,
  ) => Promise<RetrievedSessionMemoryChunk[]>;
  structMemEntries: (
    input: Pick<
      OlderRecallInput,
      | "queryEmbedding"
      | "sessionId"
      | "characterId"
      | "exclusiveRecentWindowFirstTurn"
      | "latestFrontierTurnIndex"
    >,
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
    >,
  ) => Promise<RetrievedStructMemConsolidation[]>;
}

export interface OlderRecallResult {
  sessionRecall: RetrievedSessionMemoryChunk[];
  structMemEntries: RetrievedStructMemEntry[];
  structMemConsolidations: RetrievedStructMemConsolidation[];
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
      retrievers.sessionMemoryChunks(base),
      input.structMemEnabled
        ? retrievers.structMemEntries(base)
        : Promise.resolve([] as RetrievedStructMemEntry[]),
      input.retrieveStructMemConsolidations
        ? retrievers.structMemConsolidations({
            ...base,
            memoryNamespace: input.memoryNamespace,
          })
        : Promise.resolve([] as RetrievedStructMemConsolidation[]),
    ]);

  return { sessionRecall, structMemEntries, structMemConsolidations };
}
