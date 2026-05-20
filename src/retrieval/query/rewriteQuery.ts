import { z } from "zod";
import { models } from "../../config/models";
import { chatJsonStream } from "../../llm/providers";
import { traceLLMStage, traceStage } from "../../observability/langsmithTracing";
import { attachTraceLlmMetadata } from "../../observability/traceMetadata";
import { CANON_RETRIEVAL, CANON_TIER3 } from "../../character/canonRules";
import { env } from "../../config/env";
import { REWRITE_ANNOTATION_INSTRUCTIONS } from "../../orchestration/annotations/userMessageAnnotations";
import { extractLexicalTerms } from "../canon/lexicalCanonTerms";
import {
  parseStructuralSpans,
  type StructuralSpan,
  type StructuralParseResult,
} from "./userMessageStructuralParse";

export type QueryLane =
  | "user_thought"
  | "user_action"
  | "user_speech"
  | "reply_direction"
  | "raw";

export interface QuerySegment {
  lane: QueryLane;
  text: string;
}

export interface QueryRewriteResult {
  segments: QuerySegment[];
  combined_for_embedding: string;
  entities: string[];
  intent: "attribution" | "recall" | "general";
  confidence?: number;
  hypothetical?: string;
  structuralParseOk: boolean;
  labelOk: boolean;
  parseOk: boolean;
  debug?: {
    structuralSpans: StructuralSpan[];
    labels: Array<{ spanId: string; lane: string }>;
  };
}

const LaneSchema = z.enum([
  "user_thought",
  "user_action",
  "user_speech",
  "reply_direction",
]);

const LaneLabelSchema = z.object({
  spanId: z.string(),
  lane: LaneSchema,
});

function normalizeLaneLabelRows(rows: unknown): unknown {
  if (!Array.isArray(rows)) return rows;
  return rows.map((row) => {
    if (!row || typeof row !== "object" || Array.isArray(row)) return row;
    const obj = row as Record<string, unknown>;
    if (typeof obj.spanId === "string") return row;
    if (typeof obj.id === "string") {
      return { ...obj, spanId: obj.id };
    }
    return row;
  });
}

function normalizeLaneLabelModelOutput(value: unknown): unknown {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return value;
  }

  const obj = value as Record<string, unknown>;
  if (Array.isArray(obj.labels)) {
    return { ...obj, labels: normalizeLaneLabelRows(obj.labels) };
  }
  if (Array.isArray(obj.spans)) {
    return { ...obj, labels: normalizeLaneLabelRows(obj.spans) };
  }
  return value;
}

const LaneLabelModelSchema = z.preprocess(
  normalizeLaneLabelModelOutput,
  z.object({
    labels: z.array(LaneLabelSchema),
    entities: z.array(z.string()).default([]),
    intent: z.enum(["attribution", "recall", "general"]).default("general"),
    confidence: z.number().min(0).max(1).optional(),
    hypothetical: z.string().optional(),
  }),
);

type ModelLane = z.infer<typeof LaneSchema>;
type LaneLabelModelOutput = z.infer<typeof LaneLabelModelSchema>;

export function parseLaneLabelModelOutputForTesting(
  value: unknown,
): LaneLabelModelOutput {
  return LaneLabelModelSchema.parse(value);
}

function serializeForEmbedding(segmentsInIndexOrder: QuerySegment[]): string {
  const header: Record<QueryLane, string> = {
    user_thought: "[user thought]:",
    user_action: "[user action]:",
    user_speech: "[user speech]:",
    reply_direction: "[reply direction suggestion]:",
    raw: "[raw]:",
  };
  const lines: string[] = [];
  for (const s of segmentsInIndexOrder) {
    const h = header[s.lane] ?? "[raw]:";
    lines.push(`${h} ${s.text}`.trimEnd());
  }
  return lines.join("\n").trim();
}

