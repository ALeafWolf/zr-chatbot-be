import { parseStructuralSpans } from "../../retrieval/query/userMessageStructuralParse";
import type { QuerySegment } from "../../retrieval/query/rewriteQuery";

export interface ReplyDirectionExtraction {
  /** true only when parse ok AND at least one 【】 span was found. */
  applied: boolean;
  /** Original message minus 【…】 regions (delimiters included). */
  strippedMessage: string;
  /** Inner texts of 【】 spans, in original order. */
  replyDirections: string[];
}

/**
 * Deterministically extract 【】 spans from the user message using phase A
 * structural parsing only (no LLM call). When isolation applies, the
 * stripped message is used as the generation-facing user turn and the
 * reply direction texts are injected as a dedicated system-prompt block.
 *
 * Parse failure or zero square spans ⇒ `applied: false`, current behavior
 * unchanged. If the stripped message is empty/whitespace, a placeholder
 * user turn is returned.
 */
export function extractReplyDirections(userMessage: string): ReplyDirectionExtraction {
  const structural = parseStructuralSpans(userMessage);
  if (!structural.ok) {
    return { applied: false, strippedMessage: userMessage, replyDirections: [] };
  }

  const squareSpans = structural.spans.filter((s) => s.structuralKind === "square_meta");
  if (squareSpans.length === 0) {
    return { applied: false, strippedMessage: userMessage, replyDirections: [] };
  }

  // Build stripped message by cutting out square_meta regions using offsets
  const sorted = [...structural.spans].sort((a, b) => a.index - b.index);
  let stripped = "";
  let lastEnd = 0;
  for (const span of sorted) {
    if (span.structuralKind === "square_meta") {
      stripped += userMessage.slice(lastEnd, span.start);
      lastEnd = span.end;
    }
  }
  stripped += userMessage.slice(lastEnd);

  const trimmed = stripped.trim();
  if (!trimmed) {
    stripped = "（用户本轮没有场景内发言，仅提供了场外指示。）";
  }

  return {
    applied: true,
    strippedMessage: stripped,
    replyDirections: squareSpans.map((s) => s.rawText),
  };
}

/**
 * Serialize segments for the prompt-facing `[STRUCTURED USER QUERY]` block,
 * excluding `reply_direction` lanes. Returns empty string when no segments
 * remain after filtering.
 */
export function serializeSegmentsForPrompt(segments: QuerySegment[]): string {
  const header: Record<string, string> = {
    user_thought: "[user thought]:",
    user_action: "[user action]:",
    user_speech: "[user speech]:",
  };

  const filtered = segments.filter((s) => s.lane !== "reply_direction");
  if (filtered.length === 0) return "";

  const lines: string[] = [];
  for (const s of filtered) {
    const h = header[s.lane] ?? "[raw]:";
    lines.push(`${h} ${s.text}`.trimEnd());
  }
  return lines.join("\n").trim();
}
