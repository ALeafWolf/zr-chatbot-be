import { createHash } from "node:crypto";

export const PROMPT_TRACE_VERSION = 1;
export const TRACE_PAYLOAD_SYMBOL = Symbol.for("zuoran.trace.payload");

export interface PromptBlockStats {
  label: string;
  chars: number;
  estimatedTokens: number;
  present: boolean;
}

export interface PromptSourceTokenEstimate {
  source: string;
  chars: number;
  estimatedTokens: number;
  present: boolean;
}

export interface PromptTracePayload {
  promptVersion: number;
  promptHash: string;
  systemPromptChars: number;
  conversationMessageCount: number;
  conversationChars: number;
  retrievedCanonNarrativeChars: number;
  totalEstimatedPromptTokens: number;
  blockPresence: Record<string, boolean>;
  estimatedTokensByBlock: Record<string, number>;
  selectedSourceCounts?: Record<string, number>;
  injectedTokensBySource?: PromptSourceTokenEstimate[];
}

export function estimateTextTokens(text: string | undefined | null): number {
  const chars = text?.length ?? 0;
  return Math.ceil(chars / 4);
}

export function hashTraceText(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

export function analyzePromptBlocks(systemPrompt: string): PromptBlockStats[] {
  const matches = [...systemPrompt.matchAll(/^\[([^\]\n]+)\]\n/gm)];
  if (matches.length === 0) return [];

  return matches.map((match, index) => {
    const label = match[1] ?? "UNKNOWN";
    const start = (match.index ?? 0) + match[0].length;
    const next = matches[index + 1];
    const end = next?.index ?? systemPrompt.length;
    const body = systemPrompt.slice(start, end).trim();
    return {
      label,
      chars: body.length,
      estimatedTokens: estimateTextTokens(body),
      present: body.length > 0,
    };
  });
}

const INJECTED_SOURCE_LABELS = [
  "RECENT CHAT",
  "LATEST TURN DELTA",
  "SESSION SUMMARY",
  "RELEVANT SESSION RECALL",
  "STRUCTURED EVENT MEMORY",
  "STRUCTURED MEMORY SYNTHESIS",
  "INTERACTIVE MEMORY",
  "CANON NARRATIVE",
  "REPLY DIRECTION",
  "DIRECTOR NOTE",
];

export function estimateInjectedTokensBySource(
  systemPrompt: string,
): PromptSourceTokenEstimate[] {
  const blocks = analyzePromptBlocks(systemPrompt);
  const blockMap = new Map(blocks.map((b) => [b.label, b]));

  return INJECTED_SOURCE_LABELS.map((label) => {
    const block = blockMap.get(label);
    return block
      ? {
          source: label,
          chars: block.chars,
          estimatedTokens: block.estimatedTokens,
          present: block.present,
        }
      : { source: label, chars: 0, estimatedTokens: 0, present: false };
  });
}

export function buildPromptTracePayload(input: {
  systemPrompt: string;
  conversationHistory: Array<{ role: string; content: string }>;
  retrievedCanonNarrative?: string;
  selectedSourceCounts?: Record<string, number>;
}): PromptTracePayload {
  const blocks = analyzePromptBlocks(input.systemPrompt);
  const conversationChars = input.conversationHistory.reduce(
    (sum, message) => sum + message.content.length,
    0,
  );
  const conversationTokens = estimateTextTokens(
    input.conversationHistory.map((message) => message.content).join("\n"),
  );
  const estimatedTokensByBlock = Object.fromEntries(
    blocks.map((block) => [block.label, block.estimatedTokens]),
  );
  const blockPresence = Object.fromEntries(
    blocks.map((block) => [block.label, block.present]),
  );
  return {
    promptVersion: PROMPT_TRACE_VERSION,
    promptHash: hashTraceText(
      [
        input.systemPrompt,
        ...input.conversationHistory.map((message) => message.content),
      ].join("\n"),
    ),
    systemPromptChars: input.systemPrompt.length,
    conversationMessageCount: input.conversationHistory.length,
    conversationChars,
    retrievedCanonNarrativeChars: input.retrievedCanonNarrative?.length ?? 0,
    totalEstimatedPromptTokens:
      estimateTextTokens(input.systemPrompt) + conversationTokens,
    blockPresence,
    estimatedTokensByBlock,
    ...(input.selectedSourceCounts
      ? { selectedSourceCounts: input.selectedSourceCounts }
      : {}),
  };
}

export function attachTracePayload<T extends object>(
  value: T,
  payload: Record<string, unknown>,
): T {
  Object.defineProperty(value, TRACE_PAYLOAD_SYMBOL, {
    value: payload,
    enumerable: false,
    configurable: true,
  });
  return value;
}

export function getAttachedTracePayload(
  value: unknown,
): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object") return undefined;
  return (value as Record<symbol, unknown>)[TRACE_PAYLOAD_SYMBOL] as
    | Record<string, unknown>
    | undefined;
}

export function buildDurationPayload(startedAtMs: number): {
  durationMs: number;
} {
  return { durationMs: Math.max(0, Date.now() - startedAtMs) };
}

export function hasRawSensitiveTraceKeys(value: unknown): boolean {
  if (!value || typeof value !== "object") return false;
  const stack: unknown[] = [value];
  while (stack.length > 0) {
    const current = stack.pop();
    if (!current || typeof current !== "object") continue;
    for (const [key, child] of Object.entries(current)) {
      if (key === "playerId" || key === "systemPrompt") return true;
      if (child && typeof child === "object") stack.push(child);
    }
  }
  return false;
}
