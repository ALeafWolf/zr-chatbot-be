export type RetrievalEmbeddingKey = "memory" | "canon" | "rawMemory" | "hyde";

export interface RetrievalEmbeddingRequest {
  key: RetrievalEmbeddingKey;
  text: string;
}

export interface RetrievalEmbeddingBatchOptions {
  memoryText: string;
  canonText: string;
  rawText: string;
  useFusedMemoryQuery: boolean;
  hydeEnabled: boolean;
  canonTier3: boolean;
  hypothetical?: string;
}

export interface RetrievalEmbeddingBatchResult {
  queryEmbedding: number[];
  canonQueryEmbedding: number[];
  rawMemoryQueryEmbedding?: number[];
  hypotheticalQueryEmbedding?: number[];
}

function nonEmpty(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

export function buildRetrievalEmbeddingRequests(
  options: RetrievalEmbeddingBatchOptions,
): RetrievalEmbeddingRequest[] {
  const requests: RetrievalEmbeddingRequest[] = [
    { key: "memory", text: options.memoryText },
    { key: "canon", text: options.canonText },
  ];

  if (options.useFusedMemoryQuery) {
    requests.push({ key: "rawMemory", text: options.rawText });
  }

  const hypothetical = nonEmpty(options.hypothetical);
  if (options.hydeEnabled && options.canonTier3 && hypothetical) {
    requests.push({ key: "hyde", text: hypothetical });
  }

  return requests;
}

export function mapRetrievalEmbeddingResults(
  requests: RetrievalEmbeddingRequest[],
  embeddings: number[][],
): RetrievalEmbeddingBatchResult {
  const byKey = new Map<RetrievalEmbeddingKey, number[]>();
  requests.forEach((request, index) => {
    const embedding = embeddings[index];
    if (embedding) byKey.set(request.key, embedding);
  });

  const queryEmbedding = byKey.get("memory");
  const canonQueryEmbedding = byKey.get("canon");
  if (!queryEmbedding || !canonQueryEmbedding) {
    throw new Error("Retrieval embedding batch missing required embeddings");
  }

  return {
    queryEmbedding,
    canonQueryEmbedding,
    rawMemoryQueryEmbedding: byKey.get("rawMemory"),
    hypotheticalQueryEmbedding: byKey.get("hyde"),
  };
}