function failOpen(userMessage: string, structural: StructuralParseResult): QueryRewriteResult {
  return {
    segments: [{ lane: "raw", text: userMessage }],
    combined_for_embedding: userMessage.trim(),
    entities: [],
    intent: "general",
    structuralParseOk: structural.ok,
    labelOk: false,
    parseOk: false,
  };
}

function coerceLane(span: StructuralSpan, lane: ModelLane): ModelLane {
  if (span.structuralKind === "square_meta") return "reply_direction";
  if (span.structuralKind === "paren") {
    if (lane === "user_thought" || lane === "user_action") return lane;
    return "user_thought";
  }
  if (lane === "user_speech" || lane === "user_action") return lane;
  return "user_speech";
}

export function mergeSpansToSegments(
  spans: StructuralSpan[],
  labels: Array<{ spanId: string; lane: ModelLane }>,
): QuerySegment[] {
  const labelMap = new Map(labels.map((l) => [l.spanId, l.lane]));
  const ordered = [...spans].sort((a, b) => a.index - b.index);
  return ordered.map((span) => {
    const raw = labelMap.get(span.id);
    const lane = raw
      ? coerceLane(span, raw)
      : span.structuralKind === "square_meta"
        ? "reply_direction"
        : span.structuralKind === "paren"
          ? "user_thought"
          : "user_speech";
    return { lane, text: span.rawText };
  });
}

function validateLabelCoverage(
  spans: StructuralSpan[],
  labels: z.infer<typeof LaneLabelModelSchema>["labels"],
): boolean {
  if (labels.length !== spans.length) return false;
  const ids = new Set(spans.map((s) => s.id));
  const seen = new Set<string>();
  for (const row of labels) {
    if (!ids.has(row.spanId)) return false;
    if (seen.has(row.spanId)) return false;
    seen.add(row.spanId);
  }
  return seen.size === spans.length;
}

/** Golden / tests: same as production merge with explicit label list. */
export function mergeSpansToSegmentsForTesting(
  spans: StructuralSpan[],
  labels: Array<{ spanId: string; lane: ModelLane }>,
): QuerySegment[] {
  return mergeSpansToSegments(spans, labels);
}

function heuristicMislabel(
  userMessage: string,
  structural: StructuralParseResult,
  segments: QuerySegment[],
): boolean {
  const hasWrapper =
    userMessage.includes("(") ||
    userMessage.includes("（") ||
    userMessage.includes("【");
  if (!structural.ok || !hasWrapper) return false;

  const sortedSpans = [...structural.spans].sort((a, b) => a.index - b.index);
  if (sortedSpans.length !== segments.length) return false;

  let anyPlainSpeech = false;
  for (let i = 0; i < sortedSpans.length; i++) {
    const sp = sortedSpans[i]!;
    const sg = segments[i]!;
    if (sp.structuralKind === "plain" && sg.lane === "user_speech") {
      anyPlainSpeech = true;
      break;
    }
  }
  const hasPlain = sortedSpans.some((s) => s.structuralKind === "plain");
  return hasPlain && !anyPlainSpeech;
}

function mergeEntities(rewriter: string[], userMessage: string): string[] {
  const cap = Math.min(
    CANON_TIER3.canonLexCandidates,
    CANON_RETRIEVAL.maxLexicalTerms,
  );
  const seen = new Set<string>();
  const out: string[] = [];
  for (const x of rewriter) {
    const t = x.trim();
    if (!t || seen.has(t)) continue;
    seen.add(t);
    out.push(t);
    if (out.length >= cap) return out;
  }
  for (const t of extractLexicalTerms(userMessage)) {
    if (seen.has(t)) continue;
    seen.add(t);
    out.push(t);
    if (out.length >= cap) break;
  }
  return out;
}

