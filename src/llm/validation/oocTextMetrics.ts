/**
 * TG0/TG2.3 — Deterministic OOC text metrics shared between the eval harness
 * and the production validator.
 *
 * Extracted from `src/eval/ooc/oocMetrics.ts` to avoid production→eval imports.
 * This module is the single source of truth for clinical-word detection and
 * parenthetical-monologue analysis used by both the validator's intimate-scene
 * guard (TG2.3) and the eval harness's OOC metrics (TG0).
 *
 * All functions are pure (input → output, no side effects).
 */

// ---------------------------------------------------------------------------
// Clinical/academic word list
// ---------------------------------------------------------------------------

export const CLINICAL_WORDS = [
  "胚胎",
  "解剖",
  "对称",
  "G点",
  "尿道",
  "腺体",
  "数据",
  "定义",
  "翻译",
  "复刻",
  "同源",
  "器官",
  "结构",
  "证据",
  "角度",
  "计数",
  "分类",
  "分析",
  "认知",
  "模式",
  "反应",
  "阈值",
  "频率",
  "维度",
  "对称性",
  "机制",
  "规律",
  "本质",
  "对应",
  "映射",
] as const;

export type ClinicalWord = (typeof CLINICAL_WORDS)[number];

// ---------------------------------------------------------------------------
// countClinicalWordHits
// ---------------------------------------------------------------------------

/**
 * Count clinical/academic word hits in text.
 *
 * Uses regex alternation with longest-word-first ordering so overlapping terms
 * at the same position are counted once (e.g. "对称性" matches the longer term
 * "对称性" and does NOT also match "对称"). The regex `exec` loop inherently
 * advances past each match, avoiding double-counts.
 *
 * Each word matched adds 1 to the count.
 */
export function countClinicalWordHits(text: string): number {
  if (!text) return 0;
  const sorted = [...CLINICAL_WORDS].sort((a, b) => b.length - a.length);
  const pattern = sorted
    .map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .join("|");
  const regex = new RegExp(pattern, "g");
  let count = 0;
  while (regex.exec(text) !== null) {
    count++;
  }
  return count;
}

// ---------------------------------------------------------------------------
// Parenthetical span helpers
// ---------------------------------------------------------------------------

/**
 * Extract all parenthetical spans from text — content wrapped in
 * Chinese （） brackets.
 */
export function extractParentheticalSpans(text: string): string[] {
  const spans: string[] = [];
  const chineseRe = /（([^（）]*)）/g;
  let match: RegExpExecArray | null;
  while ((match = chineseRe.exec(text)) !== null) {
    spans.push(match[1]);
  }
  return spans;
}

/**
 * Count parenthetical monologue spans that are ≥30 Chinese chars long.
 */
export function countLongParentheticalMonologue(text: string): number {
  const spans = extractParentheticalSpans(text);
  return spans.filter((span) => {
    const chineseChars = [...span].filter(
      (ch) => ch >= "\u4e00" && ch <= "\u9fff",
    ).length;
    return chineseChars >= 30;
  }).length;
}
