/**
 * TG0 — Deterministic OOC metric computation.
 *
 * All functions are pure (input → output, no side effects), making them
 * easy to unit-test and shareable with the TG1 ablation grid.
 *
 * Clinical-word list sourced from the plan (§1 finding A) and design (§TG0):
 *   胚胎/解剖/对称/G点/尿道/腺体/数据/定义/翻译/复刻
 *
 * Additional academic/clinical words observed in the transcript:
 *   同源/器官/结构/证据/角度/计数/分类/分析/认知/模式/反应/阈值/频率/维度
 */

// Shared clinical-word metrics from the production module (avoids eval→prod
// inversion — the validator's intimate guard also uses these).
import {
  CLINICAL_WORDS,
  countClinicalWordHits,
  countLongParentheticalMonologue,
} from "../../llm/validation/oocTextMetrics";
// Re-export so consumers of oocMetrics can still access them.
export { CLINICAL_WORDS, type ClinicalWord, countClinicalWordHits, countLongParentheticalMonologue } from "../../llm/validation/oocTextMetrics";
// Note: extractParentheticalSpans is NOT imported/re-exported from the shared
// module; this file keeps its own local version with half-width () support.

import type {
  OocPerTurnMetrics,
  OocAggregateMetrics,
  HistoryVariant,
} from "./replayTypes";

// ---------------------------------------------------------------------------
// Sentence-splitting helpers (Chinese + English punctuation)
// ---------------------------------------------------------------------------

/**
 * Split text into sentences. Handles Chinese (。！？) and English (.!?)
 * sentence terminators. Returns an array of non-empty sentence strings.
 */
