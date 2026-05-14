/** Result of tolerant JSON extraction from noisy LLM text. */
export type ParseJsonOutputResult =
  | { ok: true; data: unknown; rawParsed: string }
  | { ok: false; error: string; raw: string };

/**
 * Removes common markdown code fences (```json … ``` / ``` … ```).
 */
export function stripMarkdownCodeFences(input: string): string {
  let s = input.trim();
  const fenceStart = /^```(?:json)?\s*\r?\n?/i;
  const fenceEnd = /\r?\n?```\s*$/;

  while (fenceStart.test(s)) {
    s = s.replace(fenceStart, "").replace(fenceEnd, "").trim();
  }
  return s;
}

/** Find balanced `{…}` / `[…]` slice starting at `startIdx`, respecting JSON string rules. */
function sliceBalancedContainer(s: string, startIdx: number): string | null {
  const opener = s[startIdx];
  if (opener !== "{" && opener !== "[") return null;

  /** Expected closing delimiter stack (handles mixed objects/arrays correctly). */
  const stack: string[] = opener === "{" ? ["}"] : ["]"];

  let i = startIdx + 1;
  let inString = false;
  let escaped = false;

  while (i < s.length) {
    const c = s[i];

    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (c === "\\") {
        escaped = true;
      } else if (c === '"') {
        inString = false;
      }
    } else if (c === '"') {
      inString = true;
    } else if (c === "{") {
      stack.push("}");
    } else if (c === "[") {
      stack.push("]");
    } else if (c === "}" || c === "]") {
      const want = stack.pop();
      if (want !== c) return null;
      if (stack.length === 0) {
        return s.slice(startIdx, i + 1);
      }
    }

    i += 1;
  }

  return null;
}

/**
 * Locate the best JSON-ish substring starting at first `{` or `[`.
 */
function extractJsonSubstring(s: string): string | null {
  let idx = Infinity;
  const brace = s.indexOf("{");
  const bracket = s.indexOf("[");
  if (brace !== -1) idx = Math.min(idx, brace);
  if (bracket !== -1) idx = Math.min(idx, bracket);
  if (idx === Infinity) return null;
  return sliceBalancedContainer(s, idx);
}

/**
 * Attempt to parse potentially noisy LLM output into JSON.
 * - Strips fences, tries JSON.parse(trimmed).
 * - On failure, extracts first balanced `{`/`[` container and parses that.
 */
export function parseJsonOutput(raw: string): ParseJsonOutputResult {
  const rawTrimmed = raw.trim();
  if (!rawTrimmed) {
    return { ok: false, error: "Empty model output", raw };
  }

  const unfenced = stripMarkdownCodeFences(rawTrimmed);

  const tryParse = (candidate: string): unknown | null => {
    try {
      return JSON.parse(candidate);
    } catch {
      return null;
    }
  };

  let direct = tryParse(unfenced);
  if (direct !== null) {
    return { ok: true, data: direct, rawParsed: unfenced };
  }

  const extracted = extractJsonSubstring(unfenced);
  if (!extracted) {
    return { ok: false, error: "No JSON object/array found", raw };
  }

  const nested = tryParse(extracted);
  if (nested !== null) {
    return { ok: true, data: nested, rawParsed: extracted };
  }

  return {
    ok: false,
    error: "Substring looks like JSON but failed to parse",
    raw,
  };
}
