import type { QueryRewriteResult, QuerySegment } from "./rewriteQuery";

export interface RetrievalQueryTexts {
  rawText: string;
  memoryText: string;
  canonText: string;
  shouldFuseRawMemory: boolean;
}

export interface RetrievalQueryTextOptions {
  annotationFallback: boolean;
  confidenceThreshold: number;
}

const MEMORY_LANES = new Set<QuerySegment["lane"]>([
  "user_speech",
  "user_action",
  "user_thought",
  "raw",
]);

const CANON_LANES = new Set<QuerySegment["lane"]>([
  "user_speech",
  "user_action",
  "user_thought",
  "raw",
]);

function normalizedText(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function formatSegments(
  segments: QuerySegment[],
  allowed: Set<QuerySegment["lane"]>,
): string {
  return segments
    .filter((segment) => allowed.has(segment.lane))
    .map((segment) => normalizedText(segment.text))
    .filter(Boolean)
    .join("\n")
    .trim();
}

function canonTextFrom(queryRewrite: QueryRewriteResult): string {
  const parts: string[] = [];
  if (queryRewrite.entities.length > 0) {
    parts.push(`entities: ${queryRewrite.entities.join(", ")}`);
  }
  if (
    queryRewrite.intent === "attribution" ||
    queryRewrite.intent === "recall"
  ) {
    parts.push(`intent: ${queryRewrite.intent}`);
  }
  const segmentText = formatSegments(queryRewrite.segments, CANON_LANES);
  if (segmentText) parts.push(segmentText);
  return parts.join("\n").trim();
}

export function buildRetrievalQueryTexts(input: {
  userMessage: string;
  queryRewrite: QueryRewriteResult;
  options: RetrievalQueryTextOptions;
}): RetrievalQueryTexts {
  const rawText =
    normalizedText(input.userMessage) ||
    normalizedText(input.queryRewrite.combined_for_embedding);
  const memoryText =
    formatSegments(input.queryRewrite.segments, MEMORY_LANES) || rawText;
  const canonText =
    canonTextFrom(input.queryRewrite) ||
    normalizedText(input.queryRewrite.combined_for_embedding) ||
    rawText;

  const confidence = input.queryRewrite.confidence;
  const lowConfidence =
    confidence !== undefined && confidence < input.options.confidenceThreshold;

  return {
    rawText,
    memoryText,
    canonText,
    shouldFuseRawMemory:
      !input.queryRewrite.parseOk ||
      input.options.annotationFallback ||
      lowConfidence,
  };
}
