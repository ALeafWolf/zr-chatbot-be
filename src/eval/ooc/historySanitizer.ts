/**
 * TG0/TG1.3 — Generation-facing history sanitizer.
 *
 * Strips full-width 「（心想：/（内心：」-lead parenthetical spans from
 * assistant messages in the copy sent to the model. DB text and the
 * memory-extraction pipeline are untouched.
 *
 * This module is shareable with TG1.3: when TG1.3 lands, import
 * `sanitizeAssistantHistory` from this module and call it in
 * `buildPromptContext.ts` on the assistant-side content in the
 * `conversationHistory` map.
 *
 * Design:
 * - Only strips full-width Chinese parentheses starting with 「（心想：」
 *   or 「（内心：」. Half-width `(心想：` / `(内心：` variants are NOT
 *   matched (not present in the evidence transcript).
 * - Short action/pause parentheticals like 「（停顿片刻）」 are preserved
 *   (they are canonical Zuo Ran style).
 * - The stripping is span-level: if a parenthetical span starts with
 *   the banned prefix, the entire span is removed; surrounding text is
 *   preserved.
 * - Nested parentheses are not supported (structural parser limitation);
 *   only the outermost span is matched.
 *
 * # TG0 harness limitation (F1)
 *
 * In the TG0 replay harness, this sanitizer is applied only to SEED history
 * (turns 1–259 of the transcript). Replies generated during the 260→291 loop
 * are stored to the DB and read back for later turns WITHOUT sanitization,
 * because `buildPromptContext` reads raw message content from the DB. The
 * true generation-facing sanitizer (applied in `buildPromptContext.ts` for
 * every history read) arrives at TG1.3 — when this module is imported and
 * called in the conversationHistory map.
 */

// ---------------------------------------------------------------------------
// Prefixes that trigger striping
// ---------------------------------------------------------------------------

const BANNED_PREFIXES = ["心想：", "内心："];

// ---------------------------------------------------------------------------
// Regex: Match a full-width parenthetical span that starts with a banned prefix
// ---------------------------------------------------------------------------

/**
 * Build a regex that matches a Chinese full-width parenthetical span
 * starting with one of the banned prefixes.
 *
 * Pattern explanation:
 *   （           — opening full-width paren
 *   (心想：|内心：) — banned prefix (capture group 1)
 *   [^（）]*     — any chars except parens (non-greedy would be safer,
 *                   but nested parens are not supported per design)
 *   ）           — closing full-width paren
 */
function buildStripRegex(): RegExp {
  const prefixes = BANNED_PREFIXES.map((p) =>
    p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
  ).join("|");
  return new RegExp(`（(${prefixes})[^（）]*）`, "g");
}

// ---------------------------------------------------------------------------
// Sanitizer function
// ---------------------------------------------------------------------------

const STRIP_REGEX = buildStripRegex();

/**
 * Strip 「（心想：/（内心：」-lead parenthetical spans from assistant history text.
 *
 * @param content - The assistant message content to sanitize.
 * @returns The sanitized text with banned parenthetical spans removed.
 *
 * @example
 * ```ts
 * sanitizeAssistantHistory("（心想：这是什么）正文（停顿）")
 * // → "正文（停顿）"
 *
 * sanitizeAssistantHistory("（内心：不对劲）他沉默了片刻。")
 * // → "他沉默了片刻。"
 *
 * sanitizeAssistantHistory("（停顿片刻）他垂下眼。")
 * // → "（停顿片刻）他垂下眼。"  (short action paren — preserved)
 * ```
 */
export function sanitizeAssistantHistory(content: string): string {
  if (!content) return content;
  return content.replace(STRIP_REGEX, "").trim();
}

/**
 * Check whether a parenthetical span is a banned monologue span
 * (starts with 「心想：」 or 「内心：」).
 *
 * Useful for the OOC metrics to classify existing history.
 */
export function isBannedParentheticalSpan(span: string): boolean {
  const trimmed = span.trim();
  return BANNED_PREFIXES.some((prefix) => trimmed.startsWith(prefix));
}
