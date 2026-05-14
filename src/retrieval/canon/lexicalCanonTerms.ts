import {
  CANON_RETRIEVAL,
} from "../../character/canonRules";

function sanitizeLexicalTerm(raw: string): string {
  return raw.replace(/[%_\\]/g, "").trim();
}

/** Terms for ILIKE branch: long CJK runs and alpha-numeric tokens. */
export function extractLexicalTerms(message: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  const re = /[\u4e00-\u9fff]{2,}|[A-Za-z][A-Za-z0-9]{2,}/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(message)) !== null) {
    const t = sanitizeLexicalTerm(m[0]);
    if (t.length < CANON_RETRIEVAL.minLexicalTermLength || seen.has(t)) continue;
    seen.add(t);
    out.push(t);
    if (out.length >= CANON_RETRIEVAL.maxLexicalTerms) break;
  }
  return out;
}
