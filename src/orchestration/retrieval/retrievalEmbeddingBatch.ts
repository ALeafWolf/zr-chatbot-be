import { models } from "../../config/models";
import { embedText } from "../../llm/embeddings/embedText";
import { traceStageWithIO } from "../../observability/langsmithTracing";
import { estimateTextTokens } from "../../observability/tracePayloads";

export type RetrievalEmbeddingKey = "memory" | "canon" | "rawMemory" | "hyde" | "motif";

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
  motifQueries?: string[];
}

export interface RetrievalEmbeddingBatchResult {
  queryEmbedding: number[];
  canonQueryEmbedding: number[];
  rawMemoryQueryEmbedding?: number[];
  hypotheticalQueryEmbedding?: number[];
  motifQueryEmbeddings?: number[][];
}

export interface RetrievalEmbeddingBatchTraceResult
  extends RetrievalEmbeddingBatchResult {
  trace: RetrievalEmbeddingBatchTracePayload;
}

export interface RetrievalEmbeddingBatchTracePayload {
  queryKinds: RetrievalEmbeddingKey[];
  embeddingModelProvider: string;
  embeddingModelName: string;
  inputCharCounts: Record<RetrievalEmbeddingKey, number>;
  estimatedInputTokens: Record<RetrievalEmbeddingKey, number>;
  requestedCount: number;
  failedCount: number;
  durationMs: number;
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

  if (options.motifQueries && options.motifQueries.length > 0) {
    for (const q of options.motifQueries) {
      const trimmed = nonEmpty(q);
      if (trimmed) requests.push({ key: "motif", text: trimmed });
    }
  }

  return requests;
}

export function mapRetrievalEmbeddingResults(
  requests: RetrievalEmbeddingRequest[],
  embeddings: number[][],
): RetrievalEmbeddingBatchResult {
  const byKey = new Map<RetrievalEmbeddingKey, number[]>();
  const motifList: number[][] = [];
  requests.forEach((request, index) => {
    const embedding = embeddings[index];
    if (!embedding) return;
    if (request.key === "motif") {
      motifList.push(embedding);
      return;
    }
    byKey.set(request.key, embedding);
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
    motifQueryEmbeddings: motifList.length > 0 ? motifList : undefined,
  };
}

export function buildRetrievalEmbeddingBatchTracePayload(input: {
  requests: RetrievalEmbeddingRequest[];
  failedCount: number;
  durationMs: number;
}): RetrievalEmbeddingBatchTracePayload {
  return {
    queryKinds: input.requests.map((request) => request.key),
    embeddingModelProvider: models.embedding.provider,
    embeddingModelName: models.embedding.model,
    inputCharCounts: Object.fromEntries(
      input.requests.map((request) => [request.key, request.text.length]),
    ) as Record<RetrievalEmbeddingKey, number>,
    estimatedInputTokens: Object.fromEntries(
      input.requests.map((request) => [
        request.key,
        estimateTextTokens(request.text),
      ]),
    ) as Record<RetrievalEmbeddingKey, number>,
    requestedCount: input.requests.length,
    failedCount: input.failedCount,
    durationMs: input.durationMs,
  };
}

async function runRetrievalEmbeddingBatchInner(input: {
  requests: RetrievalEmbeddingRequest[];
  embed?: (text: string) => Promise<number[]>;
}): Promise<RetrievalEmbeddingBatchTraceResult> {
  const startedAt = Date.now();
  const embed = input.embed ?? embedText;
  try {
    const embeddings = await Promise.all(
      input.requests.map((request) => embed(request.text)),
    );
    return {
      ...mapRetrievalEmbeddingResults(input.requests, embeddings),
      trace: buildRetrievalEmbeddingBatchTracePayload({
        requests: input.requests,
        failedCount: 0,
        durationMs: Date.now() - startedAt,
      }),
    };
  } catch (err) {
    (err as Error & { trace?: RetrievalEmbeddingBatchTracePayload }).trace =
      buildRetrievalEmbeddingBatchTracePayload({
        requests: input.requests,
        failedCount: 1,
        durationMs: Date.now() - startedAt,
      });
    throw err;
  }
}

export const runRetrievalEmbeddingBatch = traceStageWithIO(
  "embedding.query_batch",
  runRetrievalEmbeddingBatchInner,
  {
    subsystem: "retrieval",
    turn: "foreground",
    metadata: {
      modelProvider: models.embedding.provider,
      modelName: models.embedding.model,
      modelRole: "embedding",
    },
    processInputs: (inputs) => {
      const input = unwrapEmbeddingTraceInput(inputs);
      return {
        ...buildRetrievalEmbeddingBatchTracePayload({
        requests: input.requests,
        failedCount: 0,
        durationMs: 0,
        }),
      };
    },
    processOutputs: (outputs) => {
      const result = outputs as unknown as RetrievalEmbeddingBatchTraceResult;
      return { ...result.trace };
    },
  },
);

function unwrapEmbeddingTraceInput(inputs: Record<string, unknown>): {
  requests: RetrievalEmbeddingRequest[];
} {
  if ("input" in inputs && inputs.input) {
    return inputs.input as { requests: RetrievalEmbeddingRequest[] };
  }
  return inputs as unknown as { requests: RetrievalEmbeddingRequest[] };
}
