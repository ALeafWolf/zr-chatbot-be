export type StructuralKind = "plain" | "paren" | "square_meta";

export interface StructuralSpan {
  id: string;
  index: number;
  structuralKind: StructuralKind;
  /** Inner slice for delimited spans (without wrapping brackets). Plain spans are verbatim. */
  rawText: string;
  /** Start offset in the original input (inclusive). Includes delimiters for delimited spans. */
  start: number;
  /** End offset in the original input (exclusive). Includes delimiters for delimited spans. */
  end: number;
}

export interface StructuralParseResult {
  ok: boolean;
  spans: StructuralSpan[];
  error?: string;
}

/**
 * Walk `userMessage` left-to-right. Tracked delimiters never nest: inside () no new (（;
 * inside 【 no nested 【. Parentheses inside 【】 (and vice versa) are literal.
 */
export function scanDelimitedSpans(input: string): StructuralParseResult {
  const spans: StructuralSpan[] = [];
  let i = 0;
  const n = input.length;

  const push = (kind: StructuralKind, rawStart: number, rawEnd: number, outerStart?: number, outerEnd?: number) => {
    const rawText = input.slice(rawStart, rawEnd);
    const index = spans.length;
    const spanStart = outerStart ?? rawStart;
    const spanEnd = outerEnd ?? rawEnd;
    spans.push({
      id: `s${index}`,
      index,
      structuralKind: kind,
      rawText,
      start: spanStart,
      end: spanEnd,
    });
  };

  while (i < n) {
    const ch = input[i];

    if (ch === "【") {
      const close = input.indexOf("】", i + 1);
      if (close === -1) {
        return { ok: false, spans: [], error: "unbalanced_square" };
      }
      if (input.slice(i + 1, close).includes("【")) {
        return { ok: false, spans: [], error: "nested_square" };
      }
      push("square_meta", i + 1, close, i, close + 1);
      i = close + 1;
      continue;
    }

    if (ch === "(" || ch === "（") {
      const closeChar = ch === "(" ? ")" : "）";
      let j = i + 1;
      while (j < n) {
        const cj = input[j];
        if (cj === "(" || cj === "（") {
          return { ok: false, spans: [], error: "nested_paren" };
        }
        if (cj === closeChar) {
          push("paren", i + 1, j, i, j + 1);
          i = j + 1;
          j = -1;
          break;
        }
        j++;
      }
      if (j !== -1) {
        return { ok: false, spans: [], error: "unbalanced_paren" };
      }
      continue;
    }

    let j = i + 1;
    while (j < n) {
      const cj = input[j];
      if (cj === "【" || cj === "(" || cj === "（") break;
      j++;
    }
    if (j > i) push("plain", i, j);
    i = j;
  }

  return { ok: true, spans };
}

export const parseStructuralSpans = scanDelimitedSpans;