const tracedPhaseB = traceLLMStage(
  "retrieval.query_rewrite.phase_b",
  async (input: {
    payload: { id: string; structuralKind: string; rawText: string }[];
    signal?: AbortSignal;
  }): Promise<z.infer<typeof LaneLabelModelSchema> | null> => {
    const user =
      "Return JSON only. Use this exact shape: " +
      '{"labels":[{"spanId":"s0","lane":"user_speech"}],"entities":[],"intent":"general","confidence":0.9}' +
      `\n\nSpans array:\n${JSON.stringify(input.payload)}`;
    const wantHypothetical = env.CANON_QUERY_HYDE;

    const res = await chatJsonStream<LaneLabelModelOutput>(
      models.extractor,
      [
        { role: "system", content: REWRITE_ANNOTATION_INSTRUCTIONS },
        {
          role: "user",
          content:
            user +
            (wantHypothetical
              ? "\nInclude non-empty hypothetical when you can ground it ONLY in the spans."
              : ""),
        },
      ],
      LaneLabelModelSchema,
      { maxTokens: 1024, temperature: 0.1, signal: input.signal },
    );

    if (!res.ok) return null;
    return attachTraceLlmMetadata(res.data, {
      binding: models.extractor,
      modelRole: "extractor",
      usage: res,
    });
  },
  {
    subsystem: "llm",
    turn: "foreground",
    llm: { binding: models.extractor, modelRole: "extractor" },
  },
);

export function shouldUseAnnotationFallback(q: QueryRewriteResult): boolean {
  if (env.ANNOTATION_RULES_ALWAYS) return true;
  if (!q.parseOk) return true;
  if (q.segments.length === 1 && q.segments[0]?.lane === "raw") return true;
  if (q.confidence !== undefined && q.confidence < env.REWRITE_CONFIDENCE_THRESHOLD) {
    return true;
  }
  return false;
}

export function annotationHeuristicFallback(
  userMessage: string,
  q: QueryRewriteResult,
): boolean {
  if (!q.structuralParseOk || !q.labelOk) return false;
  const struct: StructuralParseResult = {
    ok: q.structuralParseOk,
    spans: q.debug?.structuralSpans ?? [],
  };
  if (!struct.ok || struct.spans.length === 0) return false;
  return heuristicMislabel(userMessage, struct, q.segments);
}

async function rewriteQueryImpl(
  userMessage: string,
  options?: { signal?: AbortSignal },
): Promise<QueryRewriteResult> {
  const trimmed = userMessage.trim();
  if (!trimmed) {
    return {
      segments: [{ lane: "raw", text: "" }],
      combined_for_embedding: "",
      entities: [],
      intent: "general",
      structuralParseOk: true,
      labelOk: true,
      parseOk: true,
    };
  }

  const structural = parseStructuralSpans(userMessage);
  if (!structural.ok) {
    return failOpen(userMessage, structural);
  }

  const payload = structural.spans.map((s) => ({
    id: s.id,
    structuralKind: s.structuralKind,
    rawText: s.rawText,
  }));

  const parsed = await tracedPhaseB({ payload, signal: options?.signal });
  if (!parsed || !validateLabelCoverage(structural.spans, parsed.labels)) {
    return failOpen(userMessage, structural);
  }

  const segments = mergeSpansToSegments(structural.spans, parsed.labels);
  const entities = mergeEntities(parsed.entities ?? [], userMessage);
  const combined = serializeForEmbedding(segments);

  return {
    segments,
    combined_for_embedding: combined || trimmed,
    entities,
    intent: parsed.intent,
    confidence: parsed.confidence,
    hypothetical: parsed.hypothetical?.trim() || undefined,
    structuralParseOk: true,
    labelOk: true,
    parseOk: true,
    debug: {
      structuralSpans: structural.spans,
      labels: parsed.labels.map((l) => ({ spanId: l.spanId, lane: l.lane })),
    },
  };
}

export const rewriteQuery = traceStage(
  "retrieval.query_rewrite",
  rewriteQueryImpl,
  { subsystem: "retrieval", turn: "foreground" },
);

// re-export parse for tests
export { parseStructuralSpans } from "./userMessageStructuralParse";
