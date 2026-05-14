import { db } from "../../db/client";
import { sql } from "drizzle-orm";
import { CANON_RETRIEVAL } from "../../character/canonRules";

export interface LexicalUnitHit {
  unitId: string;
  sceneId: string;
  unitIndex: number;
}

export async function searchLexicalUnitScenes(input: {
  terms: string[];
  characterId: string;
  arcKeys: string[];
  limit: number;
}): Promise<LexicalUnitHit[]> {
  const { terms, characterId, arcKeys, limit } = input;
  if (arcKeys.length === 0 || terms.length === 0) return [];

  const arcKeysSql = sql.join(arcKeys.map((k) => sql`${k}`), sql`, `);
  const termPatterns = terms.map((t) => `%${t}%`);
  const matchSum = terms.reduce(
    (acc, _t, i) =>
      i === 0
        ? sql`CASE WHEN su.text_content ILIKE ${termPatterns[i]} THEN 1 ELSE 0 END`
        : sql`${acc} + CASE WHEN su.text_content ILIKE ${termPatterns[i]} THEN 1 ELSE 0 END`,
    sql`` as ReturnType<typeof sql>,
  );
  const termOr = terms.reduce(
    (acc, _t, i) =>
      i === 0
        ? sql`(su.text_content ILIKE ${termPatterns[i]})`
        : sql`${acc} OR (su.text_content ILIKE ${termPatterns[i]})`,
    sql`` as ReturnType<typeof sql>,
  );

  const rows = await db.execute(sql`
    SELECT su.id AS unit_id, su.scene_id, su.unit_index
    FROM story_units su
    JOIN story_chapters sc ON su.chapter_id = sc.id
    JOIN relationship_arcs ra ON sc.relationship_arc_id = ra.id
    WHERE su.character_id = ${characterId}
      AND ra.arc_key = ANY(ARRAY[${arcKeysSql}]::text[])
      AND ${termOr}
    ORDER BY (${matchSum}) DESC, su.unit_index ASC
    LIMIT ${limit}
  `);

  return (rows.rows as unknown as Record<string, unknown>[]).map((r) => ({
    unitId: r.unit_id as string,
    sceneId: r.scene_id as string,
    unitIndex: r.unit_index as number,
  }));
}

export function sceneIdsFromLexHits(hits: LexicalUnitHit[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const h of hits) {
    if (seen.has(h.sceneId)) continue;
    seen.add(h.sceneId);
    out.push(h.sceneId);
  }
  return out;
}

/** Build ILIKE terms: rewriter entities + message lexical, deduped + capped. */
export function buildLexicalTermsForCanon(input: {
  userMessage: string;
  entities: string[];
  maxTerms: number;
}): string[] {
  const { userMessage, entities, maxTerms } = input;
  const seen = new Set<string>();
  const terms: string[] = [];

  const push = (raw: string) => {
    const t = raw.replace(/[%_\\]/g, "").trim();
    if (t.length < CANON_RETRIEVAL.minLexicalTermLength || seen.has(t)) return;
    seen.add(t);
    terms.push(t);
  };

  for (const e of entities) push(e);
  if (terms.length >= maxTerms) return terms.slice(0, maxTerms);

  const re = /[\u4e00-\u9fff]{2,}|[A-Za-z][A-Za-z0-9]{2,}/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(userMessage)) !== null) {
    push(m[0]);
    if (terms.length >= maxTerms) break;
  }
  return terms;
}