export function splitSentences(text: string): string[] {
  if (!text) return [];
  // Split on Chinese sentence-ending punctuation （。！？） and English
  // equivalents (.!?), followed by optional whitespace.
  // Ellipsis (……) is NOT treated as a sentence boundary since it often
  // appears mid-sentence for trailing-off speech.
  const raw = text.split(
    /[。！？.!?]+(?:\s*)/g,
  );
  return raw
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

// ---------------------------------------------------------------------------
// Parenthetical span extraction
// ---------------------------------------------------------------------------

/**
 * Extract all parenthetical spans from text — content wrapped in
 * Chinese （） or English () brackets.
 *
 * Note: The production module version (oocTextMetrics.ts) only matches
 * full-width （）. This eval-local variant also matches half-width () for
 * broader metric coverage.
 */
export function extractParentheticalSpans(text: string): string[] {
  const spans: string[] = [];
  // Match Chinese full-width parentheses （…）
  const chineseRe = /（([^（）]*)）/g;
  let match: RegExpExecArray | null;
  while ((match = chineseRe.exec(text)) !== null) {
    spans.push(match[1]);
  }
  // Match English half-width parentheses (…)
  const englishRe = /\(([^()]*)\)/g;
  while ((match = englishRe.exec(text)) !== null) {
    spans.push(match[1]);
  }
  return spans;
}

/**
 * Check if a parenthetical span starts with 「心想：」 or 「内心：」.
 */
export function isXiangXinNeiXinSpan(span: string): boolean {
  const trimmed = span.trim();
  return trimmed.startsWith("心想：") || trimmed.startsWith("内心：");
}

/**
 * Compute clinical-word density (hits per 1000 characters).
 */
export function computeClinicalWordDensity(text: string): number {
  if (!text) return 0;
  const hits = countClinicalWordHits(text);
  return (hits / text.length) * 1000;
}

// ---------------------------------------------------------------------------
// Short-sentence ratio
// ---------------------------------------------------------------------------

/**
 * Compute the ratio of short sentences (<5 Chinese chars) to total sentences.
 */
export function computeShortSentenceRatio(text: string): number {
  const sentences = splitSentences(text);
  if (sentences.length === 0) return 0;
  const shortCount = sentences.filter((s) => {
    const chineseChars = [...s].filter(
      (ch) => ch >= "\u4e00" && ch <= "\u9fff",
    ).length;
    return chineseChars < 5;
  }).length;
  return shortCount / sentences.length;
}

// ---------------------------------------------------------------------------
// Literal 「心想」/「内心」 hits
// ---------------------------------------------------------------------------

/**
 * Count literal occurrences of 「心想」 or 「内心」 in text.
 */
export function countLiteralXiangXinNeiXinHits(text: string): number {
  let hits = 0;
  let index = 0;
  const targets = ["心想", "内心"];
  while (index < text.length) {
    let found = false;
    for (const t of targets) {
      if (text.startsWith(t, index)) {
        hits++;
        index += t.length;
        found = true;
        break;
      }
    }
    if (!found) index++;
  }
  return hits;
}

// ---------------------------------------------------------------------------
// Composite metric computation
// ---------------------------------------------------------------------------

/**
 * Compute all OOC metrics for a single assistant reply.
 */
export function computeOocPerTurnMetrics(
  reply: string,
  turnIndex: number,
): OocPerTurnMetrics {
  const sentences = splitSentences(reply);
  const sentenceCount = sentences.length;
  const shortSentenceRatio = computeShortSentenceRatio(reply);
  const clinicalWordHits = countClinicalWordHits(reply);
  const clinicalWordDensity = computeClinicalWordDensity(reply);
  const longParentheticalMonologueCount =
    countLongParentheticalMonologue(reply);
  const parentheticalSpans = extractParentheticalSpans(reply);
  const literalHits = countLiteralXiangXinNeiXinHits(reply);
  const xiangXinNeiXinSpanTagCount = parentheticalSpans.filter(
    isXiangXinNeiXinSpan,
  ).length;

  return {
    turnIndex,
    replyText: reply,
    replyLength: reply.length,
    sentenceCount,
    shortSentenceRatio,
    clinicalWordHits,
    clinicalWordDensity,
    longParentheticalMonologueCount,
    parentheticalSpanCount: parentheticalSpans.length,
    literalXiangXinNeiXinHits: literalHits,
    xiangXinNeiXinSpanTagCount,
  };
}

// ---------------------------------------------------------------------------
// Aggregate metrics
// ---------------------------------------------------------------------------

/**
 * Compute aggregate (multi-turn) OOC metrics from per-turn metrics array.
 */
export function computeAggregateMetrics(
  perTurn: OocPerTurnMetrics[],
  variant: HistoryVariant,
): OocAggregateMetrics {
  const lengths = perTurn.map((m) => m.replyLength).sort((a, b) => a - b);
  const n = lengths.length;
  const medianLength = n > 0
    ? n % 2 === 1
      ? lengths[Math.floor(n / 2)]
      : (lengths[n / 2 - 1] + lengths[n / 2]) / 2
    : 0;

  const turnsWithLongMonologue = perTurn.filter(
    (m) => m.longParentheticalMonologueCount > 0,
  ).length;
  const turnsWithClinicalWords = perTurn.filter(
    (m) => m.clinicalWordHits > 0,
  ).length;

  return {
    turnCount: n,
    variant,
    meanReplyLength:
      n > 0
        ? perTurn.reduce((sum, m) => sum + m.replyLength, 0) / n
        : 0,
    medianReplyLength: medianLength,
    minReplyLength: lengths[0] ?? 0,
    maxReplyLength: lengths[lengths.length - 1] ?? 0,
    meanShortSentenceRatio:
      n > 0
        ? perTurn.reduce((sum, m) => sum + m.shortSentenceRatio, 0) / n
        : 0,
    meanClinicalWordDensity:
      n > 0
        ? perTurn.reduce((sum, m) => sum + m.clinicalWordDensity, 0) / n
        : 0,
    totalClinicalWordHits: perTurn.reduce(
      (sum, m) => sum + m.clinicalWordHits,
      0,
    ),
    totalLongParentheticalMonologue: perTurn.reduce(
      (sum, m) => sum + m.longParentheticalMonologueCount,
      0,
    ),
    turnsWithLongMonologue,
    turnsWithClinicalWords,
    totalLiteralXiangXinNeiXinHits: perTurn.reduce(
      (sum, m) => sum + m.literalXiangXinNeiXinHits,
      0,
    ),
    totalXiangXinNeiXinSpanTags: perTurn.reduce(
      (sum, m) => sum + m.xiangXinNeiXinSpanTagCount,
      0,
    ),
    perTurn,
  };
}

// ---------------------------------------------------------------------------
// Re-export types for convenience
// ---------------------------------------------------------------------------

export type {
  OocPerTurnMetrics,
  OocAggregateMetrics,
  HistoryVariant,
} from "./replayTypes";
